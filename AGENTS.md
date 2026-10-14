# AGENTS.md —— dsh-move-session 协作规则

本文档为 AI 编码助手与本仓库维护者协作时的**规则与约束**，是本项目规则的**唯一维护来源**。

**文档分工（严格）**：
- **README.md / README.en.md** —— 面向**使用者**的教程与说明（功能、安装、使用、限制）；两文件必须同步（见规则 6）
- **AGENTS.md** —— 面向**维护者与 AI 助手**的工作规则（版本、测试、提交、代码不变量），本文档
- **docs/CHANGELOG.md** —— 版本历史与发布记录

## 项目定位

插件包 **`@hucj/dsh-move-session`**：DSH（DeepSeek Harness）Web GUI 的跨工作区会话迁移插件，
目标运行时 **DSH 0.2.x**（桌面端 0.2.0-rc.2 起）。
双端架构：Host 半体（`lib/index.js`：`moveSession` 核心逻辑 + `webServer` HTTP 路由
`/api/dsh-move-session/move`）+ Client 半体（`lib/client.js`：`__ModuleLoader__` 浏览器捆绑包，
头部操作行按钮 + `sidebar.workspaces.session.menu.item` 行菜单项 + `shell.overlay` 迁移对话框）。
**源码即产物**：`lib/` 即运行时文件，零外部依赖、无构建步骤。组合行 id：`move-session`；
client bundle id = 包名。

## 角色分工

| 角色 | 职责 |
|------|------|
| 维护者 | 最终决策、`dsh web` 重启、正式安装（`dsh plugin add link:/file:`）、push 远程 |
| AI 助手 | 实现、测试、文档；**不得擅自 push 远程或改动 profile 配置** |

## 强制性规则

### 1. 版本号
- 当前 **v0.1.4**，保持 **0.1.x 递增**，禁止跳到 0.2.x
- **仅代码/功能改动才递增版本号**；纯文档/规则修改不递增，正常提交即可
- `package.json.version` 与 git tag `v0.1.x` 保持一致
- 每次版本提交前必须通过下方 2/3 项

### 2. 代码不变量（破坏即回归，必须测试护航）
- **store force 必须函数式更新**：`listeners[i](n => n + 1)`。裸 `force()` 会把状态置为
  `undefined`，之后每次调用被 React `Object.is` 快速跳过（bailout）→ 弹框永不重渲染
  （历史事故：v3 的"取消无效 + 按钮无法重开弹框"）
- **对话框关闭无条件**：`close()` 不得因 `busy` 而拒绝（迁移请求挂起时用户必须能关闭）
- **默认模式 `keep`**（保留原会话），`keep` 选项渲染在 `archive` 之前
- **宿主 `moveSession` 流程固定**：空闲校验 → flush live →
  **`sessionQuery.observeSession` 取一次不可变日志切面**（`{ header, events }`，用后必须释放
  `observation[Symbol.dispose]()`；官方分叉同一读法）→ 目标/同区校验 →
  **目标目录预检**（`workspace.status()`：非 `'ok'` → `target-missing-dir`，抛错同样归入该码，
  在任何写入前拒绝，不产生孤儿副本）→ `mintSessionId` 新 id（`session-mv-<time36>-<seq36>`）→
  `agents.create`（**`seed` = 全量事件、`inheritedEventCount` = 事件数、`meta.isSeeded: true`**，
  meta 带 cwd/parentSession/agentPreset/origin/delegationDepth）→ **同名标题后缀**
  （`sessionQuery.readTitleSnapshots(target.sessionIds)` 读目标区标题，同名时
  `sessionTitle.rename` 追加 `[MS<n>]`，`n` = 目标区已有 `[MS<n>]` 最大值 + 1；无同名/无法查询/
  已带标记时替换而非累积；失败一律降级不阻断）→ `attachSession` → 按模式 `archiveSession`
- **禁止 `meta.seedLength`**：DSH ≥ 0.2 的 session header 校验对该字段**直接抛错**
  （`session header has invalid field "seedLength"`），迁移会全量失败；继承语义改由
  `isSeeded` + `inheritedEventCount` 表达
- **禁止 `sessionPersistence.readFrom`**：DSH ≥ 0.2 的持久化服务只有
  `create/open/flush/stat/list`（按 `SessionHandle` 读日志）；读源日志一律走
  `sessionQuery.observeSession`
