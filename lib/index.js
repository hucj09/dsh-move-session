/**
 * dsh-move-session — host half.
 *
 * Cross-workspace session migration for the dsh web GUI. Exposes one
 * loopback-only HTTP route:
 *
 *   POST /api/dsh-move-session/move
 *   body: { sessionId, targetWorkspaceId, mode: "keep" | "archive" }
 *
 * Semantics (mirrors the shipped `session.fork` handler as closely as
 * possible, extended to a different workspace):
 *
 *   1. Only IDLE sessions can be moved (a running agent rejects the request).
 *   2. The durable log is read from session persistence (the live session is
 *      flushed first so no buffered event is lost).
 *   3. A new session identity is minted in the TARGET workspace with the same
 *      event log, the source as parent lineage, and the source's agent preset
 *      and model selection preserved.
 *   4. The copy is published as a live agent via `agents.create` (same path
 *      the shipped fork uses), so the browser receives the `host/session-added`
 *      frame and every tab's sidebar updates without a refresh.
 *   5. The copy is attached to the target workspace's durable account
 *      (`workspace.attachSession`) — this pushes `host/workspace-changed`.
 *   6. With mode "archive", the source session is archived through the
 *      workspace registry (the shipped archive set; `host/archived-sessions-changed`).
 *
 * The package is a plain Cordis plugin: zero dependencies, mounted via
 * cordis.patch.yml (see the repository README).
 */

const NAME = 'dsh-move-session'

/** Module-local monotonic counter so minted ids stay unique within the process. */
let idSeq = 0

/** Mint a fresh session id that cannot collide with ids minted earlier in this process. */
function mintSessionId() {
  idSeq += 1
  return `session-mv-${Date.now().toString(36)}-${idSeq.toString(36)}`
}

/** Business rejection carrying a stable machine-readable code. */
function businessError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * The preset a session actually runs, newest selection winning — the same
 * resolution the shipped apiproxy uses (header value, overridden by the last
 * logged `agent-preset/selected` event).
 */
function sessionPresetId(header, events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && event.type === 'agent-preset/selected' && event.data && typeof event.data.agentPreset === 'string') {
      return event.data.agentPreset
    }
  }
  return header && header.agentPreset
}

/**
 * The model the source conversation last ran under, from the last
 * `request/header` event. Used to seed the moved copy so it keeps calling the
 * same provider/model (the shipped fork seeds the current default instead;
 * inheriting from the log is a strict improvement for a move).
 */
function lastModelOptions(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && event.type === 'request/header' && event.data && event.data.header && event.data.header.config) {
      const config = event.data.header.config
      const options = {}
      if (typeof config.provider === 'string') options.provider = config.provider
      if (typeof config.model === 'string') options.model = config.model
      if (options.provider !== undefined || options.model !== undefined) return options
    }
  }
  return undefined
}

/**
 * Compose the moved session's agent world — the public-service equivalent of
 * the apiproxy's private `composeAgent`: resolve the preset id, then mount it
 * into the agent context during setup (the standing mount is shared with every
 * agent naming the same preset, so no duplicate composition is created).
 */
