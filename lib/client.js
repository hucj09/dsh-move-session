/**
 * dsh-move-session — browser half (web plugin bundle).
 *
 * Served by the dsh web GUI from the `exports["./client"]` artifact, which the
 * client module system loads through `window.__ModuleLoader__.load` and keys by
 * the package name. Three additive UI contributions, all through documented
 * slots (`replaceRisk: none`):
 *
 *   - `conversation.session.header.actions` id "move-session":
 *     an icon+label header action button (beside agent preset / subagent
 *     catalog / job list) that opens the move dialog. Disabled while the
 *     session runs or when no other workspace exists.
 *   - `sidebar.workspaces.session.menu.item` id "move-session":
 *     the "Move Session" row of a session's "…" menu, placed by `order`
 *     beside the shipped pin/rename/fork/archive rows. The slot hands the row
 *     identity and the menu's open-state pair; the entry dismisses the menu
 *     through `useMenuOpenState`.
 *   - `shell.overlay` id "move-session-dialog":
 *     the migration dialog: target workspace picker (excluding the current
 *     workspace) + keep-or-archive choice. On success with "archive" it
 *     navigates to the moved session; with "keep" it offers to open it.
 *
 * The host half is reached over the loopback HTTP route
 * POST /api/dsh-move-session/move (the webServer pattern).
 *
 * All user-facing text is localized: the dictionaries register under the
 * `move-session` namespace and every registration declares `locale: NS`, so
 * the framework hands the component its `t` seat (which follows the GUI
 * language without re-registering).
 */
