/**
 * Host-half unit tests: the full `moveSession` contract against fake services.
 * Run with `npm test` (node:test). Every behavior change to lib/index.js must
 * extend this suite (see AGENTS.md rule 3).
 *
 * The fakes mirror the current DSH service contracts: the source log is read
 * through `sessionQuery.observeSession` (a disposable observation lease), and
 * the target directory is pre-checked through `workspace.status()`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveSession, sessionPresetId, lastModelOptions, sourceTitle, observeSource, migratedTitle, stripMsSuffix, msNumber } from '../lib/index.js'

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const EVENTS = [
  { seq: 0, type: 'user/message', time: 1000, data: { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } } },
  { seq: 1, type: 'request/header', time: 1001, data: { header: { provider: 'deepseek', model: 'deepseek-v4', config: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' } }, reason: 'initial' } },
  { seq: 2, type: 'assistant/message', time: 1002, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] } } },
  { seq: 3, type: 'turn/end', time: 1003, data: { turn: 1, reason: 'complete' } },
  { seq: 4, type: 'agent-preset/selected', time: 1004, data: { agentPreset: 'my-preset' } },
]

const HEADER = { version: 0, id: 'src-1', createdAt: 1000, cwd: 'C:/ws1', isSeeded: false, agentPreset: 'cordis' }

/** Source workspace holding the moved session. */
const WS1 = { id: 'w1', path: 'C:/ws1', title: 'WS1', sessionIds: ['src-1'] }
/** Empty target workspace. */
const WS2 = { id: 'w2', path: 'C:/ws2', title: 'WS2', sessionIds: [] }
/** Target workspace already holding sessions. */
const WS2_FILLED = { id: 'w2', path: 'C:/ws2', title: 'WS2', sessionIds: ['t-1', 't-2'] }

function makeRegistry(workspaces, shared) {
  return {
    get(id) {
      const hit = workspaces.find((w) => w.id === id)
      if (!hit) return undefined
      return {
        id: hit.id,
        path: hit.path,
        title: hit.title,
        sessionIds: hit.sessionIds,
        status: async () => {
          if (hit.statusError !== undefined) throw hit.statusError
          return hit.status || 'ok'
        },
        attachSession: async (sid) => {
          shared.attached.push(sid)
        },
      }
    },
    list: () => workspaces,
    archiveSession: async (id) => {
      shared.archived.push(id)
    },
  }
}

/** Build a fake ctx with recording agents/sessionQuery/presets. */
function makeCtx(overrides = {}) {
  const calls = { created: [], mounted: [], archived: [], attached: [], renamed: [], flushed: false, disposed: 0 }
  const registry = makeRegistry(overrides.workspaces || [WS1, WS2], calls)
  const ctx = {
    calls,
    get(name) {
      if (name === 'agents') {
        return {
          get: (id) => (overrides.runningId === id ? { status: 'running' } : undefined),
          create: async (opts) => {
            calls.created.push(opts)
            return { agent: overrides.agentSession !== undefined ? { session: overrides.agentSession } : {} }
          },
        }
      }
      if (name === 'sessionTitle') {
        return {
          rename: (session, title) => {
            calls.renamed.push({ session, title })
          },
        }
      }
      if (name === 'sessionQuery') {
        return {
          observeSession: async (id) => {
            if (overrides.observeError) throw overrides.observeError
            if (overrides.missingId === id) throw new Error(`session ${id} not found`)
            return {
              source: 'live',
              header: overrides.header || HEADER,
              events: overrides.events || EVENTS,
              cursor: (overrides.events || EVENTS).length - 1,
              [Symbol.dispose]() {
                calls.disposed += 1
              },
            }
          },
          readTitleSnapshots: async (sessionIds) => {
            if (overrides.titleQueryError) throw overrides.titleQueryError
            return (overrides.targetTitles || []).map((title, index) => ({
              sessionId: sessionIds[index] || 't-' + index,
              status: 'fulfilled',
              value: { session: {}, title: { title } },
            }))
          },
        }
      }
      if (name === 'sessions') {
        return {
          get: () => (overrides.liveId !== undefined ? { id: overrides.liveId } : undefined),
          flush: async () => {
            calls.flushed = true
          },
        }
      }
      if (name === 'workspaceRegistry') {
        return registry
      }
      if (name === 'agentPresets') {
        return {
          resolve: async (id) => ({ id: id ?? 'default' }),
          mount: async (agentCtx, id) => {
            calls.mounted.push(id)
          },
        }
      }
      return undefined
    },
  }
  return ctx
}