- **客户端只用官方插槽，禁止 DOM/fiber 注入**：会话行「…」菜单项注册进
  `sidebar.workspaces.session.menu.item`（`order: 500`，紧随官方 归档 400），用
  `useMenuOpenState` 收起菜单；不得再出现 `__reactFiber$` / `MutationObserver` /
  `data-dsh-ms-menu-item` / 本地化文案嗅探
- **三个注册都声明 `locale: NS`**：文案由框架注入的 `t` 座位提供（`props.t`），
  不得自建 `locale.subscribe` 翻译钩子
- **模型继承**：agentOptions 取日志最后一条 `request/header` 的 provider/model；**预设继承**：
  取最后一条 `agent-preset/selected` 事件，否则 header.agentPreset
- **客户端不得依赖 CSS 变量**：GUI 未定义 `--text-secondary` 等变量（实测），按钮用
  `color: inherit` + `opacity` 呈现层级；图标 `fill="currentColor"`
- **双语字典同步**：`zh`/`en` 字典 key 集必须完全一致（有结构测试护航）
- 动态插件版（演示用）与包插件版（`lib/`）逻辑必须一致；包插件版独有 DOM 注入（动态版无 DOM 权限）

### 3. 测试（每次变更必跑，全绿才可提交）
- **任何代码新增/优化必须配套测试**：已有同类测试则扩展，否则新建；无测试覆盖的改动视为未完成
- `npm run check` = 语法检查（`node --check lib/*.js`）+ 全部单元/结构测试（`node --test`）——
  **每次版本提交前必须全绿**
- **提交门禁已自动化**：`.githooks/pre-commit`（`git config core.hooksPath .githooks` 已设）会在
  每次 `git commit` 前自动执行 `npm run check`，失败阻止提交；`.github/workflows/ci.yml` 在
  push/PR 到 GitHub 后自动执行 `npm run check`。开发期可 `npm run test:watch`（文件变更自动重跑）
- `test/host.move.test.js`（node:test）—— `moveSession` 全契约：校验/拒绝路径、happy path
  （archive/keep）、预设/模型继承、id 唯一性、失败包装（copy-failed/attach-failed/preset-unavailable）、
  源日志切面租约释放、`isSeeded`/`inheritedEventCount` 与「无 `seedLength`」回归
- `test/client.bundle.test.js`（node:test）—— client 结构不变量：bundle 注册 id、字典 key 集、
  **force 函数式更新（禁止裸调用）**、无条件 close、默认 keep、三个插槽注册与 `locale: NS`、
  **禁止 DOM/fiber 注入残留**、图标与颜色
- `npm run test:ui`（Playwright，可选）—— 对话框交互与行菜单注入端到端（需本机浏览器）；
  `npm run test:integrity`（Python）—— 真实迁移日志逐事件一致性校验
- 修改 `lib/index.js` 的 `moveSession` 行为必须同步补/改 `test/host.move.test.js`；
  修改 `lib/client.js` 交互逻辑必须同步补/改 `test/client.bundle.test.js`

### 4. 提交与发布
- **提交必须用户明确指示**：AI 不得在迭代过程中自行 `git commit`；用户要求提交时统一
  `git add -A && git commit`（一个版本一个提交，信息描述代码改动）
- **push 远程 / npm publish / 正式安装（profile 配置变更）必须用户明确指示**，不自动执行
- 版本提交格式参考历史：`v0.1.x: <改动摘要>`
- 每次版本发布：`git tag v0.1.x`（与 package.json 同步）

**发布流程（维护者操作，README 不收录，以此为准）**：

```bash
# 发布前：npm run check 全绿；版本号已在 package.json 递增
npm run check

# GitHub（origin 需先配置 git@github.com:hucj09/dsh-move-session.git）
git push origin main
git tag v0.1.x && git push origin v0.1.x

# npm（本机 registry 是 npmmirror 镜像，发布必须临时指定官方源）
npm publish --registry=https://registry.npmjs.org        # 认证：~/.npmrc 中 granular token（bypass 2FA，仅限本包）
npm view @hucj/dsh-move-session version --registry=https://registry.npmjs.org   # 验证

# 版本递增：0.1.x（当前 0.1.1 → 下一 0.1.2）；每次发布前 npm run check
# 发布后：~/.dsh/profiles/web/pnpm-workspace.yaml 的 minimumReleaseAgeExclude 更新为新版本
#         （否则 2 天内 `dsh plugin add` 走 pnpm 会被 age 门槛拒绝）
# 撤销（72h 内）：npm unpublish @hucj/dsh-move-session@<版本号> --force
# 弃用（推荐替代）：npm deprecate @hucj/dsh-move-session@<版本号> "说明"
```

