# CampusMind

CampusMind 是面向高校学生与教师的多 Agent 学习协作平台。平台把课程资料、课表计划、学习测验、师生协作和校园社区放在同一套系统中，并通过 LangChain 与 DeepSeek 为不同学习任务选择合适的 Agent 和工具。

> 当前项目处于原型迭代阶段。业务数据默认使用 SQLite；PostgreSQL + pgvector、MCP 和 A2A 尚未接入，相关内容仍处于技术选型阶段。

## 核心功能

### 学生端

- **专属学习 Agent**：支持课程问答、资料检索、学习规划、学习状态分析和偏好记忆。
- **行动工作台**：将复杂目标拆成步骤，对需要发布或修改平台数据的操作进行确认。
- **课程资料库**：上传 PDF、Office、表格、文本和图片资料，按课程和文件夹管理并检索文本内容。
- **AI 测验**：依据课程资料生成单选、多选、判断、填空和简答题，记录答题结果与知识点掌握情况。
- **课表与计划**：维护个人课表和学习计划，支持导入 Excel、CSV 及吉林大学课表 PDF。
- **学习成果导出**：根据 Agent 对话生成 Word、PDF、PPT 等学习成果。
- **学习协作**：添加好友、私聊、群聊，经授权访问好友 Agent，并发起同课程 Agent 协作或群组多 Agent 讨论。
- **校园论坛**：发布帖子、评论和投票，并可关联课程。

### 教师端

- 创建和管理任教课程。
- 发布课程任务，查看学生提交并评分反馈。
- 审核课程资料、发布课程通知。
- 查看班级学习统计和预警信息，维护教师私有备注。
- 管理课程论坛帖子，生成待人工审核的 AI 教学建议草稿。

### 管理端

- 管理学生和教师账户、账户状态及注销申请。
- 为教师分配已有课程。
- 发布平台公告并查看管理操作日志。

## Agent 工作方式

一次个人 Agent 请求的主要流程如下：

```text
用户问题
   │
   ▼
Express API：身份校验、会话上下文和权限控制
   │
   ▼
学习协调器：识别问题意图
   ├── 学习导师 Agent：概念讲解与综合问答
   ├── 资料检索 Agent：检索课程资料正文
   ├── 学习计划 Agent：生成计划草稿
   └── 学习画像 Agent：分析学习状态并记录偏好
   │
   ▼
LangChain Function Calling：按需调用受限工具
   │
   ▼
SQLite / 课程资料 / 学习记录
   │
   ▼
生成回答并保存可查看的 Agent 执行轨迹
```

系统还包含出题、简答题评估、群组协作和学习成果规划等专用模块。当前工具均为后端内部的 LangChain Tool，尚未通过 MCP 对外提供；多个 Agent 也运行在同一个应用内，尚未使用 A2A 协议。

模型调用默认由后端直接连接 DeepSeek。每个用户在“模型设置”中保存自己的 API Key，并自行承担模型额度；Key 加密保存，完整内容不会回传浏览器。部署时也可以启用 LiteLLM 网关，为每位用户建立独立虚拟 Key，详情见 [大模型网关部署说明](deploy/llm-gateway/README.md)。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | Vue 3、Vite、Vue Router、Element Plus、Axios |
| 后端 | Node.js、Express |
| Agent | LangChain.js、DeepSeek、Function Calling |
| 数据与认证 | SQLite、better-sqlite3、JWT、scrypt |
| 文件处理 | pdf-parse、pdfplumber、Mammoth、SheetJS、JSZip |
| 成果导出 | docx、PDFKit、PptxGenJS |
| 部署 | Docker Compose、Nginx |
| 可选网关 | LiteLLM、PostgreSQL（仅保存网关状态，不是业务数据库） |

## 项目结构

```text
campusmind/
├─ src/
│  ├─ views/                 # 学生、教师和管理员页面
│  ├─ components/            # 导航及业务组件
│  ├─ router/                # 前端路由与身份守卫
│  └─ utils/                 # API、会话和文本工具
├─ server/
│  ├─ agents/                # 协调器和各类专业 Agent
│  ├─ services/              # 模型网关、资料检索和成果导出
│  ├─ tests/                 # 后端集成测试
│  ├─ index.js               # Express API、数据库初始化与业务接口
│  └─ .env.example           # 后端环境变量示例
├─ deploy/
│  ├─ llm-gateway/           # 可选 LiteLLM 网关配置
│  └─ nginx/                 # Nginx 配置
├─ docker-compose.yml        # 基础应用编排
├─ docker-compose.gateway.yml # 网关增量编排
└─ DEPLOY.md                 # Ubuntu ECS 部署说明
```

## 本地开发

### 1. 环境要求

- Node.js 22（与 Docker 镜像保持一致）
- npm
- Python 3（用于增强 PDF 课表解析；其他主要功能仍由 Node.js 提供）