/* ------------------------------------------------------------------ */
/* pure helpers                                                        */
/* ------------------------------------------------------------------ */

test('sessionPresetId: header value wins when no selection event', () => {
  assert.equal(sessionPresetId({ agentPreset: 'cordis' }, [{ type: 'turn/end', data: {} }]), 'cordis')
})

test('sessionPresetId: last agent-preset/selected event overrides header', () => {
  const events = [
    { type: 'agent-preset/selected', data: { agentPreset: 'old' } },
    { type: 'agent-preset/selected', data: { agentPreset: 'new' } },
  ]
  assert.equal(sessionPresetId({ agentPreset: 'cordis' }, events), 'new')
})

test('sessionPresetId: returns undefined for missing values', () => {
  assert.equal(sessionPresetId({}, []), undefined)
})

test('lastModelOptions: inherits provider/model from the last request/header', () => {
  const events = [
    { type: 'request/header', data: { header: { config: { provider: 'a', model: 'm1' } } } },
    { type: 'request/header', data: { header: { config: { provider: 'b', model: 'm2' } } } },
  ]
  assert.deepEqual(lastModelOptions(events), { provider: 'b', model: 'm2' })
})

test('lastModelOptions: skips configs without provider/model', () => {
  assert.equal(lastModelOptions([{ type: 'request/header', data: { header: { config: {} } } }]), undefined)
  assert.equal(lastModelOptions([]), undefined)
})

/* ------------------------------------------------------------------ */
/* source observation                                                  */
/* ------------------------------------------------------------------ */

test('observeSource: returns the header and events of one observation lease', async () => {
  const ctx = makeCtx()
  const source = await observeSource(ctx, 'src-1')
  assert.equal(source.header, HEADER)
  assert.equal(source.events, EVENTS)
})

test('observeSource: releases the observation lease', async () => {
  const ctx = makeCtx()
  await observeSource(ctx, 'src-1')
  assert.equal(ctx.calls.disposed, 1)
})

test('observeSource: releases the lease even when the read throws', async () => {
  const ctx = makeCtx()
  const originalGet = ctx.get
  ctx.get = (name) =>
    name === 'sessionQuery'
      ? {
        observeSession: async () => ({
          header: HEADER,
          get events() { throw new Error('log on fire') },
          [Symbol.dispose]() { ctx.calls.disposed += 1 },
        }),
      }
      : originalGet(name)
  await assert.rejects(() => observeSource(ctx, 'src-1'), /log on fire/)
  assert.equal(ctx.calls.disposed, 1)
})

test('observeSource: reports a missing session as session-not-found', async () => {
  const ctx = makeCtx({ missingId: 'ghost' })
  await assert.rejects(() => observeSource(ctx, 'ghost'), (e) => e.code === 'session-not-found')
})

test('observeSource: reports an unavailable sessionQuery service', async () => {
  const bare = { get: () => undefined }
  await assert.rejects(() => observeSource(bare, 'src-1'), (e) => e.code === 'unavailable')
})

/* ------------------------------------------------------------------ */
/* moved-title marker (distinguishes same-named sessions)              */
/* ------------------------------------------------------------------ */

const TITLED_EVENTS = [
  ...EVENTS,
  { seq: 5, type: 'session/title', time: 1005, data: { title: '我的会话', messageSeqs: [0], source: { kind: 'provider' } } },
]

test('sourceTitle: returns the latest durable title', () => {
  assert.equal(sourceTitle(TITLED_EVENTS), '我的会话')
  assert.equal(sourceTitle(EVENTS), undefined)
})

test('stripMsSuffix / msNumber: marker helpers', () => {
  assert.equal(stripMsSuffix('我的会话 [MS3]'), '我的会话')
  assert.equal(stripMsSuffix('我的会话'), '我的会话')
  assert.equal(stripMsSuffix('我的会话 [MS3] 后缀'), '我的会话 [MS3] 后缀') // anchored at the end only
  assert.equal(msNumber('我的会话 [MS3]'), 3)
  assert.equal(msNumber('我的会话'), 0)
})