### 5. 文档同步（强制）
- **README.md 与 README.en.md 必须同步**：任何 README.md 修改必须同时更新 README.en.md
  对应内容（结构一致、内容对应翻译），两者一起提交
- README 顶部保留中英文互链
- 版本历史追加到 `docs/CHANGELOG.md`（README 不维护版本快照）

### 6. 命名与配置约定
- npm 包名 `@hucj/dsh-move-session`；插件组合行 id `move-session`；client bundle id = 包名
- 安装方式：开发调试用 `dsh plugin --profile web add link:<本目录>`（符号链接，改动即生效）；
  **正式安装用 `dsh plugin --profile web add file:<本目录>`（一次性拷贝）** 或 npm 发布后
  `dsh plugin --profile web add @hucj/dsh-move-session`；安装后重启 dsh web
- **桌面端（desktop profile）**：源码 CLI 与发布 CLI 都会拒绝 `--profile desktop`
  （`profile "desktop" is managed exclusively by the Electron application`）。只有两条正路：
  ① 应用内 **设置 → 插件**；② 应用自带 CLI 转发器
  `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add <spec>`
  （该 shim 以 `manageDesktopProfile: true` 运行，并带应用内 pnpm）。装完必须**完全退出并重启应用**
- **安装目录同步（file: 安装后每次代码改动必做）**：file: 为拷贝，源码后续改动不会自动同步。
  同步完整清单：`lib/index.js` `lib/client.js` `package.json` `cordis.patch.yml` `README.md` `README.en.md`；
  用 `Get-FileHash` 对比源与安装目录哈希一致
- `lib/index.js` 导出 `moveSession` 等纯函数供测试（插件面仍是 `name`/`inject`/`apply`）

### 7. 已知教训（避免重犯）
- **React bailout**：模块级 store 的通知必须用函数式 setter（见规则 2，事故 v3）
- **CSS 变量陷阱**：GUI 主题变量可能不存在或语义不符，别猜，用实测值或 inherit 方案
- **Playwright evaluate 与 <script> 行为差异**：跨 evaluate 的函数对象 realm 可能使
  `instanceof` 失效——测试注入代码用 `add_script_tag`（与真实 bundle 的加载路径一致）
- **Playwright 无授权页面不加载动态插件 client**：动态版 UI 验证需用户真实浏览器
- **headless 下 timer 不稳定**：MutationObserver 的 setTimeout debounce 与 setInterval 在
  headless Chromium 中经实测间歇失效（多次 6/6、5/5 失败对照实验），主题跟随改用 rAF 降频轮询
  （每 5 帧检查亮度，实测稳定）；测试脚本避免"多行缩进 evaluate + wait_for_function"组合
  （该写法在本环境不稳定，用单行拼接 evaluate + 直接读取）
- **zstd 解压**：会话日志是 `session.v4.jsonl.zstd`，需流式解压（`stream_reader`）
- **DSH 0.2 API 漂移（v0.1.4 适配根因，勿回退）**：`sessionPersistence.readFrom` 已删除
  （改 `sessionQuery.observeSession`）；session header 对 `seedLength` **抛错**
  （改 `isSeeded` + `inheritedEventCount`）；侧边栏会话行菜单从"无插槽需 DOM 注入"变为
  官方插槽 `sidebar.workspaces.session.menu.item`；客户端 `sessions.open` 已删除
  （改 `uiWorkspace.openSession`）
- **Playwright + dsh Web 实测经验**：页面 URL 必须先带 `?token=`（`dsh web` 启动日志打印）；
  首次进入有"预发布说明"模态，需 `document.querySelector('[role="dialog"] button').click()` 放行；
  侧边栏工作区默认折叠，要用 `[role="treeitem"][aria-expanded="false"]` 展开才能拿到会话行；
  **空白会话（无任何用户消息）每个工作区只显示一条**，验证头部按钮需用有对话的会话做种子

## 约定

- 零外部依赖：纯手写 JS，ESM（`"type": "module"`），Node >= 22；测试用 `node:test` + `node:assert/strict`
- 注释与提交信息用中文；设计细节写进 README「工作原理」或本文件
- 路径统一；`scripts/` 为辅助脚本（Playwright 交互测试、日志校验），`test/` 为 `node --test` 测试
- 版本历史与发布记录见 `docs/CHANGELOG.md`（本文件不维护「当前状态」快照）
