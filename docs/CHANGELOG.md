# Changelog

`@hucj/dsh-move-session` 版本历史与发布记录（维护者视角；使用者文档见 README.md）。

仓库：https://github.com/hucj09/dsh-move-session
发布渠道：npm（官方源）+ GitHub（main + tag v0.1.x）

---

## v0.1.5（2026-10-14 · 待发布）

迁移后的副本改为**在目标工作区置顶显示**（`pinOnMove`，默认开）。

- **发布物补全**：`package.json.files` 增加 `docs/images`——README 引用的 `example1.png` 此前
  不在发布物里，npm 包页面上是裂图（v0.1.3 起如此）；现随包发布（约 +383KB）。
- **现象**：迁移成功后，副本排在目标工作区**最底部**。
- **实测结论（隔离 `DSH_HOME` + 真实桌面 CLI 0.2.0-rc.2）**：副本的 `updatedAt` **本来就是迁移
  时刻**（`session/list` 返回迁移那一刻，行上显示「刚刚」），时间无需"刷新"；位置完全由侧边栏
  **排序方式**决定——默认的 `最近更新` 下副本已在最前，而**手动排序**下 DSH 把"已知成员"排在
  前、把"首次出现的成员"追加到末尾（`reconcileManualOrder` = `[置顶, 已保存顺序, 新成员按时间,
  已归档]`）。官方唯一的例外是"分叉子会话插到父会话紧前面"，但跨工作区迁移的源会话不在同一分组，
  这条例外不触发。手动序存在浏览器 localStorage，宿主侧无法改写。
  已从用户桌面端 leveldb（`dsh.workspace.view.v5`）确认其设置为 `"orderBy":"manual"`。
- **修复**：迁移流程在 `attachSession` 之后、`archiveSession` 之前调用
  `workspaceRegistry.pinSession(newId)`。registry 全局置顶集合是**两种排序模式都会读取**的唯一
  杠杆（`reconcileManualOrder` 把置顶集合排在最前）。置顶失败**不阻断**已完成迁移
  （副本已创建并记账），HTTP 响应新增 `pinned` 字段。
- **可关闭**：新增插件部署选项 **`config.pinOnMove`（默认 `true`）**，经
  `resolveOptions(config)` 在激活时解析一次（非法配置使插件加载失败，fail loud），
  `moveSession(ctx, input, options)` 本身不做默认。在 profile 的 patch 层给该行加
  `config: { pinOnMove: false }` 即可恢复"副本按目标区原排序落到末尾"。注意置顶会像手动置顶一样
  保留在置顶集合里，需手动取消。
- **实测验证**：手动排序下迁移前后对比——迁移前 DST = `[新会话, A, B, C]`；迁移后
  DST = `[新会话, session-mv-…(刚刚), A, B, C]`，且 `pinnedSessionIds` 增加该副本；
  加 `pinOnMove: false` 覆盖层重启后同一迁移返回 `"pinned":false` 且置顶集合保持为空。
- **测试**：`node --test` **69 用例**（新增 `resolveOptions` 默认/显式/非法三组、置顶开关、
  attach→pin→archive 顺序、置顶失败不阻断迁移）；`npm run check` 全绿。

## v0.1.4（2026-10-14 · 已提交）

**适配 DSH 0.2.x（桌面端 0.2.0-rc.2 实测）**。v0.1.3 在新版上"装得上、跑不通"：宿主路由
每次迁移都返回 `session-not-found`，实测报错 `persistence.readFrom is not a function`。

- **宿主端 · 源日志读取重写（根因）**：DSH ≥ 0.2 的 `sessionPersistence` 只提供
  `create/open/flush/stat/list`（日志按 `SessionHandle` 读），旧的 `readFrom(id, 0)` 已不存在。
  改为 `sessionQuery.observeSession(id)` —— 官方分叉同一读法（live 优先、冷读安全、补齐中断
  turn 收尾），并在 `finally` 释放观察租约（`observation[Symbol.dispose]()`）
- **宿主端 · 副本血缘重写（第二根因）**：DSH ≥ 0.2 的 session header 校验遇 `meta.seedLength`
  **直接抛错**（`session header has invalid field "seedLength"`），迁移必然 `copy-failed`。
  改为官方分叉语义：`meta.isSeeded: true` + 顶层 `inheritedEventCount`(= 全量源事件数)，
  由 `Session` 构造函数在切点补 `session/end-seed { inherited: true }` 标记
- **宿主端 · 目标目录预检**：由 `fs.resolve`+`fs.stat` 改为 `workspace.status()`
  （工作区实体自带契约，返回 `'ok' | 'missing-dir'`，不经 sandbox 策略），错误码仍为
  `target-missing-dir`、仍在任何写入前拒绝；`fs` 服务不再被使用