test('migratedTitle: no suffix without a same-name session', () => {
  assert.equal(migratedTitle('我的会话', new Set(['其他会话'])), '我的会话')
  assert.equal(migratedTitle('我的会话', undefined), '我的会话')
  assert.equal(migratedTitle(undefined, new Set(['x'])), undefined)
})

test('migratedTitle: appends [MS1] on a same-name collision', () => {
  assert.equal(migratedTitle('我的会话', new Set(['我的会话'])), '我的会话 [MS1]')
  // distinct from the fork numbering
  assert.notEqual(migratedTitle('我的会话', new Set(['我的会话'])), '我的会话 (1)')
  assert.notEqual(migratedTitle('我的会话', new Set(['我的会话'])), '我的会话（1）')
})

test('migratedTitle: repeated moves ascend without colliding', () => {
  // target already holds the original plus [MS1] -> next is [MS2]
  assert.equal(migratedTitle('我的会话', new Set(['我的会话', '我的会话 [MS1]'])), '我的会话 [MS2]')
  // gaps are filled by max+1
  assert.equal(migratedTitle('我的会话', new Set(['我的会话', '我的会话 [MS5]'])), '我的会话 [MS6]')
})

test('migratedTitle: re-moving an already-marked copy re-bases instead of accumulating', () => {
  // moving "我的会话 [MS1]" into a workspace that already has it -> "我的会话 [MS2]"
  assert.equal(migratedTitle('我的会话 [MS1]', new Set(['我的会话 [MS1]'])), '我的会话 [MS2]')
  // …and stays untouched when there is no same-name
  assert.equal(migratedTitle('我的会话 [MS1]', new Set(['我的会话'])), '我的会话 [MS1]')
})

test('moves rename the copy with [MS1] when the target has a same-name session', async () => {
  const ctx = makeCtx({ events: TITLED_EVENTS, agentSession: { id: 'copy-1' }, targetTitles: ['我的会话'], workspaces: [WS1, WS2_FILLED] })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(ctx.calls.renamed.length, 1)
  assert.deepEqual(ctx.calls.renamed[0], { session: { id: 'copy-1' }, title: '我的会话 [MS1]' })
})

test('moves ascend the marker on repeated moves into the same workspace', async () => {
  const ctx = makeCtx({ events: TITLED_EVENTS, agentSession: { id: 'copy-1' }, targetTitles: ['我的会话', '我的会话 [MS1]'], workspaces: [WS1, WS2_FILLED] })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.deepEqual(ctx.calls.renamed[0].title, '我的会话 [MS2]')
})

test('moves skip the rename when the target has no same-name session', async () => {
  const ctx = makeCtx({ events: TITLED_EVENTS, agentSession: { id: 'copy-1' }, targetTitles: ['其他会话'], workspaces: [WS1, WS2_FILLED] })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(ctx.calls.renamed.length, 0) // no title event written without a collision
})

test('moves skip the rename when the target holds no other session to compare with', async () => {
  const ctx = makeCtx({ events: TITLED_EVENTS, agentSession: { id: 'copy-1' }, targetTitles: ['我的会话'] })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(ctx.calls.renamed.length, 0)
})

test('moves skip the rename when the title query fails', async () => {
  const ctx = makeCtx({
    events: TITLED_EVENTS,
    agentSession: { id: 'copy-1' },
    titleQueryError: new Error('index unavailable'),
    workspaces: [WS1, WS2_FILLED],
  })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(ctx.calls.renamed.length, 0) // cannot check same-name -> keep the inherited title
})

test('moves skip the rename when the source has no title', async () => {
  const ctx = makeCtx({ agentSession: { id: 'copy-1' } })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(ctx.calls.renamed.length, 0)
})

test('moves skip the rename when sessionTitle is not mounted', async () => {
  const ctx = makeCtx({ events: TITLED_EVENTS, agentSession: { id: 'copy-1' }, targetTitles: ['我的会话'], workspaces: [WS1, WS2_FILLED] })
  const originalGet = ctx.get
  ctx.get = (name) => (name === 'sessionTitle' ? undefined : originalGet(name))
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(ctx.calls.renamed.length, 0)
})