### 2. 获取代码并安装依赖

```bash
git clone https://gitee.com/wensr_517/campusmind.git
cd campusmind
npm ci
npm --prefix server ci
python -m pip install -r server/requirements.txt
```

如果系统使用 `python3` 命令，请将最后一行的 `python` 改为 `python3`。

### 3. 配置后端环境变量

Windows PowerShell：

```powershell
Copy-Item server/.env.example server/.env
```

macOS / Linux：

```bash
cp server/.env.example server/.env
```

打开 `server/.env`，至少为下面两项设置不同的随机值：

```dotenv
JWT_SECRET=用于签发登录令牌的长随机字符串
LLM_CONFIG_ENCRYPTION_KEY=用于加密用户模型Key的另一条长随机字符串
PORT=3001
```

可使用下面的命令生成随机值，执行两次并分别填写：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

其他环境变量说明：

| 变量 | 用途 | 是否必需 |
| --- | --- | --- |
| `ADMIN_STUDENT_ID`、`ADMIN_PASSWORD` | 首次启动时创建或提升管理员账户 | 可选 |
| `PDF_FONT_PATH` | PDF 成果导出使用的中文字体路径 | Linux 导出中文 PDF 时建议配置 |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` 等 | 开启阿里云短信登录和密码重置 | 可选 |
| `LLM_GATEWAY_URL`、`LLM_GATEWAY_MASTER_KEY` | 连接自建 LiteLLM 网关 | 可选，必须同时配置 |
| `LLM_GATEWAY_RPM`、`LLM_GATEWAY_TPM` | 新建用户虚拟 Key 的限流 | 启用网关时可选 |
| `CAMPUSMIND_DB_PATH` | 自定义 SQLite 文件路径 | 可选 |

不要把用户的 DeepSeek API Key 写入 `server/.env`。用户登录后在网页的“模型设置”中单独配置，目前支持 `deepseek-v4-flash` 和 `deepseek-v4-pro`。

### 4. 启动项目

在第一个终端启动后端：

```bash
npm --prefix server run dev
```

在第二个终端启动前端：

```bash
npm run dev
```

浏览器访问：

- 前端：`http://localhost:5174`
- 后端健康检查：`http://localhost:3001/api/health`

首次使用时先注册学生或教师账户。需要使用 AI 功能的用户，再进入“模型设置”绑定自己的 DeepSeek API Key。

## 验证与测试

```bash
# 前端生产构建
npm run build

# 教师端及权限接口测试
node server/tests/teacher-portal.mjs

# 身份切换和路由测试
node server/tests/portal-session.mjs

# LiteLLM 网关模拟集成测试
npm --prefix server run test:gateway
```

测试使用临时数据库或本地模拟网关，不会验证真实 DeepSeek 额度与线上 LiteLLM 镜像。真实部署仍需使用测试账户完成人工验收。

## Docker 与服务器部署

基础应用可以通过 Docker Compose 启动：

```bash
cp server/.env.example server/.env
# 编辑 server/.env 后执行
docker compose up -d --build
```

基础编排包含前端和 API，SQLite 数据保存在宿主机的 `data/data.db`。Ubuntu ECS、Nginx、数据备份与更新步骤见 [DEPLOY.md](DEPLOY.md)。如需启用按用户凭证隔离的 LiteLLM 网关，请按照 [deploy/llm-gateway/README.md](deploy/llm-gateway/README.md) 使用两个 Compose 文件启动。

## 数据与安全

- 默认业务数据库为 `server/data.db`；Docker 部署时为 `data/data.db`。
- 用户密码使用 scrypt 派生值保存，登录状态使用 JWT。
- 用户模型 Key 经 `LLM_CONFIG_ENCRYPTION_KEY` 加密后保存。
- Agent 工具按用户、课程和角色校验权限；跨用户 Agent 协作需要显式授权。
- 教师 AI 建议只使用课程匿名统计，并作为待审核草稿返回。
- 请勿提交 `server/.env`、数据库、上传文件、真实学生数据、Token 或 API Key。
- 生产环境必须更换示例密钥，并定期备份 SQLite 数据库和上传文件。

## 协作流程

1. 在 Issues 中记录问题、需求或技术讨论。
2. 从最新目标分支创建功能分支，例如 `feature/quiz-improvement`。
3. 完成功能并运行相关测试，提交清晰的 Commit。
4. 推送分支，在 Gitee 创建 Pull Request。
5. 在 PR 中写明变更内容、测试结果和关联 Issue，经组员审核后合并。

提交代码前请确认没有把本地数据库、环境变量或真实用户文件加入 Git。

## 相关文档

- [生产部署说明](DEPLOY.md)
- [教师端交付与部署说明](TEACHER_PORTAL.md)
- [LiteLLM 网关说明](deploy/llm-gateway/README.md)