- **宿主端 · 必需服务**：由 agents/sessionPersistence/workspaceRegistry 改为
  agents/sessionQuery/workspaceRegistry（`sessionPersistence` 不再直接依赖）
- **客户端 · 会话行菜单改为官方插槽（去 Hack）**：DSH 0.2 新增
  `sidebar.workspaces.session.menu.item` 插槽，旧版"点击捕获 + `__reactFiber$` 恢复会话 id +
  MutationObserver 观察 portal 菜单 + 中英文案嗅探"整套 DOM 注入删除，改为
  `slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'move-session', order: 500, locale: NS })`
  （紧随官方 归档 400），并用插槽注入的 `useMenuOpenState` 收起菜单
- **客户端 · 文案改走框架座位**：三个注册均声明 `locale: NS`，组件用框架注入的 `props.t`
  （跟随语言切换自动重渲染）；自建 `useT()` + `locale.subscribe` 机制删除
- **客户端 · 打开迁移后的会话**：客户端 `sessions.open` 已删除，改 `uiWorkspace.openSession(id)`，
  并在调用前有界等待副本出现在会话列表（副本经 `host/session-added` 到达，存在时延）
- **客户端 · 依赖声明**：`exports.inject` 由 `['slots','sessions','locale']` 改为
  `['slots','sessions','locale','uiWorkspace']`
- **测试**：`node --test` 62 用例（新增源日志租约释放、切面读取失败包裹、`isSeeded`/
  `inheritedEventCount`、「无 `seedLength`」回归、三插槽注册与 `locale: NS`、
  「禁止 DOM/fiber 注入残留」结构断言）；`npm run check` 全绿
- **实测验证（隔离 `DSH_HOME`，真实桌面 CLI 0.2.0-rc.2 运行时）**：keep 迁移 → 副本 26 条正文
  事件**逐字节一致** + 1 枚继承标记、header 新 id/目标 cwd/`isSeeded`/`parentSession`/预设/
  `origin`/`delegationDepth` 全部正确、`attachSession` 落到目标工作区；archive 迁移 → 源进入
  `archivedSessionIds`、同名副本标题追加 `[MS1]`；浏览器端（Playwright）头部按钮 迁移会话 可点、
  会话行「…」菜单出现 迁移会话 项且点击后菜单收起、对话框目标工作区/保留优先默认/成功面板
  「打开迁移后的会话」全部正常，控制台零错误

## v0.1.3（2026-08-16 · 待发布）

重新发布（无功能改动）：

- **许可证改为 MIT**：`LICENSE` 全文、`package.json.license`、双语 README 同步（此前为 BSD-3-Clause）
- **发布物清理**：README 安装示例不再出现本地路径（`link:/path/to/dsh-move-session` 占位符）；
  Playwright 测试脚本 React UMD 路径改 `~` 动态解析（消除 `C:\Users\hu` 硬编码）
- 因 v0.1.2 tarball 快照仍含旧 README/许可信息，故递增版本重新发布

## v0.1.2（2026-08-16 · 已发布）

修复「打开迁移后的会话」按钮失效（keep 模式成功面板）：

- **根因**：成功面板「打开迁移后的会话」onClick 先 `setState({ open: false, done: null, ... })`
  再读 `dialog.done.sessionId`——`dialog` 是模块级 state 对象的**同一引用**，此时 `done` 已被置
  null，读取抛 TypeError，`openSession` 从未执行，视图停留在原会话；归档模式自动跳转读
  `result.sessionId`（不经共享 state）故不受影响
- **修复**：先 `var doneSessionId = dialog.done.sessionId` 缓存 id，再清空状态，最后
  `openSession(doneSessionId, ...)`
- **回归防护**：`test/client.bundle.test.js` 新增结构用例（断言 onClick 内 `done.sessionId`
  读取必须先于 `setState({ open: false, done: null, ... })`，`node --test` 55 用例全绿）；
  Playwright 新增 keep 模式成功面板端到端场景（提交 → 成功面板 → 点击打开 →
  `window.__openCalls` 含新会话 id 且对话框关闭，且 keep 模式不会自动跳转）

## v0.1.1（2026-08-16 · 未单独发布，并入 v0.1.2）

发布前修复与增强批次：

- **目标目录预检**：迁移创建副本前用宿主 `fs` 服务校验目标工作区目录真实存在（失效注册如
  Temp 目录被清理 → `target-missing-dir`，在任何写入前拒绝，不产生孤儿副本）
