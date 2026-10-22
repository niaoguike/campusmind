# CampusMind 团队代码协作指南

这份指南适用于 CampusMind 的五人小组协作。

## 一、统一规则

- `master` 是正式分支：只有组长审核并合并后才会进入这个分支。
- 组员不直接向 `master` 推送代码，也不直接在服务器上修改代码。
- 每项功能都在单独的功能分支完成，命名为 `feature/姓名-功能名`。
- 组员通过 Gitee 的 Pull Request 请求组长审核；Pull Request 不会自动上线。
- 只有组长合并 `master` 后，才由组长部署服务器。
- 不提交 `.env`、真实 API Key、密码、数据库文件、`node_modules` 或个人临时文件。

## 二、每天开始开发前：更新本地代码

在 VS Code 中打开项目后，点击菜单 **终端 → 新建终端**，执行：

```powershell
git status
git switch master
git pull --ff-only origin master
```

正常结果应包含 `Already up to date.`，或显示已下载并更新的文件。

如果 `git status` 显示有未提交修改，请不要马上拉取。先提交自己的工作，或联系组长处理，避免覆盖本地内容。

## 三、组员：开始一个新功能

从已经更新的 `master` 创建自己的分支：

```powershell
git switch -c feature/zhangsan-forum
```

把 `zhangsan-forum` 改为自己的姓名和功能名称，例如：

```text
feature/lisi-login-page
feature/wangwu-course-resource
feature/zhaoliu-ui-adjustment
```

确认自己在哪个分支：

```powershell
git branch --show-current
```

不要在 `master` 分支直接开始修改。

## 四、组员：完成修改后提交并推送

先查看改动：

```powershell
git status
```

只暂存这次功能实际修改的文件：

```powershell
git add src/views/ForumHome.vue
git add server/index.js
```

不要使用 `git add .`，以免把数据库、密钥或无关文件一起提交。

提交时写清楚本次修改：

```powershell
git commit -m "feat: add forum post filter"
```

推送功能分支到 Gitee：

```powershell
git push -u origin feature/zhangsan-forum
```

提交信息建议：

```text
feat: 新功能
fix: 修复问题
docs: 更新文档
style: 页面样式调整
refactor: 代码重构
test: 增加或修改测试
```

## 五、组员：创建 Pull Request

推送完成后，打开 Gitee 仓库：

1. 点击 **Pull Requests**。
2. 点击 **新建 Pull Request**。
3. 选择：
   - 源分支：自己的 `feature/姓名-功能名`
   - 目标分支：`master`
4. 审核人选择组长。
5. 填写标题和说明。

说明模板：

```text
完成内容：
- 增加论坛帖子筛选
- 修复列表刷新问题

验证方式：
- node --check server/index.js
- npm.cmd run build
- 手动测试论坛发帖和筛选

影响范围：
- src/views/ForumHome.vue
- server/index.js

数据库或环境变量变更：无
```

Pull Request 的含义是“请求组长把我的功能分支合并到正式分支”。创建后，组员仍可以继续向自己的功能分支推送修复提交，PR 会自动更新。

## 六、组长：审核 Pull Request

在 Gitee 打开 Pull Request 后：

1. 检查源分支是否为组员的 `feature/...`，目标分支是否为 `master`。
2. 点击 **代码评审** 或 **文件变更**。
3. 查看左侧全部修改文件和中间的红绿代码差异。
   - 绿色 `+` 是新增代码。
   - 红色 `-` 是删除或替换的代码。
4. 检查是否提交了 `.env`、真实密钥、数据库、`node_modules` 或无关文件。
5. 对有疑问的代码行添加评论，让组员修改后重新推送。
6. 确认每项修改都符合 PR 标题和说明。
7. 在本地运行验证命令。

组长本地验证：

```powershell
git fetch origin
git switch feature/组员分支名
git pull --ff-only origin feature/组员分支名

node --check server/index.js
npm.cmd run build
```

**注意：** 如果组长本地工作区有未提交修改，不要直接切换分支。应先保存自己的工作，或使用单独的项目副本审核。

测试通过后，在 Gitee 点击 **测试通过**、**审查通过**，再点击 **合并 Pull Request**。

首次上线或重要功能合并时，建议暂时不要勾选“合并后删除源分支”，保留分支以便回退。

## 七、合并后：所有成员同步正式代码

Pull Request 合并进 `master` 后，每位成员在开始下一项工作前执行：

```powershell
git switch master
git pull --ff-only origin master
```

然后再创建新的功能分支：

```powershell
git switch -c feature/自己的名字-新功能
```

如果自己正在功能分支开发，而 `master` 已有新代码，先提交当前工作，再同步：

```powershell
git status
git fetch origin
git merge origin/master
git push
```

若出现冲突，VS Code 会显示冲突文件。处理完冲突后：

```powershell
git add 已解决冲突的文件
git commit -m "merge: sync master"
git push
```

不要使用 `git reset --hard` 处理冲突；不确定时先联系组长。

## 八、组长：部署到服务器

只有 Pull Request 已合并到 `master` 后才部署。

登录服务器：

```bash
ssh root@123.56.248.129
cd /opt/campusmind
```

先检查服务器工作区：

```bash
git status --short
```

没有输出才继续：

```bash
git fetch origin
git switch master
git pull --ff-only origin master

docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env build api web
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env up -d --force-recreate api web

docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env cp web:/usr/share/nginx/html/. /var/www/campusmind/

nginx -t && systemctl reload nginx
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env ps
curl --fail --show-error http://127.0.0.1:3001/api/health
```

首次升级统一 PostgreSQL 时，先按照 [部署说明](DEPLOY.md) 准备数据库、Redis 配置、导入旧 SQLite 数据并迁移上传文件，再执行上面的更新命令。保留原有应用加密密钥；PR 合并不会自动迁移线上数据库。

健康检查成功时会显示类似（缓存不可用时 `ready` 为 `false`）：

```json
{"status":"ok","agent":"langchain","database":"postgresql","cache":{"enabled":true,"ready":true}}
```

部署后使用浏览器无痕窗口测试登录、学生端、教师端和本次新增功能。

如果服务器上的 `git status --short` 有输出，停止部署，不要强制拉取或执行 `git reset`。

## 九、常见问题

### `fatal: not a git repository`

说明当前终端不在项目目录。进入项目目录后再执行 Git 命令：

```powershell
cd D:\ai-platform-front
```

服务器上则是：

```bash
cd /opt/campusmind
```

### `error: Your local changes would be overwritten`

说明本地有未提交修改。不要强制拉取；先执行：

```powershell
git status
```

确认哪些文件是自己的工作后，提交到自己的功能分支，或联系组长。

### 拉取时有冲突

不要删除文件或使用 `git reset --hard`。在 VS Code 解决冲突标记后，再执行：

```powershell
git add 已解决冲突的文件
git commit
git push
```

### 网页部署后还是旧版本

确认已经执行：

```bash
docker compose --env-file deploy/postgres/.env --env-file deploy/redis/.env cp web:/usr/share/nginx/html/. /var/www/campusmind/
nginx -t && systemctl reload nginx
```

然后用浏览器无痕窗口访问，或执行强制刷新 `Ctrl + F5`。
