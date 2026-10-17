# 统一 PostgreSQL 与 pgvector

业务、原始聊天、记忆任务、用户画像和历史摘要统一存储在一个 PostgreSQL 数据库中。Redis 缓存当前会话上下文和消息列表，详见 [缓存说明](../redis/README.md)。`better-sqlite3` 仅供旧库导入和迁移测试使用，不参与后端正常运行。

## 本地启动

Windows 执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/postgres/start-local.ps1
npm --prefix server run db:migrate
```

启动脚本识别系统 PATH、当前用户安装目录和系统安装目录中的 Docker Desktop。它在首次使用时生成 `deploy/postgres/.env`，启动数据库并验证连接；重复运行不覆盖密码、不清空数据。数据库绑定 `127.0.0.1:5432`，数据保存在持久化 Docker 卷中。

开发环境未设置 `DATABASE_URL` 时，后端自动读取该本地配置。生产环境必须配置 `DATABASE_URL`。数据库结构在 API 启动前自动执行版本化迁移，也可单独运行 `db:migrate`；已应用文件通过校验和保护，修改结构应新增迁移文件。

## 导入旧 SQLite

先停止旧版本应用的写入，再执行：

```powershell
npm --prefix server run db:import-sqlite -- --dry-run
npm --prefix server run db:import-sqlite
```

默认来源是 `server/data.db`。指定其他来源：

```powershell
npm --prefix server run db:import-sqlite -- --source D:/backup/data.db
```

导入器只读打开原库，使用 SQLite 在线备份接口将一致性副本保存到 `data/backups`。全部业务数据在一个 PostgreSQL 事务中导入，保留原始 ID、密码哈希、加密模型 Key、附件路径和历史内容，核对每张表行数并重置自增序列。课程资料全文索引重建为 PostgreSQL GIN/tsvector 索引。

- 未知表或未知列会拒绝导入，不静默丢弃。
- 目标业务数据非空时拒绝合并或覆盖。
- 同一来源快照重复导入返回已导入状态，不重复插入。
- 任何导入错误回滚目标事务，原库及备份保留。
- 上传文件不在数据库中，部署时应一并复制到对应上传目录/卷。
- 保留原 `LLM_CONFIG_ENCRYPTION_KEY`，否则已导入的模型 Key 无法解密。
- 原来单条学习画像和群成果索引原样保留在对应表中；新的稳定事实提取有独立证据校验，不把旧助手摘要自动当成用户新陈述。

导入会为存在助手回答的历史个人会话安排摘要任务。任务只包含消息引用，后台在 embedding 配置完整、对应用户有可用对话模型 Key 后处理，不会假报已生成摘要。当前本地旧库只有课程和公告数据，没有用户或聊天记录，因此这次迁移没有实际历史对话可回填。

## 历史摘要与长期记忆

详见 [记忆工作流](../memory/README.md)。可重新安排所有历史会话，或只安排某个用户：

```powershell
npm --prefix server run db:backfill-summaries
npm --prefix server run db:backfill-summaries -- --user 42
```

这些命令只安排任务，不直接调用模型。运行 API 后，后台从未摘要的消息范围继续处理，记录起止消息 ID、摘要版本、源文本哈希和向量空间标识。队列使用租约与 `FOR UPDATE SKIP LOCKED`，支持失败退避和进程中断后恢复。

## Docker 与阿里云

本机开发只需数据库；完整部署使用基础 Compose：

```bash
cp server/.env.example server/.env
cp -n deploy/postgres/.env.example deploy/postgres/.env
cp -n deploy/redis/.env.example deploy/redis/.env
# 设置应用密钥、数据库密码和可选的 embedding 配置
# 升级部署时保留原有密钥，已有配置不要覆盖

docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env up -d --build
```

基础编排包含前端、API、PostgreSQL 和 Redis。容器内 API 使用 `postgres:5432`；宿主机 Node 使用 `127.0.0.1:5432`。Redis 启动和配置见[缓存说明](../redis/README.md)。旧的 `docker-compose.memory.yml` 已变成空兼容层，不再创建独立记忆数据库。

可以将同样的配置部署到阿里云 ECS；也可使用支持 pgvector 的 RDS PostgreSQL，此时在应用中提供云数据库 `DATABASE_URL`。不要把本机地址直接当成云端数据库地址。生产账户应按应用运行与结构迁移所需权限配置。

数据库使用 `pg_dump` 备份，上传文件单独备份。保留 SQLite 副本和旧版本代码，完成业务验收后再决定清理；本次改造不会自动删除旧库或任何 Docker 数据卷。

## 验证

先启动本地数据库，再执行：

```bash
npm --prefix server run db:check
npm --prefix server run test:postgres
npm --prefix server run test:api
npm --prefix server run test:gateway
npm run build
```

后端测试在随机命名的独立 PostgreSQL schema 中运行并清理，不修改业务表；模型和 embedding 使用本地替身，不消耗外部模型额度。真实模型的摘要质量与相似度阈值需另行校准。
