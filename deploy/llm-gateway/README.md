# CampusMind 大模型网关（LiteLLM，用户自付费）

调用链：浏览器 → Nginx → CampusMind 后端 → LiteLLM → 用户自己的 DeepSeek 账户。

用户继续在现有模型设置页填写自己的 DeepSeek API Key。启用网关后，后端为每个付费用户惰性创建独立的 LiteLLM 虚拟 Key，加密保存在 SQLite 的 `llm_gateway_keys` 表中。真实 DeepSeek Key 仍加密保存在原账户中，仅在请求时解密，经内网在 JSON 的 `api_key` 字段传给 LiteLLM；`Authorization` 使用用户对应的网关虚拟 Key，不使用管理员 Key。管理员 Key 仅用于创建虚拟 Key，不进入模型推理请求或浏览器。

同伴、群聊的 Agent 所有者和付费用户可以不同；新入口沿用原调用链提供的 billingUser。不配置共享上游密钥，不自动回退到其他账户，不启用跨用户语义缓存。

## 启动

在项目根目录操作，先按照 DEPLOY.md 配置 `server/.env` 和原应用数据卷。

1. 复制 `deploy/llm-gateway/.env.example` 为同目录的 `.env`。
2. 用密码管理器，或重复执行下面的命令生成三个不同值，分别填写 master key、salt key、PostgreSQL 密码；前两项加 `sk-` 前缀。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

3. 确认 Docker 正在运行，然后执行：

```bash
docker compose --env-file deploy/llm-gateway/.env -f docker-compose.yml -f docker-compose.gateway.yml config --quiet
docker compose --env-file deploy/llm-gateway/.env -f docker-compose.yml -f docker-compose.gateway.yml up -d --build
docker compose --env-file deploy/llm-gateway/.env -f docker-compose.yml -f docker-compose.gateway.yml ps
```

更新时也使用同一条带两个 `-f` 的命令。原 `deploy/server-setup.sh` 只启动基础应用，不会启用网关。

网关和 PostgreSQL 不发布宿主机端口。`main-stable` 用于首次验证，验证通过后将 `LITELLM_IMAGE` 固定到实际测试过的版本标签或镜像 digest。升级镜像也需要重新跑真实网关验收。

## 验收

1. 两个测试账户分别绑定自己的有效 DeepSeek Key，各发送一个问题。
2. 通过 LiteLLM 管理接口或 PostgreSQL 检查，应出现 `campusmind-user-<id>` 的不同 key_alias，允许的模型只有 Flash/Pro；SQLite 中应有不同的加密网关凭证。不要把完整凭证打印到日志。
3. 检查网关用量记录中两把虚拟 Key 分别累积 Token；供应商账单应分别落在这两个用户的 DeepSeek 账户。
4. 提问需要查询课表/资料的问题，确认 Function Calling 的工具请求、工具结果回传和最终回答均正常。再验证出题、批改、复盘、个人/群聊成果生成及同伴协作。
5. 第二个测试账户使用无效 DeepSeek Key 时应失败，不得成功消耗第一个账户的余额。临时降低新虚拟 Key 的 RPM/TPM，验证限流；一次多步 Agent 运行可能包含多次模型请求。

部署环境必须完成这些真实请求验收。仓库测试使用模拟网关，不证明某个 LiteLLM 镜像、供应商模型或真实计费已经通过验证。

## 配置和限制

- `server/.env` 的 `LLM_GATEWAY_RPM` / `LLM_GATEWAY_TPM` 控制**新创建**虚拟 Key 的限流，默认 60 请求/分钟、100000 Token/分钟。修改后已有 Key 需要通过 LiteLLM 管理接口更新。不要用删除映射的方式重置限流。
- `LLM_TIMEOUT_MS` 默认 60000。应用和网关均不自动重试，避免多层重试扩大用户费用。一次请求超时不代表供应商没有计费。
- 当前提供按用户凭证区分的 Token 用量与 RPM/TPM 限制；没有开通语义缓存、跨供应商故障切换或金额预算。使用 OpenAI 兼容的 DeepSeek 路由，金额估算需要核对供应商定价并在 LiteLLM 中配置对应价格，不能把未知价格当作零成本。
- 网关必须完整支持 tools/tool_calls、JSON 输出和所选模型。用户聊天与成果生成共用同一传输入口。
- 应用只向固定 DeepSeek 地址发送上游请求；不接受用户提供的 api_base。`api_key` 的逐请求覆盖使用 LiteLLM 官方 BYOK 机制，当前配置禁止 api_base 等客户端端点覆盖。使用支持该行为的版本并验证。
- 这里只支持现有的单个 Node.js 后端实例，单进程会合并同一用户的并发凭证创建。扩展后端副本前，需要跨进程锁或独立的凭证供给服务。
- 网关加密 Key 依赖原 `LLM_CONFIG_ENCRYPTION_KEY`；备份 SQLite 和网关 PostgreSQL 卷，保留 salt key。恢复网关数据库时使用匹配的备份，避免应用引用已不存在的凭证。
- 用户删除模型 Key 后，应用会阻止后续调用；网关凭证映射仍保留，避免重绑时反复生成 Key。凭证不下发前端，且无法在缺少用户上游 Key 时使用共享余额。注销账户或发生凭证泄露时，管理员仍应在 LiteLLM 中撤销对应虚拟 Key。

## 回退到直连

```bash
docker compose -f docker-compose.yml up -d --force-recreate api
```

确认 `server/.env` 的 `LLM_GATEWAY_URL`、`LLM_GATEWAY_MASTER_KEY` 均为空。之后后端直接请求 DeepSeek，用户保存的模型 Key 无需重新填写。网关数据库和凭证映射保留，方便恢复。

## 非 Docker 后端

后端环境设置 `LLM_GATEWAY_URL=https://你的可信网关根地址` 和 `LLM_GATEWAY_MASTER_KEY`。URL 不带 `/v1`、路径或查询参数。必须由你管理该网关，因为每次请求会携带用户真实上游密钥。远程连接要求 HTTPS，本机及 Compose 内 `llm-gateway` 可以使用 HTTP。

参考：[LiteLLM 用户自带密钥](https://docs.litellm.ai/docs/proxy/clientside_auth)、[虚拟 Key](https://docs.litellm.ai/docs/proxy/virtual_keys)、[Docker 快速开始](https://docs.litellm.ai/docs/proxy/docker_quick_start)。