test('moves survive a rename failure (title is presentation metadata)', async () => {
  const ctx = makeCtx({ events: TITLED_EVENTS, agentSession: { id: 'copy-1' }, targetTitles: ['我的会话'], workspaces: [WS1, WS2_FILLED] })
  const originalGet = ctx.get
  ctx.get = (name) =>
    name === 'sessionTitle'
      ? { rename: () => { throw new Error('title invalid') } }
      : originalGet(name)
  const result = await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(result.archived, false)
  assert.equal(ctx.calls.created.length, 1)
})

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

test('rejects missing sessionId', async () => {
  await assert.rejects(() => moveSession(makeCtx(), { targetWorkspaceId: 'w2', mode: 'keep' }), (e) => e.code === 'invalid-session')
})

test('rejects missing targetWorkspaceId', async () => {
  await assert.rejects(() => moveSession(makeCtx(), { sessionId: 'src-1', mode: 'keep' }), (e) => e.code === 'invalid-target')
})

test('rejects unknown mode', async () => {
  await assert.rejects(() => moveSession(makeCtx(), { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'nope' }), (e) => e.code === 'invalid-mode')
})

test('rejects when required services are unavailable', async () => {
  const bare = { get: () => undefined }
  await assert.rejects(() => moveSession(bare, { sessionId: 's', targetWorkspaceId: 'w', mode: 'keep' }), (e) => e.code === 'unavailable')
})

/* ------------------------------------------------------------------ */
/* idle-only rule                                                      */
/* ------------------------------------------------------------------ */

test('rejects a running session', async () => {
  const ctx = makeCtx({ runningId: 'src-1' })
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' }), (e) => e.code === 'session-busy')
})

/* ------------------------------------------------------------------ */
/* source resolution                                                   */
/* ------------------------------------------------------------------ */

test('rejects an unknown session', async () => {
  const ctx = makeCtx({ missingId: 'ghost' })
  await assert.rejects(() => moveSession(ctx, { sessionId: 'ghost', targetWorkspaceId: 'w2', mode: 'keep' }), (e) => e.code === 'session-not-found')
})

test('rejects when the source observation fails', async () => {
  const ctx = makeCtx({ observeError: new Error('disk on fire') })
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' }), (e) => e.code === 'session-not-found')
})

test('flushes a live source session before reading', async () => {
  const ctx = makeCtx({ liveId: 'src-1' })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(ctx.calls.flushed, true)
})

/* ------------------------------------------------------------------ */
/* target validation                                                   */
/* ------------------------------------------------------------------ */

test('rejects an unknown target workspace', async () => {
  const ctx = makeCtx({ workspaces: [WS1] })
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w9', mode: 'keep' }), (e) => e.code === 'target-not-found')
})

test('rejects a stale target workspace whose directory is gone — before any write', async () => {
  const ctx = makeCtx({ workspaces: [WS1, { ...WS2, status: 'missing-dir' }] })
  await assert.rejects(
    () => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' }),
    (e) => e.code === 'target-missing-dir',
  )
  // the copy must NOT be created: no orphan sessions
  assert.equal(ctx.calls.created.length, 0)
  assert.deepEqual(ctx.calls.attached, [])
  assert.deepEqual(ctx.calls.archived, [])
})

test('rejects when the target directory cannot be resolved', async () => {
  const ctx = makeCtx({ workspaces: [WS1, { ...WS2, statusError: new Error('ENOENT: no such file or directory') }] })
  await assert.rejects(
    () => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' }),
    (e) => e.code === 'target-missing-dir',
  )
  assert.equal(ctx.calls.created.length, 0)
})

test('rejects moving into the session\'s own workspace', async () => {
  const ctx = makeCtx()
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w1', mode: 'keep' }), (e) => e.code === 'same-workspace')
})

/* ------------------------------------------------------------------ */
/* happy paths                                                         */
/* ------------------------------------------------------------------ */

test('archive mode: creates the copy, attaches it, archives the source', async () => {
  const ctx = makeCtx()
  const result = await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'archive' })
  assert.equal(result.archived, true)
  assert.match(result.sessionId, /^session-mv-/)
  assert.equal(ctx.calls.created.length, 1)

  const opts = ctx.calls.created[0]
  assert.equal(opts.sessionId, result.sessionId)
  assert.equal(opts.seed, EVENTS)
  assert.deepEqual(opts.meta, {
    cwd: 'C:/ws2',
    parentSession: 'src-1',
    isSeeded: true,
    agentPreset: 'my-preset', // from the last agent-preset/selected event
  })
  assert.deepEqual(opts.agentOptions, { provider: 'deepseek', model: 'deepseek-v4' })
  assert.equal(typeof opts.setup, 'function')
  await opts.setup({})
  assert.deepEqual(ctx.calls.mounted, ['my-preset'])

  assert.deepEqual(ctx.calls.attached, [result.sessionId])
  assert.deepEqual(ctx.calls.archived, ['src-1'])
})