- **行菜单注入仅限会话行**：工作区行操作菜单不再注入「迁移会话」——点击捕获记录行类型
  （fiber 无 `node.id` 即工作区行）+ 菜单判定排除工作区菜单双保险；顺带修复 fiber 链遍历
  的 `undefined` 判空（`!= null`）
- **行菜单注入项运行中禁用**：从会话行 fiber 的 `node.running` 读取运行状态，运行中会话的
  「迁移会话」菜单项置灰并带提示（与顶部按钮禁用逻辑一致）
- **弹窗明暗主题跟随**：GUI 无 `--surface/--text-*` 变量，改为读取 body 背景亮度判定明暗，
  自有调色板发布为 `--dsh-ms-*` 变量；rAF 降频轮询跟随主题切换 + 弹窗每次打开时同步刷新
- **副标题当前会话前缀**：弹窗副标题显示「当前会话：{标题}」（Current session: {title}，双语）
- **同名会话区分**：仅当目标工作区存在同名会话时，副本标题追加 `[MS<n>]`（如 `我的会话 [MS1]`，
  `n` 为目标区已有标记最大值 + 1，重复迁移递增不冲突；已带标记副本再迁移时替换而非累积；
  无同名保持原标题）。与分叉数字后缀 ` (1)`/`（1）` 不同；目标工作区列表独立滚动
  （max-height 240px，工作区过多时头部与操作按钮保持固定）
- **测试**：`node --test` 54 用例；Playwright 交互测试（对话框 + 行菜单注入 + 主题跟随）

## v0.1.0（2026-08-16 · 未单独发布，并入 v0.1.1）

首个版本：跨工作区会话迁移插件（dsh Web GUI）。

- **功能**：会话头部操作行「迁移会话」按钮（图标+文字，中英双语）；侧边栏会话行「…」菜单注入
  「迁移会话」项（正式安装版）；目标工作区单选 + 保留/归档原会话单选（默认保留）；仅空闲会话可迁移。
- **迁移语义**：完整事件日志逐事件复制（消息、工具调用、chunk 流、标题、预设选择、模型选择），
  新会话 id + `parentSession` 血缘；副本经 `agents.create` 发布为 live（官方分叉同路径），
  跨标签页即时刷新（`host/session-added` / `host/workspace-changed` / `host/archived-sessions-changed`）。
- **架构**：双端零依赖纯 JS 包（`lib/index.js` 宿主 + `lib/client.js` 浏览器 bundle，源码即产物），
  热插拔挂载（`cordis.patch.yml`），不改 dsh 源码。
- **自定义图标**：用户提供的填充式 SVG（文件夹+移动箭头），`fill="currentColor"` 适配明暗主题。
- **UI 修复历程**（动态演示迭代）：React store force 函数式更新（修复取消无效/弹框无法重开的
  bailout 事故）；close 无条件；默认保留原会话；按钮颜色改 inherit+opacity（GUI 无
  `--text-secondary` 变量）。
- **目标目录预检**（发布前修复）：迁移创建副本前用宿主 `fs` 服务校验目标工作区目录真实存在
  （失效注册如 Temp 目录被清理 → `target-missing-dir`，在任何写入前拒绝，不产生孤儿副本）。
- **行菜单注入仅限会话行**（发布前修复）：工作区行操作菜单（含"重命名工作区/删除工作区"）不再
  注入「迁移会话」——点击捕获记录行类型（fiber 无 `node.id` 即工作区行）+ 菜单判定排除工作区菜单
  双保险；顺带修复 fiber 链遍历的 `undefined` 判空（`!= null`）。
- **行菜单注入项运行中禁用**（发布前修复）：从会话行 fiber 的 `node.running` 读取运行状态，
  运行中的会话其「迁移会话」菜单项置灰并带提示（与顶部按钮禁用逻辑一致）。
- **弹窗明暗主题跟随**（发布前新增）：GUI 无 `--surface/--text-*` 变量，改为读取 body 背景
  亮度判定明暗，将自有调色板发布为 `--dsh-ms-*` 变量；rAF 降频轮询跟随主题切换（MutationObserver
  debounce 与 setInterval 在 headless 下经实测不稳定）+ 弹窗每次打开时同步刷新，深浅两套
  调色板（背景/文字/边框/主色/错误色/阴影）。
- **测试**：`node --test` 41 用例（宿主 `moveSession` 全契约 + 客户端结构不变量）；
  Playwright 交互测试（对话框 + 行菜单注入 + 主题跟随）；真实迁移日志逐事件一致性校验（Python）。
- **验证**：真实迁移数据逐事件对比——源 1042 事件 + 212 chunk 记录 100% 保留。
