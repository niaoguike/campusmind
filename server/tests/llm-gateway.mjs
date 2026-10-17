import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { createTestDatabase } from './helpers/postgres.mjs';
import { fileURLToPath } from 'node:url';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { createLlmService } from '../services/llmClient.js';
import { designLearningArtifact } from '../services/artifactPlanner.js';

const encryptionKey = crypto.randomBytes(32);
function encryptSecret(value) {
  const iv = crypto.randomBytes(12),cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':');
}
function decryptSecret(value) {
  const [iv, tag, data] = value.split(':').map((part) => Buffer.from(part, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
const alice = { id: 1, api_key: encryptSecret('fake-provider-alice'), model_type: 'deepseek-v4-flash' };
const bob = { id: 2, api_key: encryptSecret('fake-provider-bob'), model_type: 'deepseek-v4-pro' };
const payload = { model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'hello' }] };

test('per-user gateway credentials, real LangChain tool loop, artifacts and direct mode', async () => {
  const calls = [],generated = [],keys = new Map();
  let failChat = 0,failGenerate = false;
  const server = createServer(async (req, res) => {
    try {
      let text = '';
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      calls.push({ path: req.url, authorization: req.headers.authorization, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/key/generate') {
        assert.equal(req.headers.authorization, 'Bearer sk-fake-master');
        if (failGenerate) {res.writeHead(503);res.end('secret-in-error');return;}
        generated.push(body);
        const key = `sk-fake-virtual-${body.metadata.campusmind_user_id}`;
        keys.set(key, body.metadata.campusmind_user_id);
        res.end(JSON.stringify({ key }));return;
      }
      assert.equal(req.url, '/chat/completions');
      const userId = keys.get(req.headers.authorization?.replace('Bearer ', ''));
      assert(userId, 'inference must use a per-user virtual key');
      assert.equal(body.user, `campusmind-user-${userId}`);
      assert.equal(body.api_key, userId === 2 ? 'fake-provider-bob' : 'fake-provider-alice');
      assert(!body.api_base);
      if (failChat) {res.writeHead(failChat);res.end(JSON.stringify({ error: { message: 'secret-in-error fake-provider-alice sk-fake-master' } }));return;}
      let message = { role: 'assistant', content: 'done' },finish = 'stop';
      if (body.tools?.length && !body.messages.some((item) => item.role === 'tool')) {
        message = { role: 'assistant', content: null, tool_calls: [{ id: 'call_snapshot', type: 'function', function: { name: 'get_snapshot', arguments: '{}' } }] };
        finish = 'tool_calls';
      } else if (body.response_format) {
        message.content = JSON.stringify({ title: 'Test artifact', slides: [{ title: 'Point', bullets: ['Evidence'] }], sections: [{ heading: 'Review', paragraph: 'From conversation' }] });
      }
      res.end(JSON.stringify({ id: `chatcmpl-test-${calls.length}`, object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    } catch (error) {
      res.writeHead(500);res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const fixture = await createTestDatabase(),db = fixture.db;
  const env = { LLM_GATEWAY_URL: url, LLM_GATEWAY_MASTER_KEY: 'sk-fake-master' };
  const service = () => createLlmService({ db, encryptSecret, decryptSecret, env });
  try {
    const llm = service();
    await Promise.all([llm.sendChat(alice, payload), llm.sendChat(bob, { ...payload, model: bob.model_type }), llm.sendChat(alice, payload)]);
    assert.equal(generated.length, 2, 'concurrent calls must share credential creation');
    assert.deepEqual(generated[0].models, ['deepseek-v4-flash', 'deepseek-v4-pro']);
    assert.equal(generated[0].rpm_limit, 60);
    assert.equal(generated[0].tpm_limit, 100000);
    for (const row of await db.prepare('SELECT * FROM llm_gateway_keys').all()) {
      assert(!row.encrypted_key.includes('sk-fake'));
      assert.equal(decryptSecret(row.encrypted_key), `sk-fake-virtual-${row.user_id}`);
    }
    await service().sendChat(alice, payload);
    assert.equal(generated.length, 2, 'restarting the adapter must reuse persisted keys');

    let toolCalls = 0;
    const snapshot = tool(() => {toolCalls++;return 'free at 15:00';}, { name: 'get_snapshot', description: 'Read schedule', schema: z.object({}) });
    const agent = createAgent({ model: llm.createModel(alice), tools: [snapshot] });
    const result = await agent.invoke({ messages: [{ role: 'user', content: 'make a plan' }] });
    assert.equal(toolCalls, 1);
    assert.equal(result.messages.at(-1).content, 'done', JSON.stringify(result.messages.map((message) => ({ type: message.getType(), content: message.content, id: message.id }))));
    const toolReturn = calls.find((call) => call.body.messages?.some((message) => message.role === 'tool'));
    assert.equal(toolReturn.body.messages.find((message) => message.role === 'tool').content, 'free at 15:00');

    const artifact = await designLearningArtifact({ requestChat: (body) => llm.sendChat(bob, body), model: bob.model_type, mode: 'ppt', conversation: 'Review this topic' });
    assert.equal(artifact.title, 'Test artifact');
    assert.equal(calls.at(-1).authorization, 'Bearer sk-fake-virtual-2');

    await llm.sendChat(alice, { ...payload, api_key: 'wrong-key', api_base: 'https://wrong.example', user: 'wrong-user', metadata: { private: 'value' } });
    assert.equal(calls.at(-1).body.api_key, 'fake-provider-alice');
    assert(!calls.at(-1).body.metadata);

    failChat = 429;
    const countBefore = calls.length;
    await assert.rejects(() => llm.createModel(alice).invoke('hello'), (error) => {
      assert(!String(error).includes('secret-in-error'));
      assert(!String(error).includes('fake-provider-alice'));
      assert(!String(error).includes('sk-fake-master'));
      return error.status === 429;
    });
    assert.equal(calls.length, countBefore + 1, 'rate limits must not trigger automatic paid retries');
    failChat = 401;
    const countBeforeUnauthorized = calls.length;
    const unauthorized = await llm.sendChat(bob, { ...payload, model: bob.model_type });
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, countBeforeUnauthorized + 1, 'an invalid upstream credential must not fall back to another user or provider');
    failChat = 0;
    failGenerate = true;
    const charlie = { ...alice, id: 3 };
    await assert.rejects(() => llm.sendChat(charlie, payload), /凭证创建失败（503）/);
    assert(!(await db.prepare('SELECT 1 FROM llm_gateway_keys WHERE user_id=3').get()));
    failGenerate = false;
    assert((await llm.sendChat(charlie, payload)).ok, 'failed provisioning must be retryable on a later request');
    const countBeforeMissing = calls.length;
    await assert.rejects(() => llm.sendChat({ id: 1 }, payload), /NO_API_KEY/);
    assert.equal(calls.length, countBeforeMissing, 'missing provider credentials must fail before network access');

    const directFixture = await createTestDatabase(),directDb = directFixture.db;
    try {
      const direct = createLlmService({ db: directDb, encryptSecret, decryptSecret, env: {}, fetchImpl: async (target, options) => {
          assert.equal(target, 'https://api.deepseek.com/chat/completions');
          assert.equal(options.headers.Authorization, 'Bearer fake-provider-bob');
          const body = JSON.parse(options.body);
          assert(!body.api_key);
          assert(!body.user);
          return Response.json({ choices: [] });
        } });
      await direct.sendChat(bob, { ...payload, model: bob.model_type });
      assert.equal(direct.gatewayEnabled, false);
      assert.equal((await directDb.prepare('SELECT COUNT(*) AS n FROM llm_gateway_keys').get()).n, 0);
      assert.throws(() => createLlmService({ db: directDb, encryptSecret, decryptSecret, env: { LLM_GATEWAY_URL: url } }), /必须同时配置/);
      assert.throws(() => createLlmService({ db: directDb, encryptSecret, decryptSecret, env: { ...env, LLM_GATEWAY_URL: 'http://remote.example' } }), /HTTPS/);
      assert.throws(() => createLlmService({ db: directDb, encryptSecret, decryptSecret, env: { ...env, LLM_GATEWAY_URL: `${url}/v1` } }), /根地址/);
    } finally {await directFixture.close();}
  } finally {
    await fixture.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
