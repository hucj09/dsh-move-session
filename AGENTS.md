# AGENTS.md —— dsh-move-session 协作规则

本文档为 AI 编码助手与本仓库维护者协作时的**规则与约束**，是本项目规则的**唯一维护来源**。

**文档分工（严格）**：
- **README.md / README.en.md** —— 面向**使用者**的教程与说明（功能、安装、使用、限制）；两文件必须同步（见规则 6）
- **AGENTS.md** —— 面向**维护者与 AI 助手**的工作规则（版本、测试、提交、代码不变量），本文档
- **docs/CHANGELOG.md** —— 版本历史与发布记录

## 项目定位

插件包 **`@hucj/dsh-move-session`**：DSH（DeepSeek Harness）Web GUI 的跨工作区会话迁移插件。
双端架构：Host 半体（`lib/index.js`：`moveSession` 核心逻辑 + `webServer` HTTP 路由
`/api/dsh-move-session/move`）+ Client 半体（`lib/client.js`：`__ModuleLoader__` 浏览器捆绑包，
头部操作行按钮 + `shell.overlay` 迁移对话框 + 侧边栏行菜单注入）。**源码即产物**：`lib/` 即运行时文件，
零外部依赖、无构建步骤。组合行 id：`move-session`；client bundle id = 包名。

## 角色分工

| 角色 | 职责 |
|------|------|
| 维护者 | 最终决策、`dsh web` 重启、正式安装（`dsh plugin add link:`）、push 远程 |
| AI 助手 | 实现、测试、文档；**不得擅自 push 远程或改动 profile 配置** |

## 强制性规则

### 1. 版本号
- 当前 **v0.1.0**，保持 **0.1.x 递增**，禁止跳到 0.2.x
- **仅代码/功能改动才递增版本号**；纯文档/规则修改不递增，正常提交即可
- `package.json.version` 与 git tag `v0.1.x` 保持一致
- 每次版本提交前必须通过下方 2/3 项

### 2. 代码不变量（破坏即回归，必须测试护航）
- **store force 必须函数式更新**：`listeners[i](n => n + 1)`。裸 `force()` 会把状态置为
  `undefined`，之后每次调用被 React `Object.is` 快速跳过（bailout）→ 弹框永不重渲染
  （历史事故：v3 的"取消无效 + 按钮无法重开弹框"）
- **对话框关闭无条件**：`close()` 不得因 `busy` 而拒绝（迁移请求挂起时用户必须能关闭）
- **默认模式 `keep`**（保留原会话），`keep` 选项渲染在 `archive` 之前
- **宿主 `moveSession` 流程固定**：空闲校验 → flush live → `readFrom(0)` 全量日志 → 目标/同区校验 →
  `mintSessionId` 新 id（`session-mv-<time36>-<seq36>`）→ `agents.create`（seed=全量事件，
  meta 带 cwd/parentSession/seedLength/agentPreset/origin/delegationDepth）→ `attachSession` →
  按模式 `archiveSession`
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
- `test/host.move.test.js`（node:test）—— `moveSession` 全契约：校验/拒绝路径、happy path
  （archive/keep）、预设/模型继承、id 唯一性、失败包装（copy-failed/attach-failed/preset-unavailable）
- `test/client.bundle.test.js`（node:test）—— client 结构不变量：bundle 注册 id、字典 key 集、
  **force 函数式更新（禁止裸调用）**、无条件 close、默认 keep、注入锚点、图标与颜色
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

# 版本递增：0.1.x（当前 0.1.0 → 下一 0.1.1）；每次发布前 npm run check
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
- 安装方式（正式版，维护者操作）：`dsh plugin --profile web add link:<本目录>` + 重启 dsh
- `lib/index.js` 导出 `moveSession` 等纯函数供测试（插件面仍是 `name`/`inject`/`apply`）

### 7. 已知教训（避免重犯）
- **React bailout**：模块级 store 的通知必须用函数式 setter（见规则 2，事故 v3）
- **CSS 变量陷阱**：GUI 主题变量可能不存在或语义不符，别猜，用实测值或 inherit 方案
- **Playwright evaluate 与 <script> 行为差异**：跨 evaluate 的函数对象 realm 可能使
  `instanceof` 失效——测试注入代码用 `add_script_tag`（与真实 bundle 的加载路径一致）
- **Playwright 无授权页面不加载动态插件 client**：动态版 UI 验证需用户真实浏览器
- **zstd 解压**：会话日志是 `session.jsonl.zstd`，需流式解压（`stream_reader`）

## 约定

- 零外部依赖：纯手写 JS，ESM（`"type": "module"`），Node >= 22；测试用 `node:test` + `node:assert/strict`
- 注释与提交信息用中文；设计细节写进 README「工作原理」或本文件
- 路径统一；`scripts/` 为辅助脚本（Playwright 交互测试、日志校验），`test/` 为 `node --test` 测试
- 版本历史与发布记录见 `docs/CHANGELOG.md`（本文件不维护「当前状态」快照）
