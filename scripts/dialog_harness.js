/**
 * Shared dialog component harness for Playwright interaction tests.
 * A standalone copy of the dialog/button component logic (kept in sync with
 * lib/client.js — both must implement: functional force updates, unconditional
 * close, default keep mode). Loaded via add_script_tag like the real bundle.
 * Consumers: scripts/test_dialog_fixed.py
 */
var React = window.React;
var h = React.createElement;

// ---- stubs for dynamic-plugin builtins/services ----
var host = { call: async function () { return { ok: true, sessionId: 'new-1', archived: true }; } };
var NS = 'move-session';
var localeCtx = {
  subscribe: function () { return function () {}; },
  bind: function () { return function (key) { return ({ 'dialog.cancel': '\u53d6\u6d88', 'dialog.confirm': '\u8fc1\u79fb', 'dialog.busy': '\u8fc1\u79fb\u4e2d\u2026', 'dialog.title': '\u8fc1\u79fb\u4f1a\u8bdd', 'dialog.currentSession': '\u5f53\u524d\u4f1a\u8bdd\uff1a', 'dialog.note': 'note', 'dialog.target': '\u76ee\u6807\u5de5\u4f5c\u533a', 'dialog.original': '\u539f\u4f1a\u8bdd\u5904\u7406', 'dialog.archive': '\u5f52\u6863\u539f\u4f1a\u8bdd', 'dialog.archiveHint': 'hint-a', 'dialog.keep': '\u4fdd\u7559\u539f\u4f1a\u8bdd', 'dialog.keepHint': 'hint-k', 'dialog.empty': 'empty', 'dialog.success.title': 'ok', 'dialog.success.detail': 'd {workspace}', 'dialog.success.open': 'open', 'dialog.success.stay': 'stay', 'action.move': '\u8fc1\u79fb\u4f1a\u8bdd', 'hint.running': 'r', 'hint.noTarget': 'n', 'hint.default': 'm', 'dialog.error.openFailed': 'o: ', 'dialog.error.moveFailed': 'm: ' }[key] || key); }; },
};

// ---- shared store (functional force updates only — see AGENTS.md rule 2) ----
var state = { open: false, sessionId: null, busy: false, error: null, done: null };
var listeners = [];
function setState(patch) {
  Object.assign(state, patch);
  for (var i = 0; i < listeners.length; i++) listeners[i](function (n) { return n + 1; });
}
function useDialogState() {
  var force = React.useState(0)[1];
  React.useEffect(function () {
    listeners.push(force);
    return function () {
      var index = listeners.indexOf(force);
      if (index !== -1) listeners.splice(index, 1);
    };
  }, []);
  return state;
}
function useT() {
  var force = React.useState(0)[1];
  React.useEffect(function () { return localeCtx.subscribe(function () { force(function (n) { return n + 1; }); }); }, []);
  return localeCtx.bind(NS);
}

function MoveSessionButton(props) {
  var t = useT();
  var running = props.useSession ? props.useSession(function (s) { return s.running; }) : false;
  var workspaces = props.useWorkspaces ? props.useWorkspaces(function (s) { return s; }) : { items: [] };
  var sessionId = props.sessionId;
  var source = workspaces.items.find(function (w) { return w.sessionIds.indexOf(sessionId) !== -1; });
  var targets = workspaces.items.filter(function (w) { return w.workspaceId !== (source && source.workspaceId); });
  var disabled = running || targets.length === 0;
  return h('button', { type: 'button', className: 'dsh-ms-header-button', disabled: disabled,
    onClick: function (event) { event.stopPropagation(); setState({ open: true, sessionId: sessionId, busy: false, error: null, done: null }); } },
    h('span', null, t('action.move')));
}

function MoveSessionDialog(props) {
  var dialog = useDialogState();
  var t = useT();
  var workspaces = props.useWorkspaces ? props.useWorkspaces(function (s) { return s; }) : { items: [] };
  var sessions = props.useSessions ? props.useSessions(function (s) { return s; }) : null;
  var openSession = props.openSession || function () {};
  var targetIdState = React.useState(null);
  var setTargetId = targetIdState[1];
  var modeState = React.useState('keep');
  var mode = modeState[0];
  var setMode = modeState[1];
  React.useEffect(function () {
    if (dialog.open) {
      setTargetId(null);
      setMode('keep');
      if (typeof applyTheme === 'function') applyTheme();
    }
  }, [dialog.open, dialog.sessionId]);
  if (!dialog.open) return null;
  var sessionId = dialog.sessionId;
  var source = workspaces.items.find(function (w) { return w.sessionIds.indexOf(sessionId) !== -1; });
  var targets = workspaces.items.filter(function (w) { return w.workspaceId !== (source && source.workspaceId); });
  var selectedTargetId = targets.some(function (w) { return w.workspaceId === targetIdState[0]; })
    ? targetIdState[0] : targets.length > 0 ? targets[0].workspaceId : null;
  var canSubmit = !dialog.busy && !dialog.done && selectedTargetId !== null;
  function close() { setState({ open: false, busy: false, error: null, done: null }); }
  var modeOption = function (value, label, hint) {
    return h('label', { className: 'dsh-ms-mode' + (mode === value ? ' sel' : '') },
      h('input', { type: 'radio', name: 'dsh-ms-mode', checked: mode === value, onChange: function () { setMode(value); } }),
      h('span', null, label));
  };
  var body = h('div', { className: 'dsh-ms-form' },
    h('div', { className: 'dsh-ms-options' },
      modeOption('keep', t('dialog.keep'), t('dialog.keepHint')),
      modeOption('archive', t('dialog.archive'), t('dialog.archiveHint'))),
    h('div', { className: 'dsh-ms-footer' },
      h('button', { type: 'button', className: 'dsh-ms-btn', onClick: close }, t('dialog.cancel')),
      h('button', { type: 'button', className: 'dsh-ms-btn primary', onClick: function () {}, disabled: !canSubmit }, t('dialog.confirm'))));
  return h('div', { className: 'dsh-ms-backdrop', onClick: close },
    h('div', { className: 'dsh-ms-card', onClick: function (event) { event.stopPropagation(); } },
      h('div', { className: 'dsh-ms-title' }, t('dialog.title')),
      h('div', { className: 'dsh-ms-subtitle' }, t('dialog.currentSession') + 'T'),
      body));
}

var props = {
  sessionId: 's1',
  useSession: function (sel) { return sel({ running: false }); },
  useWorkspaces: function (sel) { return sel({ items: [
    { workspaceId: 'w1', title: 'WS1', path: 'C:/ws1', sessionIds: ['s1'] },
    { workspaceId: 'w2', title: 'WS2', path: 'C:/ws2', sessionIds: [] }] }); },
  useSessions: function (sel) { return sel({ byId: { s1: { title: 'T' } } }); },
  openSession: function () {},
};

var buttonHost = document.getElementById('button-host');
var dialogHost = document.getElementById('dialog-host');
ReactDOM.render(h(MoveSessionButton, props), buttonHost);
ReactDOM.render(h(MoveSessionDialog, props), dialogHost);
window.__setState = setState;
window.__state = state;