async function composeFor(ctx, header, events) {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) return {}
  const presetId = sessionPresetId(header, events)
  let resolvedId
  try {
    resolvedId = (await presets.resolve(presetId)).id
  } catch (error) {
    throw businessError(
      'preset-unavailable',
      `cannot resolve the agent preset for the moved session: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, resolvedId)
    },
  }
}

/**
 * The whole move. Throws businessError on every rejectable outcome; resolves
 * with `{ sessionId, archived }` after durability.
 */
async function moveSession(ctx, input) {
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
  const targetWorkspaceId = typeof input.targetWorkspaceId === 'string' ? input.targetWorkspaceId : ''
  const mode = input.mode === 'archive' ? 'archive' : input.mode === 'keep' ? 'keep' : ''
  if (sessionId === '') throw businessError('invalid-session', 'sessionId is required')
  if (targetWorkspaceId === '') throw businessError('invalid-target', 'targetWorkspaceId is required')
  if (mode === '') throw businessError('invalid-mode', 'mode must be "keep" or "archive"')

  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  const registry = ctx.get('workspaceRegistry')
  if (agents === undefined || persistence === undefined || registry === undefined) {
    throw businessError('unavailable', 'required host services (agents / sessionPersistence / workspaceRegistry) are unavailable')
  }

  // 1. idle-only migration
  const agent = agents.get(sessionId)
  if (agent !== undefined && agent.status === 'running') {
    throw businessError('session-busy', 'the session is currently running; only idle sessions can be moved')
  }

  // 2. durable full log — flush a live session first so buffered events count
  const live = sessions === undefined ? undefined : sessions.get(sessionId)
  if (live !== undefined) {
    try {
      await sessions.flush(live)
    } catch {
      // best effort: the stored log remains the source of truth
    }
  }
  let read
  try {
    read = await persistence.readFrom(sessionId, 0)
  } catch (error) {
    throw businessError('session-not-found', `cannot read session "${sessionId}": ${error instanceof Error ? error.message : String(error)}`)
  }
  const header = read && read.meta
  const events = read ? read.events : []
  if (!header) throw businessError('session-not-found', `session "${sessionId}" was not found in session persistence`)

  // 3. target workspace + same-workspace guard
  const target = registry.get(targetWorkspaceId)
  if (target === undefined) throw businessError('target-not-found', `workspace "${targetWorkspaceId}" was not found`)
  const sourceWorkspace = registry.list().find((workspace) => workspace.sessionIds.includes(sessionId))
  if (sourceWorkspace !== undefined && String(sourceWorkspace.id) === String(targetWorkspaceId)) {
    throw businessError('same-workspace', 'the session already belongs to the target workspace')
  }

  // 4. mint the moved identity: new id, target cwd, source lineage
  const newId = mintSessionId()
  const seedLength = events.length

  // 5. publish the moved session as a live agent — the shipped fork path
  const composition = await composeFor(ctx, header, events)
  const agentOptions = lastModelOptions(events)
  try {
    await agents.create({
      sessionId: newId,
      seed: events,
      meta: {
        cwd: target.path,
        parentSession: header.id,
        seedLength,
        ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
        ...(header.origin === undefined ? {} : { origin: header.origin }),
        ...(header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth }),
      },
      agentOptions,
      ...(composition.setup === undefined ? {} : { setup: composition.setup }),
    })
  } catch (error) {
    throw businessError('copy-failed', `failed to create the moved session: ${error instanceof Error ? error.message : String(error)}`)
  }

  // 6. account the copy in the target workspace (durable + change frame)
  try {
    await target.attachSession(newId)
  } catch (error) {
    throw businessError(
      'attach-failed',
      `the session was copied but could not attach to workspace "${target.title}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // 7. archive the source on request
  let archived = false
  if (mode === 'archive') {
    await registry.archiveSession(sessionId)
    archived = true
  }

  return { sessionId: newId, archived }
}

/* ------------------------------------------------------------------ */
/* HTTP route plumbing (mirrors the dsh-ssh family conventions)        */
/* ------------------------------------------------------------------ */

/** Loopback-only guard: the browser GUI and the host share one machine. */
function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Read a small JSON request body; returns undefined for oversized/ malformed bodies. */
async function readJsonBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    chunks.push(chunk)
    total += chunk.length
    if (total > 64 * 1024) return undefined
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export const name = NAME
export const inject = ['webServer']

// Exported for the automated test suite (test/host.move.test.js); the plugin
// surface itself is `name` / `inject` / `apply`.
export { moveSession, mintSessionId, businessError, sessionPresetId, lastModelOptions, composeFor }

export function apply(ctx) {
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: '/api/dsh-move-session/move',
      handler: async (req, res) => {
        if (!isLoopback(req)) return writeJson(res, 403, { error: 'forbidden: loopback-only' })
        if ((req.method ?? 'GET') !== 'POST') return writeJson(res, 405, { error: 'method not allowed: POST only' })
        const body = await readJsonBody(req)
        if (body === undefined || body === null || typeof body !== 'object') {
          return writeJson(res, 400, { error: 'invalid JSON body' })
        }
        try {
          const result = await moveSession(ctx, body)
          writeJson(res, 200, { ok: true, ...result })
        } catch (error) {
          const code = error && error.code ? error.code : 'internal'
          const message = error instanceof Error ? error.message : String(error)
          if (code === 'internal') writeJson(res, 500, { error: message, code })
          else writeJson(res, 400, { error: message, code })
        }
      },
    })
    return () => {
      dispose()
    }
  }, 'dsh-move-session: routes')
}
