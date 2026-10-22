# 本地 embedding：Ollama + BGE-M3

用本机 CPU 运行 BGE-M3，生成 1024 维向量，供长期记忆与课程资料 RAG 使用。模型通过 Ollama 的 OpenAI 兼容接口调用，不需要云端模型账号或付费 API Key。`ollama` 只是现有客户端要求的非空占位值，本地 Ollama 不验证该值。服务仅发布在宿主机回环地址，关闭 Ollama 云模型功能。

## 启动

保持 Docker Desktop 运行，先启动现有 PostgreSQL，再启动 embedding：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/postgres/start-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/embeddings/start-local.ps1
```

脚本下载官方 Ollama 镜像和 BGE-M3 模型；模型存入 `campusmind-ollama` 持久卷，重复启动不会重复下载相同模型。下载中断后重新执行即可继续。首次下载受网络速度影响，容器健康只表示服务启动，不表示模型已经下载完。

模型准备好后，脚本检查现有向量空间是否兼容，再更新被 Git 忽略的 `server/.env`，保留原有应用密钥及其他配置，最后执行真实 embedding 与 pgvector 检查。已有不兼容向量时拒绝更改配置，不删除或自动重建历史记忆。

```dotenv
MEMORY_ENABLED=true
MEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
MEMORY_EMBEDDING_API_KEY=ollama
MEMORY_EMBEDDING_MODEL=bge-m3
MEMORY_EMBEDDING_DIMENSIONS=1024
MEMORY_EMBEDDING_TIMEOUT_MS=60000
```

启动或重启 Node API 后生效：

```powershell
npm --prefix server run dev
```

只重新写入本地配置可执行 `npm --prefix server run embedding:local`；只验证向量服务执行 `npm --prefix server run embedding:check`。本地 CPU 模型首次加载可能较慢，因此本地配置将超时设为 60 秒；热启动的耗时需以本机实测为准。

## 成本和范围

- 本地向量化没有云端模型按 Token/请求计费；消耗本机 CPU、内存和电力。
- BGE-M3 模型下载约 1.2 GB。此次使用的官方 Ollama 0.40.6 镜像解压后约 9.4 GB，另有 Docker 自身占用；预留至少 12 GB 磁盘空间。下载完成后，本地向量推理不要求持续联网。
- 模型配置为单并行、最多加载一个模型，空闲 10 分钟后卸载模型以释放内存；模型文件仍保留。
- 本机 CPU 验证中，模型加载后容器约占 1.26 GiB 内存（空闲时观测，不代表峰值）；3 条示例的首次加载和向量化合计约 9–15 秒。热启动实际耗时取决于输入长度和机器负载。
- 这里只本地化 embedding。提取画像、生成摘要、回答问题和 Query Rewrite 若使用云端对话模型，仍需对应用户的 Key，并可能计费。
- 课程资料 RAG 默认复用这套向量服务：上传正文自动切分并排队向量化，关键词与向量两路召回后由 RRF 融合。历史索引重建与可选 Rerank 见 [RAG 说明](../rag/README.md)。

## 完整 Docker 应用

宿主机 Node 使用 `127.0.0.1`，API 容器使用同一 Docker 网络中的 `embeddings`。可选覆盖文件为完整应用设置容器内地址：

```bash
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env -f docker-compose.yml -f docker-compose.local-embedding.yml up -d embeddings
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env -f docker-compose.yml -f docker-compose.local-embedding.yml exec -T embeddings ollama pull bge-m3
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env -f docker-compose.yml -f docker-compose.local-embedding.yml up -d --build
```

应用目前将服务地址、模型名称和维度一起标识向量空间。宿主机地址与容器地址不同，已产生记忆后切换部署地址会触发空间校验；需要设计迁移/重新向量化，不能直接更改已绑定的空间元数据。

## 停止与验证

```powershell
docker compose -f docker-compose.embeddings.yml stop embeddings
```

停止服务会释放运行时资源，模型卷保留。再次执行启动脚本可恢复。

`npm --prefix server run test:embedding-local` 使用真实本地模型和隔离 PostgreSQL schema，验证向量生成、画像与摘要写入、跨会话召回和删除。提取和摘要文本在测试中使用固定替身，不调用云端对话模型，不修改真实用户数据。

参考：[Ollama Docker](https://docs.ollama.com/docker)、[本地兼容接口](https://docs.ollama.com/api/openai-compatibility)、[BGE-M3 模型](https://ollama.com/library/bge-m3)。
