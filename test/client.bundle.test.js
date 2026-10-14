/**
 * Client-bundle structural tests: guard the invariants of lib/client.js that
 * broke the dialog before (see AGENTS.md rule 2/3):
 *   - the bundle registers under the package id via __ModuleLoader__.load
 *   - zh/en dictionaries carry the same key set and every required key
 *   - the store force uses functional updates (no bare force() bailout)
 *   - every contribution registers into a documented slot, with `locale` so
 *     the framework supplies the `t` seat
 *   - the session-row menu entry is a slot occupant (no DOM/fiber injection)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

const REQUIRED_KEYS = [
  'action.move',
  'hint.running',
  'hint.noTarget',
  'hint.default',
  'dialog.title',
  'dialog.currentSession',
  'dialog.note',
  'dialog.target',
  'dialog.original',
  'dialog.archive',
  'dialog.archiveHint',
  'dialog.keep',
  'dialog.keepHint',
  'dialog.empty',
  'dialog.cancel',
  'dialog.confirm',
  'dialog.busy',
  'dialog.success.title',
  'dialog.success.detail',
  'dialog.success.open',
  'dialog.success.stay',
  'dialog.error.openFailed',
  'dialog.error.moveFailed',
]

/** Extract the key list of one locale block from the bundle source. */
function dictKeys(locale) {
  const marker = `${locale}: {`
  const start = CLIENT.indexOf(marker)
  assert.notEqual(start, -1, `dictionary block "${locale}" must exist`)
  const end = CLIENT.indexOf('\n      }', start)
  const block = CLIENT.slice(start + marker.length, end)
  const keys = [...block.matchAll(/'([^']+)':/g)].map((m) => m[1])
  return keys
}

