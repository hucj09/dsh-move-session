# dsh-move-session

English | [中文](README.md)

Cross-workspace session migration plugin for the dsh Web GUI. Adds a **Move Session** entry to the
session operations: copy the current session **as-is** into another workspace (full conversation
log, title, agent preset and model selection preserved), with a choice to **keep the original** or
**archive the original**. Only **idle** sessions can be moved.

> Current version **v0.1.0**. Same hot-pluggable convention as `dsh-ssh` / `dsh-task-board`:
> mounted via `cordis.patch.yml` + a profile `node_modules` symlink, **no dsh source changes**.
> Zero-dependency plain JavaScript, **source-as-artifact** (`lib/` is the runtime code), no build step.

---

## Features

| Requirement | Implementation |
| --- | --- |
| 1. "Move Session" among session operations | ① **Move Session** button in the session header action row (icon + label, alongside agent preset / subagent catalog / job list); ② a **Move Session** entry injected into the sidebar session-row "…" menu (after rename / fork / archive; installed package only) |
| 2. Move as-is to another workspace, full context | The complete event log is copied verbatim (messages, tool calls, title, agent-preset/selected, request/header and every other event), recorded as a new session in the target workspace |
| 3. Keep or archive the original | Radio choice in the dialog: `Keep the original session` (default) or `Archive the original session` |
| 4. Proper UI interaction | Icon+label button → modal dialog (target workspace picker + mode picker + error/success states), auto-navigate or offer to open the moved session; all text follows the GUI language (zh/en) |

Other details:

- **Idle-only**: while the session is running the button is disabled and the host re-validates.
- **Cross-tab refresh**: the copy is published via `agents.create` (same path as the shipped fork),
  which pushes `host/session-added`; `attachSession` pushes `host/workspace-changed`; archiving
  pushes `host/archived-sessions-changed` — every tab's sidebar updates instantly.
- **Model & preset inheritance**: `agentOptions` come from the last `request/header` in the source
  log (better than the shipped fork's "current default model"); the agent world is composed from the
  source's preset (last `agent-preset/selected` event, else `header.agentPreset`).
- **Lineage preserved**: the copy header records `parentSession` = source id and
  `seedLength` = full event count, matching the shipped fork lineage semantics; timestamps and
  event order are preserved byte-for-byte.
- **Session-safe**: the copy gets a fresh id (`session-mv-<time36>-<seq36>`); nothing is
  overwritten or deleted; keep-mode leaves the source untouched.

---

## Install

### Option 1: after npm release (recommended)

```bash
dsh plugin --profile web add @hucj/dsh-move-session
```

### Option 2: local path (development)

```bash
git clone git@github.com:hucj09/dsh-move-session.git   # or use the existing source directory
cd dsh-move-session
npm run check     # syntax check + all unit/structural tests (zero build — lib/ is the artifact)
```

Then install:

```bash
dsh plugin --profile web add link:/path/to/dsh-move-session
```

`link:` installs a **symlink**: after changing the source, re-run `npm run check` and restart dsh.
(`file:` installs a one-time copy instead; later source changes are not synced automatically.)

After installing, **restart dsh web** (new bundles only load on next start) and hard-refresh with
**Ctrl+F5**; open any session — the header action row showing the "Move Session" button means the
install succeeded.

> Note: `dsh.client.inject` is empty; the plugin itself declares
> `inject: ['slots', 'sessions', 'locale']` as hard dependencies, so the host needs the standard
> web runtime (`@deepseek-ai/dsh-client-runtime` etc., present in default deployments).

## Uninstall

```bash
dsh plugin --profile web remove @hucj/dsh-move-session
```

The command does three things:
1. removes the dependency from `dependencies`
2. removes the bundle row from `dsh.profile.bundles`
3. deletes the `node_modules/@hucj/dsh-move-session` install directory

Then **restart dsh web**.

---

## Usage

1. Open an **idle** session.
2. Click the **Move Session** button in the session header action row (the sidebar session-row
   "…" menu also has a **Move Session** entry).
3. Pick the target workspace (the current workspace is excluded; path and session count shown).
4. Choose what happens to the original:
   - **Keep the original session** (default): the source stays untouched, a full copy is created
     in the target workspace, with an "Open moved session" action;
   - **Archive the original session**: the source enters the archive set (hidden from all grouping
     surfaces; log and accounting retained) and the view navigates to the moved session.
5. The sidebar updates instantly; the copy's title, messages, tool calls, model and preset match
   the source.

---

## How it works (brief)

- **Host half** (`lib/index.js`): a loopback-only HTTP route `POST /api/dsh-move-session/move`,
  mirroring the shipped `session.fork` handler step by step: idle check → flush + read the full
  log → target/same-workspace validation → mint a new identity (fresh id + target cwd + lineage) →
  `agents.create` publishes the copy (seed = all events, setup composes the source preset via
  `agentPresets.resolve/mount`) → `attachSession` accounting → `archiveSession` on request.
- **Browser half** (`lib/client.js`): a standard web plugin bundle registering into the
  `conversation.session.header.actions` button slot and the `shell.overlay` dialog slot (both
  official additive slots, `replaceRisk: none`); the sidebar row-menu entry is injected via ARIA
  role anchors (the official menu is a portaled `[role="menu"]`; the session id is recovered from
  the row's React fiber) — no dependency on official CSS class names.
- **Log integrity**: migration copies the full log event by event; run
  `npm run test:integrity` to verify any source/copy pair (real-data check: 1042 events + 212
  chunk records preserved 100%).

---

## Development & testing

```bash
npm run check          # syntax check + all unit/structural tests (node --test); must be green before commits
npm run test:ui        # Playwright interaction tests (dialog + row-menu injection; needs a local browser)
npm run test:integrity # real migration log event-level consistency check (Python)
```

Collaboration rules for maintainers and AI assistants live in **AGENTS.md** (versioning, testing,
commits, code invariants); release history in **docs/CHANGELOG.md**.

---

## Error codes

| code | meaning |
| --- | --- |
| `invalid-session` / `invalid-target` / `invalid-mode` | missing or invalid request parameters |
| `unavailable` | required host services not mounted (agents / sessionPersistence / workspaceRegistry) |
| `session-busy` | session is running; only idle sessions can be moved |
| `session-not-found` | session absent from session persistence |
| `target-not-found` | target workspace does not exist |
| `same-workspace` | session already belongs to the target workspace |
| `preset-unavailable` | source agent preset cannot be resolved (no writes happen) |
| `copy-failed` | copy creation failed (incl. unbalanced-log seed validation) |
| `attach-failed` | copy created but workspace accounting failed (same semantics as the shipped fork) |
| `internal` | unexpected error |

---

## Limits & boundaries

- Only **idle** sessions can be moved; the client disables the button while running and the host
  rejects as well.
- The source log must be **balanced** (no open turn/step or dangling tool call) — idle sessions
  satisfy this naturally; otherwise the copy creation is rejected by dsh's seed validation (same
  strictness as the shipped fork).
- The session id changes (`session-mv-*`): a necessary consequence of copy semantics — dsh keys
  persistence by id, and a duplicate id across workspaces would corrupt lists/accounting. Lineage
  is kept via `parentSession`.
- The copy stays live (idle agent) in memory, like a shipped fork child; it does not die with this
  plugin.
- Only the **session log** is copied; attachments/files are unaffected (attachments are read on
  demand; the references in the log are preserved).
- "Archive the original" uses the registry-global archive set (same mechanism as the sidebar
  archive action); the unarchive position is retained, but this plugin provides no unarchive entry
  (consistent with the official UI).

---

## License

BSD-3-Clause