test('regression: the copy meta carries no retired "seedLength" field', async () => {
  // DSH >= 0.2 rejects an unknown session-header field by throwing
  // ('session header has invalid field "seedLength"'), which failed every move.
  const ctx = makeCtx()
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  const opts = ctx.calls.created[0]
  assert.equal(Object.hasOwn(opts.meta, 'seedLength'), false)
  assert.equal(Object.hasOwn(opts.meta, 'isSeeded'), true)
  // the whole source log is the child's inherited prefix
  assert.equal(opts.inheritedEventCount, EVENTS.length)
  assert.equal(opts.meta.isSeeded, true)
})

test('keep mode: creates the copy but never archives the source', async () => {
  const ctx = makeCtx()
  const result = await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.equal(result.archived, false)
  assert.equal(ctx.calls.created.length, 1)
  assert.deepEqual(ctx.calls.archived, [])
  assert.deepEqual(ctx.calls.attached, [result.sessionId])
})

test('copies header origin/delegationDepth into the copy meta', async () => {
  const ctx = makeCtx({
    header: { ...HEADER, origin: 'subagent', delegationDepth: 2 },
  })
  await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  const meta = ctx.calls.created[0].meta
  assert.equal(meta.origin, 'subagent')
  assert.equal(meta.delegationDepth, 2)
})

test('works without an agentPresets service (host-composition deployments)', async () => {
  const ctx = makeCtx()
  const originalGet = ctx.get
  ctx.get = (name) => (name === 'agentPresets' ? undefined : originalGet(name))
  const result = await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  const opts = ctx.calls.created[0]
  assert.equal(opts.meta.agentPreset, undefined)
  assert.equal(opts.setup, undefined)
  assert.equal(result.archived, false)
})

test('mints distinct ids across calls', async () => {
  const ctx = makeCtx()
  const a = await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  const b = await moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' })
  assert.notEqual(a.sessionId, b.sessionId)
})

/* ------------------------------------------------------------------ */
/* failure propagation                                                 */
/* ------------------------------------------------------------------ */

test('wraps agents.create failures as copy-failed', async () => {
  const ctx = makeCtx()
  const originalGet = ctx.get
  ctx.get = (name) =>
    name === 'agents'
      ? { get: () => undefined, create: async () => { throw new Error('boom') } }
      : originalGet(name)
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' }), (e) => e.code === 'copy-failed')
})

test('wraps attach failures as attach-failed', async () => {
  const ctx = makeCtx()
  const registry = ctx.get('workspaceRegistry')
  const originalGet = ctx.get
  ctx.get = (name) => {
    if (name !== 'workspaceRegistry') return originalGet(name)
    return {
      ...registry,
      get: (id) => (id === 'w2' ? {
        id: 'w2', path: 'C:/ws2', title: 'WS2', sessionIds: [],
        status: async () => 'ok',
        attachSession: async () => { throw new Error('cwd mismatch') },
      } : registry.get(id)),
    }
  }
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' }), (e) => e.code === 'attach-failed')
})

test('wraps preset resolution failures as preset-unavailable', async () => {
  const ctx = makeCtx()
  const originalGet = ctx.get
  ctx.get = (name) =>
    name === 'agentPresets'
      ? { resolve: async () => { throw new Error('unknown preset') }, mount: async () => {} }
      : originalGet(name)
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'keep' }), (e) => e.code === 'preset-unavailable')
})

test('archive failures propagate as-is (registry is the authority)', async () => {
  const ctx = makeCtx()
  const registry = ctx.get('workspaceRegistry')
  const originalGet = ctx.get
  ctx.get = (name) => {
    if (name !== 'workspaceRegistry') return originalGet(name)
    return { ...registry, archiveSession: async () => { throw new Error('durability failed') } }
  }
  await assert.rejects(() => moveSession(ctx, { sessionId: 'src-1', targetWorkspaceId: 'w2', mode: 'archive' }), /durability failed/)
})
