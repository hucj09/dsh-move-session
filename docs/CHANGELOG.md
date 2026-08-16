# Changelog

版本历史与发布记录。规则：仅代码/功能改动递增版本（见 AGENTS.md 规则 1）。

## v0.1.0 (2026-08-16)

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
- **测试**：`node --test` 33 用例（宿主 `moveSession` 全契约 + 客户端结构不变量）；
  Playwright 交互测试（对话框 + 行菜单注入）；真实迁移日志逐事件一致性校验（Python）。
- **验证**：真实迁移数据逐事件对比——源 1042 事件 + 212 chunk 记录 100% 保留。
