import { ChatOpenAI } from '@langchain/openai';

// Current DeepSeek API names plus the retired Flash alias kept for existing users.
export const SUPPORTED_MODELS = ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'];

function positiveInteger(value, fallback, name) {
  const number = Number(value || fallback);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} 必须为正整数`);
  return number;
}

// The caller always supplies the billing user, which may differ from the Agent owner.
export function createLlmService({ db, encryptSecret, decryptSecret, env = process.env, fetchImpl = globalThis.fetch }) {
  const gatewayUrl = (env.LLM_GATEWAY_URL || '').trim().replace(/\/+$/, '');
  const masterKey = (env.LLM_GATEWAY_MASTER_KEY || '').trim();
  if (Boolean(gatewayUrl) !== Boolean(masterKey)) throw new Error('LLM_GATEWAY_URL 和 LLM_GATEWAY_MASTER_KEY 必须同时配置');
  if (gatewayUrl) {
    const url = new URL(gatewayUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw new Error('LLM_GATEWAY_URL 必须为网关根地址，不含路径、凭证或查询参数');
    }
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', 'llm-gateway'].includes(url.hostname)) {
      throw new Error('远程模型网关必须使用 HTTPS；本机和 Compose 内的 llm-gateway 可使用 HTTP');
    }
  }
  const timeout = positiveInteger(env.LLM_TIMEOUT_MS, 60000, 'LLM_TIMEOUT_MS');
  const rpmLimit = positiveInteger(env.LLM_GATEWAY_RPM, 60, 'LLM_GATEWAY_RPM');
  const tpmLimit = positiveInteger(env.LLM_GATEWAY_TPM, 100000, 'LLM_GATEWAY_TPM');
  const inFlight = new Map();




  function billingCredentials(user) {
    if (!Number.isSafeInteger(user?.id) || user.id < 1 || !user.api_key) throw new Error('NO_API_KEY');
    const apiKey = decryptSecret(user.api_key);
    if (!apiKey) throw new Error('NO_API_KEY');
    return apiKey;
  }

  async function gatewayKey(userId) {
    const row = await db.prepare('SELECT encrypted_key FROM llm_gateway_keys WHERE user_id=? AND gateway_url=?').get(userId, gatewayUrl);
    if (row) return decryptSecret(row.encrypted_key);
    if (!inFlight.has(userId)) {
      const pending = (async () => {
        let response;
        try {
          response = await fetchImpl(`${gatewayUrl}/key/generate`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterKey}` },
            body: JSON.stringify({ key_alias: `campusmind-user-${userId}`, models: SUPPORTED_MODELS,
              rpm_limit: rpmLimit, tpm_limit: tpmLimit, metadata: { campusmind_user_id: userId } })
          });
        } catch {throw new Error('模型网关凭证创建失败，请联系管理员检查网关连接');}
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`模型网关凭证创建失败（${response.status}），请联系管理员`);
        }
        let key;
        try {key = (await response.json()).key;} catch {/* report a safe error below */}
        if (typeof key !== 'string' || !key.startsWith('sk-') || key === masterKey) throw new Error('模型网关未返回有效的用户凭证');
        await db.prepare('INSERT INTO llm_gateway_keys (user_id,gateway_url,encrypted_key) VALUES (?,?,?)').run(userId, gatewayUrl, encryptSecret(key));
        return key;
      })();
      inFlight.set(userId, pending);
    }
    try {return await inFlight.get(userId);} finally {inFlight.delete(userId);}
  }

  async function sendChat(user, payload, options = {}) {
    const providerKey = billingCredentials(user);
    if (!SUPPORTED_MODELS.includes(payload.model)) throw new Error('不支持的模型');
    const key = gatewayUrl ? await gatewayKey(user.id) : providerKey;
    // api_key is LiteLLM's per-request upstream credential; Authorization is its virtual key.
    // Never accept an upstream URL, billing identity or shared fallback credential from callers.
    const body = { ...payload };
    for (const field of ['api_key', 'api_base', 'base_url', 'user_config', 'fallbacks', 'metadata', 'user']) delete body[field];
    if (gatewayUrl) Object.assign(body, { api_key: providerKey, user: `campusmind-user-${user.id}` });
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    let response;
    try {
      response = await fetchImpl(`${gatewayUrl || 'https://api.deepseek.com'}/chat/completions`, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body)
      });
    } catch {throw new Error('模型服务连接失败或超时，请稍后重试');}
    if (!response.ok) {
      // Provider errors may echo credentials or request bodies. Do not expose them to logs/UI.
      await response.body?.cancel();
      return Response.json({ error: { message: `模型服务请求失败（${response.status}）`, type: 'model_request_failed' } }, { status: response.status });
    }
    return response;
  }

  function createModel(user, temperature = 0.3) {
    billingCredentials(user);
    const model = SUPPORTED_MODELS.includes(user.model_type) ? user.model_type : SUPPORTED_MODELS[0];
    return new ChatOpenAI({
      model, apiKey: 'campusmind-transport', temperature, timeout, maxRetries: 0,
      useResponsesApi: false,
      configuration: {
        baseURL: gatewayUrl || 'https://api.deepseek.com',
        fetch: async (_url, options) => await sendChat(user, JSON.parse(options.body), { signal: options.signal })
      }
    });
  }

  return { createModel, sendChat, gatewayEnabled: Boolean(gatewayUrl) };
}
