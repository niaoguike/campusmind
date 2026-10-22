# Redis 聊天缓存

PostgreSQL 是唯一持久数据来源，pgvector 负责长期记忆。Redis 缓存个人 Agent 最近 12 条消息和消息列表，默认 10 分钟过期；每个条目最多 256 KiB，超出时直接读取数据库。账号权限、模型凭证、行动状态和长期记忆检索不使用此缓存。

## 本机启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/redis/start-local.ps1
npm --prefix server run cache:check
```

首次启动自动生成忽略提交的 `deploy/redis/.env`；重复运行保留密码。Docker 容器只绑定 `127.0.0.1:6379`，启用密码，最大内存 128 MiB，使用 LRU 淘汰，不持久化缓存。缓存丢失后会从 PostgreSQL 重建。

开发环境 API 自动读取这份配置，启动/重启后端后生效。生产环境使用 `REDIS_URL=redis://:密码@redis:6379`，基础 Compose 会自动注入。特殊字符密码在连接 URL 中需要 URL 编码；Compose 示例要求使用随机十六进制密码。

## 配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `REDIS_URL` | 无 | Redis 地址；支持 `rediss://` TLS |
| `REDIS_ENABLED` | 配置地址时启用 | `false` 明确关闭，`true` 要求配置地址 |
| `REDIS_KEY_PREFIX` | `campusmind:cache:v1` | 不同业务数据库必须使用不同前缀 |
| `REDIS_CACHE_TTL_SECONDS` | `600` | 缓存有效期，1–86400 秒 |
| `REDIS_TIMEOUT_MS` | `200` | 单次缓存操作超时，20–2000 毫秒 |

目前支持单实例 Redis（可供多个 API 进程共享），不使用 Redis Cluster。每次建立连接都会切换共享缓存代次，以丢弃断线期间可能漏掉更新的旧条目；重启 API 会使缓存重新预热。

## 读写与失效

- 读取先检查当前用户、会话权限，再查 Redis；未命中时读 PostgreSQL 并回填，同一进程中的并发未命中合并为一次查询。
- 聊天消息先提交数据库事务，再用 Lua 原子追加最近上下文，按消息 ID 排序、去重并截取 12 条；完整消息列表同时失效。成果生成、项目摘要和操作完成消息也执行同样的更新。
- 冷缓存不会只用新消息代替旧历史，而会先从数据库读完整窗口。摘要检索直接复用窗口最早消息 ID，省去原来的额外查询；附件正文按当前用户和会话批量查询一次。
- 版本比较阻止较早读取覆盖较新写入。删除账号后清除缓存，并拒绝正在进行的旧读取再次回填。行动执行状态在响应前重新读取，不缓存动态状态。
- Redis 超时或断线时立即回退数据库，关闭离线命令队列；后续请求尝试恢复。数据库错误会继续正常上报，不会返回缓存来掩盖数据库错误。

数据库与 Redis 之间不是分布式事务：进程恰好在数据库提交后、缓存更新前退出时，其他仍运行的实例可能短暂读到旧值，最长到缓存 TTL；连接恢复会切换代次。如果通过脚本直接修改消息而绕过 API，应主动清缓存或重启 API。缓存不用于授权判断或保证资金等强一致操作。

`/api/health` 返回 `cache.enabled` 和 `cache.ready`；Redis 不可用不会改变主服务的健康状态。内部缓存服务另提供命中、未命中和回退计数用于排查；健康接口不公开这些计数或连接凭证。

## 阿里云 / Docker 部署

创建 `deploy/redis/.env` 并填写随机密码，和 PostgreSQL 配置一起加载：

```bash
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env up -d --build
```

也可使用阿里云托管 Redis：直接运行 Node 时设置对应 `REDIS_URL`；使用 Compose 时通过覆盖文件修改 `api.environment.REDIS_URL`，因为基础编排会覆盖 `server/.env` 中的地址。Redis 无需备份聊天数据，继续备份 PostgreSQL 和上传文件。

## 测试

```bash
npm --prefix server run test:cache
npm --prefix server run test:postgres
npm --prefix server run test:api
```

缓存测试连接真实 Redis 和随机隔离的 PostgreSQL schema，验证实际减少查询、跨实例并发、过期、删除防回填、超时和恢复。可用 `TEST_REDIS_URL` 指定测试 Redis；测试键使用随机前缀，不执行 `FLUSHDB` 或清空业务缓存。已有聊天集成测试也在独立缓存前缀下运行。

客户端故障处理参考 [Redis Node.js production usage](https://redis.io/docs/latest/develop/clients/nodejs/produsage/)。