test('bundle registers under the package id via __ModuleLoader__.load', () => {
  assert.match(CLIENT, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(CLIENT, /id: '@hucj\/dsh-move-session'/)
  assert.match(CLIENT, /exports\.apply = apply/)
  assert.match(CLIENT, /exports\.inject = \['slots', 'sessions', 'locale', 'uiWorkspace'\]/)
})

test('zh/en dictionaries carry identical key sets', () => {
  const zh = dictKeys('zh')
  const en = dictKeys('en')
  assert.deepEqual([...zh].sort(), [...en].sort())
})

test('dictionaries contain every required key', () => {
  const zh = dictKeys('zh')
  for (const key of REQUIRED_KEYS) assert.ok(zh.includes(key), `missing required key: ${key}`)
})

test('store force uses functional updates (regression: bare force() bailout)', () => {
  // the critical v4 fix: listeners are invoked with an updater, never bare
  assert.match(CLIENT, /listeners\[i\]\(function \(n\) \{ return n \+ 1 \}\)/)
  // and no bare invocation remains anywhere
  const bare = CLIENT.match(/listeners\[i\]\(\)/g)
  assert.equal(bare, null, 'bare force() call must not exist (React Object.is bailout)')
})

test('success panel "open moved session" reads the id before clearing state', () => {
  // regression (v0.1.1 bug): onClick did setState({open:false, done:null,...})
  // and only then read dialog.done.sessionId — dialog is a live reference to
  // the module-level state object, so done was already null → TypeError → the
  // moved session was never opened. The id must be captured BEFORE the setState.
  const openIndex = CLIENT.indexOf("t('dialog.success.open')")
  assert.ok(openIndex !== -1, 'success panel open button must exist')
  const click = CLIENT.slice(openIndex - 600, openIndex)
  assert.match(click, /var doneSessionId = dialog\.done\.sessionId/)
  const readIdx = click.indexOf('dialog.done.sessionId')
  const clearIdx = click.indexOf('setState({ open: false, done: null')
  assert.ok(readIdx !== -1 && clearIdx !== -1 && readIdx < clearIdx,
    'doneSessionId must be read before setState clears done')
})

test('dialog close is unconditional (no busy guard)', () => {
  assert.match(CLIENT, /function close\(\) \{\s*setState\(\{ open: false, busy: false, error: null, done: null \}\)/)
})

test('default mode is keep', () => {
  assert.match(CLIENT, /React\.useState\('keep'\)/)
  assert.match(CLIENT, /setMode\('keep'\)/)
  const keepFirst = CLIENT.indexOf("modeOption('keep'")
  const archiveSecond = CLIENT.indexOf("modeOption('archive'")
  assert.ok(keepFirst !== -1 && archiveSecond !== -1 && keepFirst < archiveSecond, 'keep option must render first')
})

/* ------------------------------------------------------------------ */
/* slot contributions                                                  */
/* ------------------------------------------------------------------ */

test('every contribution registers into a documented slot with a locale seat', () => {
  for (const slot of [
    'conversation.session.header.actions',
    'sidebar.workspaces.session.menu.item',
    'shell.overlay',
  ]) {
    assert.ok(CLIENT.includes(`slots.inject('${slot}'`), `must inject slot ${slot}`)
  }
  assert.match(CLIENT, /name: 'conversation\.session\.header\.actions', id: 'move-session', order: 30, locale: NS/)
  assert.match(CLIENT, /id: 'move-session',\s*\n\s*\/\/ after the shipped pin\(100\) \/ rename\(200\) \/ fork\(300\) \/ archive\(400\)\s*\n\s*order: 500,\s*\n\s*locale: NS,/)
  assert.match(CLIENT, /id: 'move-session-dialog',\s*\n\s*order: 50,\s*\n\s*locale: NS,/)
  // the dictionaries still register through the locale service
  assert.match(CLIENT, /locale\.register\(NS, DICT\)/)
})

test('components translate through the framework seat, not a private subscription', () => {
  assert.match(CLIENT, /var t = props\.t/)
  assert.ok(!CLIENT.includes('localeCtx'), 'the private locale handle must be gone')
  assert.ok(!CLIENT.includes('function useT('), 'the private translator hook must be gone')
})

test('the session-row menu entry is a slot occupant, not DOM injection', () => {
  assert.match(CLIENT, /function MoveSessionMenuItem\(props\)/)
  // owner share + the menu open-state hook the slot binds
  assert.match(CLIENT, /var sessionId = props\.sessionId/)
  assert.match(CLIENT, /var menuOpen = props\.useMenuOpenState\(\)/)
  assert.match(CLIENT, /var setMenuOpen = menuOpen\[1\]/)
  // it renders exactly one role="menuitem" button and dismisses the menu first
  assert.match(CLIENT, /role: 'menuitem'/)
  const click = CLIENT.slice(CLIENT.indexOf('onClick: function () {\n            setMenuOpen(false)'))
  assert.match(click, /^onClick: function \(\) \{\n            setMenuOpen\(false\)\n            setState\(\{ open: true, sessionId: sessionId/)
  // the brittle DOM/fiber machinery is gone for good
  assert.ok(!CLIENT.includes('__reactFiber$'), 'React-fiber recovery must be gone')
  assert.ok(!CLIENT.includes('new MutationObserver'), 'DOM menu observation must be gone')
  assert.ok(!CLIENT.includes('data-dsh-ms-menu-item'), 'DOM menu injection must be gone')
  assert.ok(!CLIENT.includes('isSessionRowMenu'), 'localized menu sniffing must be gone')
})

test('the row-menu entry disables itself for running sessions', () => {
  // the row identity comes from the owner; the running flag from the session list
  assert.match(CLIENT, /var running = props\.useSessions\(function \(snapshot\) \{/)
  assert.match(CLIENT, /var row = snapshot\.byId\[sessionId\]/)
  assert.match(CLIENT, /return row === undefined \? false : row\.running === true/)
  assert.match(CLIENT, /disabled: running,/)
  assert.match(CLIENT, /title: running \? t\('hint\.running'\) : t\('menu\.move'\)/)
  assert.match(CLIENT, /\.dsh-ms-menu-item:disabled\{opacity:\.45;cursor:not-allowed\}/)
})

test('opening the moved session goes through the workspace navigation service', () => {
  assert.match(CLIENT, /var uiWorkspace = ctx\.get\('uiWorkspace'\)/)
  assert.match(CLIENT, /uiWorkspace\.openSession\(sessionId\)/)
  // the copy reaches the client through host/session-added, so the list can
  // lag the move: wait, bounded, for the row before navigating
  assert.match(CLIENT, /sessions\.list\.getSnapshot\(\)\.byId\[sessionId\] !== undefined/)
  assert.match(CLIENT, /attempts >= 20/)
  // the overlay receives the callback through its declared inject face
  assert.match(CLIENT, /inject: function \(\) \{ return \{ openSession: openSession \} \}/)
})

test('the dialog reads the session title from the session list projection', () => {
  assert.match(CLIENT, /var sessions = props\.useSessions\(function \(snapshot\) \{ return snapshot \}\)/)
  assert.match(CLIENT, /summary\.displayTitle/)
  assert.ok(!CLIENT.includes('summary.title'), 'SessionSummary exposes displayTitle, not title')
})

test('header button uses the custom icon paths', () => {
  assert.match(CLIENT, /viewBox: '0 0 1024 1024'/)
  assert.match(CLIENT, /fill: 'currentColor'/)
})

test('header button styles avoid theme-variable dependency (inherit + opacity)', () => {
  assert.match(CLIENT, /color:inherit;opacity:\.68/)
  assert.ok(!CLIENT.includes('var(--text-secondary'), 'must not depend on the undefined --text-secondary variable')
})

test('dialog palette follows the GUI theme (no hard-coded surface variables)', () => {
  // theme machinery exists
  assert.match(CLIENT, /var THEME_PALETTES = \{/)
  assert.match(CLIENT, /function bodyIsDark\(\)/)
  assert.match(CLIENT, /function applyTheme\(\)/)
  assert.match(CLIENT, /function installThemeWatcher\(\)/)
  // variables are published to :root and consumed by the modal CSS
  assert.match(CLIENT, /setProperty\('--dsh-ms-bg', palette\.bg\)/)
  assert.match(CLIENT, /background:var\(--dsh-ms-bg,#ffffff\)/)
  assert.match(CLIENT, /color:var\(--dsh-ms-text,#1f2328\)/)
  // the old hard-coded surface variables are gone from the modal CSS
  assert.ok(!CLIENT.includes('var(--surface'), 'modal must not depend on --surface')
  assert.ok(!CLIENT.includes('var(--text-primary'), 'modal must not depend on --text-primary')
  // the watcher polls the body luminance on a throttled rAF loop (timers proved
  // unreliable in headless Chromium) and is wired in apply
  assert.match(CLIENT, /requestAnimationFrame\(tick\)/)
  assert.match(CLIENT, /frame % 5 === 0/)
  assert.match(CLIENT, /var lastDark = bodyIsDark\(\)/)
  assert.match(CLIENT, /installThemeWatcher\(\)/)
  assert.match(CLIENT, /'dsh-move-session: theme watcher'/)
  // the dialog also re-applies the palette synchronously when it opens
  assert.match(CLIENT, /if \(typeof applyTheme === 'function'\) applyTheme\(\)/)
  // many workspaces: the target list scrolls independently (max-height)
  assert.match(CLIENT, /dsh-ms-target-options/)
  assert.match(CLIENT, /\.dsh-ms-target-options\{max-height:240px;overflow-y:auto/)
})