window.__ModuleLoader__.load({
  id: '@hucj/dsh-move-session',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var React = require('react')
    var h = React.createElement

    var API_PATH = '/api/dsh-move-session/move'
    var NS = 'move-session'

    /* ------------------------------------------------------------ */
    /* locale dictionaries                                           */
    /* ------------------------------------------------------------ */
    var DICT = {
      zh: {
        'action.move': '迁移会话',
        'menu.move': '迁移会话',
        'hint.running': '会话运行中，仅空闲会话可迁移',
        'hint.noTarget': '没有其他可迁移的工作区',
        'hint.default': '迁移会话',
        'dialog.title': '迁移会话',
        'dialog.currentSession': '当前会话：',
        'dialog.note': '仅支持空闲会话迁移。完整对话记录、标题与 Agent 预设都会保留。',
        'dialog.target': '目标工作区',
        'dialog.original': '原会话处理',
        'dialog.archive': '归档原会话',
        'dialog.archiveHint': '源会话归档，视图自动切换到迁移后的会话。',
        'dialog.keep': '保留原会话',
        'dialog.keepHint': '源会话保持不变，在目标工作区创建完整副本（默认）。',
        'dialog.empty': '没有其他可用工作区，请先在侧边栏添加。',
        'dialog.cancel': '取消',
        'dialog.confirm': '迁移',
        'dialog.busy': '迁移中…',
        'dialog.success.title': '迁移成功',
        'dialog.success.detail': '副本已创建于「{workspace}」，完整保留了会话上下文。',
        'dialog.success.open': '打开迁移后的会话',
        'dialog.success.stay': '留在此处',
        'dialog.error.openFailed': '打开迁移后的会话失败：',
        'dialog.error.moveFailed': '迁移失败：',
        'error.sessionBusy': '会话正在运行，仅空闲会话可迁移。',
        'error.noTarget': '没有其他可迁移的工作区。',
      },
      en: {
        'action.move': 'Move Session',
        'menu.move': 'Move Session',
        'hint.running': 'Session is running — only idle sessions can be moved',
        'hint.noTarget': 'No other workspace to move to',
        'hint.default': 'Move Session',
        'dialog.title': 'Move Session',
        'dialog.currentSession': 'Current session: ',
        'dialog.note': 'Only idle sessions can be moved. The full conversation log, title and agent preset are preserved.',
        'dialog.target': 'Target workspace',
        'dialog.original': 'Original session',
        'dialog.archive': 'Archive the original session',
        'dialog.archiveHint': 'The source is archived and the view moves to the migrated session.',
        'dialog.keep': 'Keep the original session',
        'dialog.keepHint': 'The source stays untouched; a full copy is created in the target workspace (default).',
        'dialog.empty': 'No other workspace available — add one from the sidebar first.',
        'dialog.cancel': 'Cancel',
        'dialog.confirm': 'Move',
        'dialog.busy': 'Moving…',
        'dialog.success.title': 'Moved',
        'dialog.success.detail': 'The copy now lives in 「{workspace}」 with the full conversation context.',
        'dialog.success.open': 'Open moved session',
        'dialog.success.stay': 'Stay here',
        'dialog.error.openFailed': 'Opening the moved session failed: ',
        'dialog.error.moveFailed': 'Move failed: ',
        'error.sessionBusy': 'The session is currently running; only idle sessions can be moved.',
        'error.noTarget': 'No other workspace to move to.',
      },
    }

    /* ------------------------------------------------------------ */
    /* tiny shared store: the header button and the overlay dialog   */
    /* ------------------------------------------------------------ */
    var state = { open: false, sessionId: null, busy: false, error: null, done: null }
    var listeners = []

    function setState(patch) {
      for (var key in patch) state[key] = patch[key]
      // functional update: a bare force() call would set the state to
      // undefined on the first render and be Object.is-bailed out on every
      // later call, so the dialog would never re-render (Cancel dead, button
      // cannot reopen) — this is the pkg-10 critical fix.
      for (var i = 0; i < listeners.length; i++) listeners[i](function (n) { return n + 1 })
    }

    /** React hook over the shared store (useState + useEffect only). */
    function useDialogState() {
      var force = React.useState(0)[1]
      React.useEffect(function () {
        listeners.push(force)
        return function () {
          var index = listeners.indexOf(force)
          if (index !== -1) listeners.splice(index, 1)
        }
      }, [])
      return state
    }

    /* ------------------------------------------------------------ */
    /* host call                                                     */
    /* ------------------------------------------------------------ */
    function moveSession(sessionId, targetWorkspaceId, mode) {
      return fetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId, targetWorkspaceId: targetWorkspaceId, mode: mode }),
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return null
            })
            .then(function (body) {
              if (!response.ok) {
                var httpError = new Error((body && body.error) || 'HTTP ' + response.status)
                throw httpError
              }
              if (!body || body.ok !== true) {
                var businessError = new Error((body && body.error) || 'move session failed')
                businessError.code = (body && body.code) || 'unknown'
                throw businessError
              }
              return body
            })
        })
    }

    /* ------------------------------------------------------------ */
    /* shared derivations over the standard hooks                    */
    /* ------------------------------------------------------------ */
    /** The workspace owning `sessionId`, or undefined while the list has not loaded it. */
    function sourceWorkspaceOf(snapshot, sessionId) {
      if (!snapshot || !snapshot.items) return undefined
      return snapshot.items.find(function (workspace) { return workspace.sessionIds.indexOf(sessionId) !== -1 })
    }

    /** Every workspace except the one owning `sessionId`. */
    function targetsOf(snapshot, sessionId) {
      if (!snapshot || !snapshot.items) return []
      var source = sourceWorkspaceOf(snapshot, sessionId)
      return snapshot.items.filter(function (workspace) { return workspace.workspaceId !== (source && source.workspaceId) })
    }

    /* ------------------------------------------------------------ */
    /* header action button (icon + label)                           */
    /* ------------------------------------------------------------ */
    function MoveSessionButton(props) {
      var t = props.t
      var sessionId = props.sessionId
      var running = props.useSession(function (snapshot) { return snapshot.running })
      var targets = props.useWorkspaces(function (snapshot) { return targetsOf(snapshot, sessionId) })
      var disabled = running || targets.length === 0
      var title = running ? t('hint.running') : targets.length === 0 ? t('hint.noTarget') : t('hint.default')
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-ms-header-button',
          title: title,
          'aria-label': t('action.move'),
          disabled: disabled,
          onClick: function (event) {
            event.stopPropagation()
            setState({ open: true, sessionId: sessionId, busy: false, error: null, done: null })
          },
        },
        h(
          'svg',
          {
            className: 'dsh-ms-header-icon',
            width: 14,
            height: 14,
            viewBox: '0 0 1024 1024',
            fill: 'currentColor',
            'aria-hidden': 'true',
          },
          h('path', { d: 'M958.73231 320.939026h-31.957317a31.957317 31.957317 0 0 1-31.957317-31.957317V257.024392a63.914634 63.914634 0 0 0-63.914634-63.914634H525.391092a31.957317 31.957317 0 0 1-30.039878-21.730976l-42.183659-127.829268a63.914634 63.914634 0 0 0-63.914634-43.461951H63.927434A63.914634 63.914634 0 0 0 0.0128 65.28049v703.060974a63.914634 63.914634 0 0 0 63.914634 63.914634h31.957317a31.957317 31.957317 0 0 1 31.957317 31.957317V960.085366a63.914634 63.914634 0 0 0 63.914634 63.914634h766.975608a63.914634 63.914634 0 0 0 63.914634-63.914634V384.85366a63.914634 63.914634 0 0 0-63.914634-63.914634zM63.927434 225.067075V129.195124a63.914634 63.914634 0 0 1 63.914634-63.914634h241.597317a31.957317 31.957317 0 0 1 30.039878 21.730975L447.415238 235.293416a32.596463 32.596463 0 0 0 31.957317 21.730976h319.57317a31.957317 31.957317 0 0 1 31.957317 31.957317v447.402438a31.957317 31.957317 0 0 1-31.957317 31.957317h-703.060974a31.957317 31.957317 0 0 1-31.957317-31.957317zM926.774993 960.085366h-703.060974a31.957317 31.957317 0 0 1-31.957317-31.957317v-63.914634a31.957317 31.957317 0 0 1 31.957317-31.957317H830.903042a63.914634 63.914634 0 0 0 63.914634-63.914634V384.85366h63.914634v543.274389a31.957317 31.957317 0 0 1-31.957317 31.957317z' }),
          h('path', { d: 'M246.084141 544.640245H575.244506L469.78536 634.120732a28.761585 28.761585 0 0 0 0 45.379391 44.101097 44.101097 0 0 0 54.327439 0l167.456341-143.807927a28.122439 28.122439 0 0 0 0-44.740244L524.751945 346.504879a44.101097 44.101097 0 0 0-54.327439 0 28.761585 28.761585 0 0 0 0 45.379391L575.244506 480.725611H246.084141a35.792195 35.792195 0 0 0-38.34878 31.957317 35.792195 35.792195 0 0 0 38.34878 31.957317z' }),
        ),
        h('span', { className: 'dsh-ms-header-label' }, t('action.move')),
      )
    }

    /* ------------------------------------------------------------ */
    /* sidebar session-row menu entry (slot occupant)                */
    /* ------------------------------------------------------------ */
    /**
     * One row of a session's "…" menu. The owner supplies the row identity and
     * the menu's open-state pair; the entry renders exactly one role="menuitem"
     * button, dismisses the menu before opening the dialog, and disables itself
     * while that session runs.
     */
    function MoveSessionMenuItem(props) {
      var t = props.t
      var sessionId = props.sessionId
      var menuOpen = props.useMenuOpenState()
      var setMenuOpen = menuOpen[1]
      var running = props.useSessions(function (snapshot) {
        var row = snapshot.byId[sessionId]
        return row === undefined ? false : row.running === true
      })
      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'dsh-ms-menu-item',
          disabled: running,
          title: running ? t('hint.running') : t('menu.move'),
          onClick: function () {
            setMenuOpen(false)
            setState({ open: true, sessionId: sessionId, busy: false, error: null, done: null })
          },
        },
        h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 1024 1024', fill: 'currentColor', 'aria-hidden': 'true' },
          h('path', { d: 'M958.73231 320.939026h-31.957317a31.957317 31.957317 0 0 1-31.957317-31.957317V257.024392a63.914634 63.914634 0 0 0-63.914634-63.914634H525.391092a31.957317 31.957317 0 0 1-30.039878-21.730976l-42.183659-127.829268a63.914634 63.914634 0 0 0-63.914634-43.461951H63.927434A63.914634 63.914634 0 0 0 0.0128 65.28049v703.060974a63.914634 63.914634 0 0 0 63.914634 63.914634h31.957317a31.957317 31.957317 0 0 1 31.957317 31.957317V960.085366a63.914634 63.914634 0 0 0 63.914634 63.914634h766.975608a63.914634 63.914634 0 0 0 63.914634-63.914634V384.85366a63.914634 63.914634 0 0 0-63.914634-63.914634zM63.927434 225.067075V129.195124a63.914634 63.914634 0 0 1 63.914634-63.914634h241.597317a31.957317 31.957317 0 0 1 30.039878 21.730975L447.415238 235.293416a32.596463 32.596463 0 0 0 31.957317 21.730976h319.57317a31.957317 31.957317 0 0 1 31.957317 31.957317v447.402438a31.957317 31.957317 0 0 1-31.957317 31.957317h-703.060974a31.957317 31.957317 0 0 1-31.957317-31.957317zM926.774993 960.085366h-703.060974a31.957317 31.957317 0 0 1-31.957317-31.957317v-63.914634a31.957317 31.957317 0 0 1 31.957317-31.957317H830.903042a63.914634 63.914634 0 0 0 63.914634-63.914634V384.85366h63.914634v543.274389a31.957317 31.957317 0 0 1-31.957317 31.957317z' }),
          h('path', { d: 'M246.084141 544.640245H575.244506L469.78536 634.120732a28.761585 28.761585 0 0 0 0 45.379391 44.101097 44.101097 0 0 0 54.327439 0l167.456341-143.807927a28.122439 28.122439 0 0 0 0-44.740244L524.751945 346.504879a44.101097 44.101097 0 0 0-54.327439 0 28.761585 28.761585 0 0 0 0 45.379391L575.244506 480.725611H246.084141a35.792195 35.792195 0 0 0-38.34878 31.957317 35.792195 35.792195 0 0 0 38.34878 31.957317z' }),
        ),
        h('span', { className: 'dsh-ms-menu-label' }, t('menu.move')),
      )
    }

    /* ------------------------------------------------------------ */
    /* overlay dialog                                                */
    /* ------------------------------------------------------------ */
    function MoveSessionDialog(props) {
      var dialog = useDialogState()
      var t = props.t
      var workspaces = props.useWorkspaces(function (snapshot) { return snapshot })
      var sessions = props.useSessions(function (snapshot) { return snapshot })
      var openSession = props.openSession

      var targetIdState = React.useState(null)
      var setTargetId = targetIdState[1]
      var modeState = React.useState('keep')
      var mode = modeState[0]
      var setMode = modeState[1]

      // reset selection and mode every time the dialog opens (hooks stay
      // unconditional — the early return below happens after every hook);
      // also re-apply the palette synchronously so the dialog always opens
      // with the current GUI theme (the watcher covers mid-open switches)
      React.useEffect(function () {
        if (dialog.open) {
          setTargetId(null)
          setMode('keep')
          if (typeof applyTheme === 'function') applyTheme()
        }
      }, [dialog.open, dialog.sessionId])

      if (!dialog.open) return null

      var sessionId = dialog.sessionId
      var summary = sessions && sessions.byId ? sessions.byId[sessionId] : undefined
      var sessionTitle = (summary && summary.displayTitle) || 'this session'
      var targets = targetsOf(workspaces, sessionId)
      var selectedTargetId = targets.some(function (workspace) { return workspace.workspaceId === targetIdState[0] })
        ? targetIdState[0]
        : targets.length > 0
          ? targets[0].workspaceId
          : null
      var selectedTarget = targets.find(function (workspace) { return workspace.workspaceId === selectedTargetId })
      var canSubmit = !dialog.busy && !dialog.done && selectedTargetId !== null

      function fail(message) {
        setState({ open: true, busy: false, error: message, done: null })
      }

      function submit() {
        if (!canSubmit) return
        setState({ busy: true, error: null })
        moveSession(sessionId, selectedTargetId, mode)
          .then(function (result) {
            if (mode === 'archive') {
              // the source is archived (the view clears); land on the moved session
              setState({ open: false, busy: false, error: null, done: null })
              openSession(result.sessionId)
            } else {
              // keep mode: stay put; the sidebar already shows the copy via
              // the host/session-added frame — offer to open it
              setState({ busy: false, error: null, done: { sessionId: result.sessionId } })
            }
          })
          .catch(function (error) {
            fail(t('dialog.error.moveFailed') + (error && error.message ? error.message : String(error)))
          })
      }

      // Cancel/backdrop always close — even while a move is in flight the
      // user stays in control; the result still lands in the sidebar.
      function close() {
        setState({ open: false, busy: false, error: null, done: null })
      }

      var targetRows = targets.map(function (workspace) {
        var selected = workspace.workspaceId === selectedTargetId
        return h(
          'label',
          { key: workspace.workspaceId, className: 'dsh-ms-option' + (selected ? ' dsh-ms-option-selected' : '') },
          h('input', {
            type: 'radio',
            name: 'dsh-ms-target',
            checked: selected,
            onChange: function () { setTargetId(workspace.workspaceId) },
          }),
          h(
            'span',
            { className: 'dsh-ms-option-body' },
            h('span', { className: 'dsh-ms-option-title' }, workspace.title),
            h('span', { className: 'dsh-ms-option-meta' }, workspace.path + ' · ' + workspace.sessionIds.length + ' sessions'),
          ),
        )
      })

      function modeOption(value, label, hint) {
        return h(
          'label',
          { className: 'dsh-ms-mode' + (mode === value ? ' dsh-ms-mode-selected' : '') },
          h('input', {
            type: 'radio',
            name: 'dsh-ms-mode',
            checked: mode === value,
            onChange: function () { setMode(value) },
          }),
          h(
            'span',
            { className: 'dsh-ms-option-body' },
            h('span', { className: 'dsh-ms-option-title' }, label),
            h('span', { className: 'dsh-ms-option-meta' }, hint),
          ),
        )
      }

      var body
      if (dialog.done) {
        var detail = t('dialog.success.detail').replace('{workspace}', selectedTarget ? selectedTarget.title : '?')
        body = h(
          'div',
          { className: 'dsh-ms-success' },
          h('div', { className: 'dsh-ms-success-title' }, t('dialog.success.title')),
          h('div', { className: 'dsh-ms-success-detail' }, detail),
          h(
            'div',
            { className: 'dsh-ms-footer' },
            h('button', {
              type: 'button',
              className: 'dsh-ms-btn dsh-ms-btn-primary',
              onClick: function () {
                // read the id BEFORE clearing the shared state: `dialog` is a
                // reference to the module-level state object, so setState below
                // would null out dialog.done and throw on .sessionId
                var doneSessionId = dialog.done.sessionId
                setState({ open: false, done: null, busy: false, error: null })
                openSession(doneSessionId)
              },
            }, t('dialog.success.open')),
            h('button', { type: 'button', className: 'dsh-ms-btn', onClick: close }, t('dialog.success.stay')),
          ),
        )
      } else {
        body = h(
          'div',
          { className: 'dsh-ms-form' },
          h('div', { className: 'dsh-ms-note' }, t('dialog.note')),
          h('div', { className: 'dsh-ms-field-label' }, t('dialog.target')),
          targets.length === 0
            ? h('div', { className: 'dsh-ms-empty' }, t('dialog.empty'))
            : h('div', { className: 'dsh-ms-options dsh-ms-target-options' }, targetRows),
          h('div', { className: 'dsh-ms-field-label' }, t('dialog.original')),
          h(
            'div',
            { className: 'dsh-ms-options' },
            modeOption('keep', t('dialog.keep'), t('dialog.keepHint')),
            modeOption('archive', t('dialog.archive'), t('dialog.archiveHint')),
          ),
          dialog.error ? h('div', { className: 'dsh-ms-error' }, dialog.error) : null,
          h(
            'div',
            { className: 'dsh-ms-footer' },
            h('button', { type: 'button', className: 'dsh-ms-btn', onClick: close }, t('dialog.cancel')),
            h(
              'button',
              { type: 'button', className: 'dsh-ms-btn dsh-ms-btn-primary', onClick: submit, disabled: !canSubmit },
              dialog.busy ? t('dialog.busy') : t('dialog.confirm'),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'dsh-ms-backdrop', onClick: close },
        h(
          'div',
          {
            className: 'dsh-ms-card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('dialog.title'),
            onClick: function (event) { event.stopPropagation() },
          },
          h('div', { className: 'dsh-ms-head' }, h('div', { className: 'dsh-ms-title' }, t('dialog.title')), h('div', { className: 'dsh-ms-subtitle' }, t('dialog.currentSession') + sessionTitle)),
          body,
        ),
      )
    }

    /* ------------------------------------------------------------ */
    /* theme: follow the GUI light/dark appearance.                  */
    /* The GUI defines no --surface/--text-* variables, so we read    */
    /* the body background luminance and publish our own --dsh-ms-*  */
    /* variables on :root; a rAF poll re-applies them when the theme */
    /* switches.                                                     */
    /* ------------------------------------------------------------ */
    var THEME_PALETTES = {
      dark: {
        bg: '#1f1f23',
        text: '#e8e8ea',
        muted: 'rgba(235,235,240,.62)',
        border: 'rgba(255,255,255,.16)',
        hover: 'rgba(255,255,255,.08)',
        selectedBg: 'rgba(110,160,255,.14)',
        error: '#f87171',
        errorBg: 'rgba(248,113,113,.12)',
        primary: '#6ea0ff',
        shadow: '0 12px 40px rgba(0,0,0,.55)',
        overlay: 'rgba(0,0,0,.55)',
      },
      light: {
        bg: '#ffffff',
        text: '#1f2328',
        muted: 'rgba(31,35,40,.62)',
        border: 'rgba(0,0,0,.16)',
        hover: 'rgba(0,0,0,.06)',
        selectedBg: 'rgba(79,124,255,.10)',
        error: '#dc2626',
        errorBg: 'rgba(220,38,38,.10)',
        primary: '#4f7cff',
        shadow: '0 12px 40px rgba(0,0,0,.28)',
        overlay: 'rgba(0,0,0,.45)',
      },
    }

    /** Whether the GUI is in dark mode, judged by body background luminance. */
    function bodyIsDark() {
      var bg = getComputedStyle(document.body).backgroundColor
      var match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg || '')
      if (match === null) return false
      var r = Number(match[1])
      var g = Number(match[2])
      var b = Number(match[3])
      return (0.299 * r + 0.587 * g + 0.114 * b) < 128
    }

    /** Publish the current palette as --dsh-ms-* variables on :root. */
    function applyTheme() {
      var palette = bodyIsDark() ? THEME_PALETTES.dark : THEME_PALETTES.light
      var root = document.documentElement
      root.style.setProperty('--dsh-ms-bg', palette.bg)
      root.style.setProperty('--dsh-ms-text', palette.text)
      root.style.setProperty('--dsh-ms-muted', palette.muted)
      root.style.setProperty('--dsh-ms-border', palette.border)
      root.style.setProperty('--dsh-ms-hover', palette.hover)
      root.style.setProperty('--dsh-ms-selected-bg', palette.selectedBg)
      root.style.setProperty('--dsh-ms-error', palette.error)
      root.style.setProperty('--dsh-ms-error-bg', palette.errorBg)
      root.style.setProperty('--dsh-ms-primary', palette.primary)
      root.style.setProperty('--dsh-ms-shadow', palette.shadow)
      root.style.setProperty('--dsh-ms-overlay', palette.overlay)
    }

    /**
     * Watch GUI theme switches by polling the body luminance on a throttled
     * requestAnimationFrame loop (timers — both MutationObserver debounce and
     * setInterval — proved intermittently unreliable in headless Chromium,
     * while rAF is stable). The dialog also re-applies the palette
     * synchronously on every open. Returns the disposer.
     */
    function installThemeWatcher() {
      if (typeof document === 'undefined') return function () {}
      applyTheme()
      var lastDark = bodyIsDark()
      var frame = 0
      var raf = null
      function tick() {
        frame += 1
        if (frame % 5 === 0) {
          var dark = bodyIsDark()
          if (dark !== lastDark) {
            lastDark = dark
            applyTheme()
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return function () {
        if (raf !== null) cancelAnimationFrame(raf)
      }
    }

    /* ------------------------------------------------------------ */
    /* plugin wiring                                                 */
    /* ------------------------------------------------------------ */
    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      var locale = ctx.get('locale')
      var sessions = ctx.get('sessions')
      var uiWorkspace = ctx.get('uiWorkspace')
      if (locale !== undefined) {
        ctx.effect(function () {
          return locale.register(NS, DICT)
        }, 'dsh-move-session: locale')
      }

      /**
       * Open a session that the host has just published. The copy reaches the
       * browser through the `host/session-added` frame, so the client list can
       * lag the move by a moment; wait, bounded, for the row to appear before
       * navigating (opening an unlisted id would land on the New Session view).
       */
      function openSession(sessionId) {
        if (uiWorkspace === undefined || sessions === undefined || sessionId === undefined) return
        var attempts = 0
        var attempt = function () {
          var listed = sessions.list.getSnapshot().byId[sessionId] !== undefined
          if (listed || attempts >= 20) {
            uiWorkspace.openSession(sessionId)
            return
          }
          attempts += 1
          setTimeout(attempt, 150)
        }
        attempt()
      }

      ctx.effect(() => {
        var disposers = [
          slots.inject('conversation.session.header.actions', () =>
            slots.register(
              { name: 'conversation.session.header.actions', id: 'move-session', order: 30, locale: NS },
              MoveSessionButton,
            ),
          ),
          slots.inject('sidebar.workspaces.session.menu.item', () =>
            slots.register(
              {
                name: 'sidebar.workspaces.session.menu.item',
                id: 'move-session',
                // after the shipped pin(100) / rename(200) / fork(300) / archive(400)
                order: 500,
                locale: NS,
              },
              MoveSessionMenuItem,
            ),
          ),
          slots.inject('shell.overlay', () =>
            slots.register(
              {
                name: 'shell.overlay',
                id: 'move-session-dialog',
                order: 50,
                locale: NS,
                inject: function () { return { openSession: openSession } },
              },
              MoveSessionDialog,
            ),
          ),
        ]
        return () => {
          for (var i = 0; i < disposers.length; i++) disposers[i]()
        }
      }, 'dsh-move-session: ui')

      // follow the GUI light/dark theme for the dialog colors
      if (typeof document !== 'undefined') {
        ctx.effect(function () {
          return installThemeWatcher()
        }, 'dsh-move-session: theme watcher')
      }

      // self-contained stylesheet (insert once per page lifetime)
      if (typeof document !== 'undefined' && !document.head.querySelector('style[data-dsh-move-session]')) {
        var style = document.createElement('style')
        style.setAttribute('data-dsh-move-session', 'true')
        style.textContent =
          /* header action: icon + label (color inherits the header text tone,
             opacity renders the secondary level — no theme-variable dependency) */
          '.dsh-ms-header-button{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:1px solid transparent;border-radius:7px;background:transparent;color:inherit;opacity:.68;font:12.5px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;transition:opacity .15s,background .15s,border-color .15s}' +
          '.dsh-ms-header-button:hover:not(:disabled){opacity:1;background:rgba(127,127,127,.12);border-color:rgba(127,127,127,.22)}' +
          '.dsh-ms-header-button:active:not(:disabled){transform:translateY(1px)}' +
          '.dsh-ms-header-button:disabled{opacity:.35;cursor:not-allowed}' +
          '.dsh-ms-header-icon{flex:none}' +
          /* session-row menu entry (occupant of sidebar.workspaces.session.menu.item) */
          '.dsh-ms-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px;border:none;border-radius:6px;background:transparent;color:inherit;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left;cursor:pointer}' +
          '.dsh-ms-menu-item:hover:not(:disabled){background:rgba(127,127,127,.12)}' +
          '.dsh-ms-menu-item:disabled{opacity:.45;cursor:not-allowed}' +
          '.dsh-ms-menu-item svg{flex:none;opacity:.8}' +
          /* modal — colors come from the theme watcher (--dsh-ms-*), with
             light fallbacks when the watcher has not run yet */
          '.dsh-ms-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--dsh-ms-overlay,rgba(0,0,0,.45))}' +
          '.dsh-ms-card{width:480px;max-width:calc(100vw - 32px);max-height:calc(100vh - 64px);overflow:auto;padding:20px;border-radius:12px;background:var(--dsh-ms-bg,#ffffff);color:var(--dsh-ms-text,#1f2328);box-shadow:var(--dsh-ms-shadow,0 12px 40px rgba(0,0,0,.28));font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}' +
          '.dsh-ms-head{margin-bottom:14px}' +
          '.dsh-ms-title{font-size:16px;font-weight:600}' +
          '.dsh-ms-subtitle{margin-top:2px;font-size:13px;color:var(--dsh-ms-muted,rgba(0,0,0,.55));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
          '.dsh-ms-note{padding:8px 10px;margin-bottom:12px;border-radius:8px;background:var(--dsh-ms-hover,rgba(127,127,127,.1));font-size:12.5px;opacity:.85}' +
          '.dsh-ms-field-label{margin:12px 0 6px;font-size:12.5px;font-weight:600;color:var(--dsh-ms-muted,rgba(0,0,0,.55))}' +
          '.dsh-ms-options{display:flex;flex-direction:column;gap:6px}' +
          /* the target-workspace list scrolls independently when there are
             many workspaces, so the header and action buttons stay visible */
          '.dsh-ms-target-options{max-height:240px;overflow-y:auto;padding-right:2px}' +
          '.dsh-ms-option,.dsh-ms-mode{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--dsh-ms-border,rgba(127,127,127,.25));border-radius:8px;cursor:pointer}' +
          '.dsh-ms-option-selected,.dsh-ms-mode-selected{border-color:var(--dsh-ms-primary,#4f7cff);background:var(--dsh-ms-selected-bg,rgba(79,124,255,.08))}' +
          '.dsh-ms-option input,.dsh-ms-mode input{margin-top:3px;accent-color:var(--dsh-ms-primary,#4f7cff)}' +
          '.dsh-ms-option-body{display:flex;flex-direction:column;min-width:0}' +
          '.dsh-ms-option-title{font-weight:500}' +
          '.dsh-ms-option-meta{font-size:12px;color:var(--dsh-ms-muted,rgba(0,0,0,.5));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
          '.dsh-ms-empty{padding:10px;border-radius:8px;border:1px dashed var(--dsh-ms-border,rgba(127,127,127,.35));text-align:center;font-size:13px;color:var(--dsh-ms-muted,rgba(0,0,0,.5))}' +
          '.dsh-ms-error{margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--dsh-ms-error-bg,rgba(220,38,38,.1));color:var(--dsh-ms-error,#dc2626);font-size:12.5px}' +
          '.dsh-ms-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}' +
          '.dsh-ms-btn{padding:6px 14px;border:1px solid var(--dsh-ms-border,rgba(127,127,127,.3));border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}' +
          '.dsh-ms-btn:hover:not(:disabled){background:var(--dsh-ms-hover,rgba(127,127,127,.12))}' +
          '.dsh-ms-btn:disabled{opacity:.5;cursor:not-allowed}' +
          '.dsh-ms-btn-primary{border-color:var(--dsh-ms-primary,#4f7cff);background:var(--dsh-ms-primary,#4f7cff);color:#fff}' +
          '.dsh-ms-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsh-ms-primary,#4f7cff) 85%,#000)}' +
          '.dsh-ms-success-title{font-size:15px;font-weight:600;margin-bottom:4px}' +
          '.dsh-ms-success-detail{font-size:13px;color:var(--dsh-ms-muted,rgba(0,0,0,.55))}'
        document.head.appendChild(style)
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'sessions', 'locale', 'uiWorkspace']
    return module.exports
  },
})
