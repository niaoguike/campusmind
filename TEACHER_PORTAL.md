# CampusMind 教师端交付与部署

基于原 Node.js + Vue + SQLite 项目扩展，无第二套后端。数据库迁移只增加表和字段；未读取或修改本地运行数据库。测试通过 `CAMPUSMIND_DB_PATH` 使用临时数据库。

## 使用

- 注册时选择学生或教师。学生填写学号、姓名、手机号、学院、班级；教师填写工号、姓名、手机号和所属学院，无需班级或管理员审批。注册后自动进入对应端。
- 教师可在工作台创建任教课程，自动获得新课程管理权限。不会自动获得其他已有课程或学生记录的权限。已有课程仍可由管理员补充分配；管理员身份不能通过注册申请。
- 工号支持2至32位字母、数字、下划线、短横线；学号仍为8位数字。学号和工号共用唯一登录账号空间，手机号也不能重复。既有账号无需迁移。
- 管理员的账户设置和课程分配保留为辅助管理入口，教师正常注册与开课不再依赖它。清空课程分配撤销已有课程权限，停用账号可禁止该账号继续访问或开课。
- 教师：登录后进入 `/teacher`，课程总览、任务草稿/发布、提交评分与反馈、资料审核标记、课程通知、班级统计/预警、本人私有备注、课程论坛答复/置顶/关闭/隐藏、AI 教学建议草稿。
- 学生：课程资料页 → 课程任务与通知 → 加入本课程 → 提交任务、查看成绩和反馈。重新提交会清空旧评分，截止后拒绝提交。
- 课程成员采用学生主动加入机制。不会把全站学生当作班级名单，也不根据私聊、其他课程记录推断成员。已有教师任务提交保留，但未加入课程的学生需先加入以纳入班级统计。
- 论坛发帖可以选择关联课程；已有未关联课程的公共帖子保持原状，教师不获得管理权限。
- 资料审核是质量标记，不删除原资料、不改变学生原有资料访问方式。
- AI 仅接收当前课程的匿名人数、任务数、提交数、预警人数，使用教师本人配置，不传学生身份、提交正文、备注、私聊或学生 API Key。返回明确草稿，不调用发布/评分工具。

## 验证

```powershell
node --check server/index.js
npm.cmd run build
node server/tests/teacher-portal.mjs
node server/tests/portal-session.mjs
```

接口测试覆盖课程分配、管理员保护、越权、草稿可见性、成员加入、提交/评分/重交、私有备注、通知、资料审核、论坛关闭/隐藏、AI 未配置及越权、撤销授权、学生首页。临时库自动清理。

未使用真实教师 Key 调用收费模型；真实模型响应、线上环境与浏览器人工验收仍需上线后验证。构建的第三方 PURE 注释及大包提示不影响构建成功。

## Git 提交与推送

仅暂存以下文件，禁止 `git add .` / `git add -A`，禁止加入 `server/agents/plannerAgent.js` 或数据库。

```powershell
cd D:\ai-platform-front
git switch feature/teacher-portal-node
git add server/index.js server/tests/teacher-portal.mjs server/scripts/assign-teacher.mjs src/components/AppNav.vue src/components/CourseTeaching.vue src/router/index.js src/views/TeacherConsole.vue src/views/AdminConsole.vue src/views/CourseResource.vue src/views/ForumHome.vue src/views/ForumPost.vue TEACHER_PORTAL.md
git diff --cached --name-only
git commit -m "feat: complete course-scoped teacher portal"
git push -u origin feature/teacher-portal-node
```

若交付时已有本地提交，只需执行 push；不要重复提交。`git status --short` 中 `server/agents/plannerAgent.js` 应仍为未暂存修改。

当前 origin 为 `https://gitee.com/wensr_517/campusmind.git`。在 Gitee 仓库创建 Pull Request，源分支选 `feature/teacher-portal-node`，目标选服务器当前使用的主分支；审核文件列表、测试结果后合并。GitHub 镜像使用相同源/目标分支创建 PR，等待检查通过后合并。勿把分支名未经确认当作 main/master。

## 服务器部署（PR 合并后）

```bash
ssh root@123.56.248.129
cd /opt/campusmind
git status --short
DEPLOY_BRANCH=$(git branch --show-current)
printf '部署分支：%s\n' "$DEPLOY_BRANCH"
# 确认上面是刚合并 PR 的目标分支；若有线上代码改动，先处理，不要 reset --hard。

# 使用 SQLite 在线备份 API，包含 WAL 中的数据，不覆盖原库。
docker compose exec -T api node --input-type=module -e 'import Database from "better-sqlite3"; const db=new Database("/app/data.db",{readonly:true}); await db.backup("/tmp/campusmind-before-teacher.db"); db.close();'
mkdir -p backups
docker compose cp api:/tmp/campusmind-before-teacher.db "backups/before-teacher-$(date +%Y%m%d-%H%M%S).db"

git pull --ff-only origin "$DEPLOY_BRANCH"
docker compose up -d --build
# 本服务器外层 Nginx 的 root 为 /var/www/campusmind，必须同步网页文件。
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /var/www/campusmind-backups
cp -a /var/www/campusmind "/var/www/campusmind-backups/site-$STAMP"
docker compose cp web:/usr/share/nginx/html/. /var/www/campusmind/
nginx -t && systemctl reload nginx
docker compose ps
docker compose logs --tail=150 api web
curl --fail --show-error http://127.0.0.1:3001/api/health
curl --fail --show-error -I http://127.0.0.1:8080/
```

保持现有 `data/data.db` 挂载及线上环境配置；不要删除数据库、执行 `docker compose down -v` 或复制开发库覆盖线上数据。备份命令失败时先解决备份，勿继续部署。

学生页面不提供教师工作台入口。教师登录使用服务端角色进入教师端，切换账号时清空旧身份，导航栏响应当前身份变化。身份查询失败时登录页显示错误原因，不再只显示成功后静默退回。若线上仍无法登录，请提供登录页的错误文字，无需发送密码或 token。

## 设置指定账号为教师并分配课程

教师现在可以自行注册和创建任教课程，无需执行本节。仅需转换已有账号或为已有课程增加教师时，使用管理员页面或以下命令。命令方式使用管理员登录的 Bearer token，不把 token 写入脚本或历史记录。先登录网页，在浏览器开发者工具本地取出管理员 token；不要发给他人。

```bash
cd /opt/campusmind
read -rsp '管理员 Bearer token: ' ADMIN_TOKEN; echo
export ADMIN_TOKEN
curl --fail --show-error -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:3001/api/courses
# 将 账号 和 1 2 替换为真实登录账号、上一步查到的课程 ID。
docker compose exec -T -e ADMIN_TOKEN api node scripts/assign-teacher.mjs 账号 1 2
unset ADMIN_TOKEN
```

不传课程 ID 会撤销该教师的全部课程分配。该命令调用管理员 API，检查角色、课程有效性并写入审计日志。教师刷新页面或重新登录后生效。
