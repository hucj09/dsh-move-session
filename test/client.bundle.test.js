/**
 * Client-bundle structural tests: guard the invariants of lib/client.js that
 * broke the dialog before (see AGENTS.md rule 3):
 *   - the bundle registers under the package id via __ModuleLoader__.load
 *   - zh/en dictionaries carry the same key set and every required key
 *   - the store force uses functional updates (no bare force() bailout)
 *   - the row-menu injection anchors (ARIA roles, fiber recovery) are present
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
  assert.match(CLIENT, /id: '@linxin666\/dsh-move-session'/)
  assert.match(CLIENT, /exports\.apply = apply/)
  assert.match(CLIENT, /exports\.inject = \['slots', 'sessions', 'locale'\]/)
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

test('row-menu injection anchors are present', () => {
  assert.match(CLIENT, /role="menu"/)
  assert.match(CLIENT, /setAttribute\('role', 'menuitem'\)/)
  assert.match(CLIENT, /__reactFiber\$/)
  assert.match(CLIENT, /MutationObserver/)
  assert.match(CLIENT, /isSessionRowMenu/)
  assert.match(CLIENT, /data-dsh-ms-menu-item/)
})

test('header button uses the custom icon paths', () => {
  assert.match(CLIENT, /viewBox: '0 0 1024 1024'/)
  assert.match(CLIENT, /fill: 'currentColor'/)
})

test('header button styles avoid theme-variable dependency (inherit + opacity)', () => {
  assert.match(CLIENT, /color:inherit;opacity:\.68/)
  assert.ok(!CLIENT.includes('var(--text-secondary'), 'must not depend on the undefined --text-secondary variable')
})
