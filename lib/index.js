/**
 * dsh-custom-system-prompt — host half.
 *
 * Persists per-session custom system prompts through the `settings` service
 * and injects them into the right conversation:
 *
 *   - `settings.register` owns the namespace `dsh-custom-system-prompt`
 *     (shape: `{ sessions: { [sessionId]: text } }`), so every value survives
 *     a process restart.
 *   - On `agent/created` the plugin registers ONE prompt section through that
 *     agent's own scoped context (`agent.ctx.systemPrompt.section(...)`), which
 *     makes the section visible only to that session. The section text is a
 *     provider evaluated at every assembly, so a settings change applies to
 *     the next model step without re-registering anything; an empty string is
 *     dropped by the renderer, so a cleared conversation simply has no extra
 *     section.
 *   - Two loopback-only routes serve the settings card:
 *       GET  /plugins/dsh-custom-system-prompt/config    — current sessions map
 *       PATCH /plugins/dsh-custom-system-prompt/config   — upsert one session's text
 *       GET  /plugins/dsh-custom-system-prompt/sessions  — live sessions (id + title)
 *
 * Uses only the public DSH plugin contract (cordis services `settings`,
 * `systemPrompt`, `agents`, `webServer`; schemastery config schema).
 */
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-custom-system-prompt'
export const inject = ['settings', 'systemPrompt', 'agents', 'webServer', 'sessionTitle']

export const Config = Schema.object({
  sessions: Schema.dict(Schema.string()).default({}).description('每个会话注入的系统提示：key 为 sessionId'),
}).description('按会话自定义系统提示')

const BASE_PATH = '/plugins/dsh-custom-system-prompt'
const SECTION_NAME = 'custom-user-prompt'
const SECTION_ORDER = 50

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function apply(ctx) {
  const settings = ctx.settings
  const systemPrompt = ctx.systemPrompt
  const agents = ctx.agents

  const scope = settings.register('dsh-custom-system-prompt', Config, {
    base: { sessions: {} },
    applies: 'live',
  })

  const sessionsOf = () => {
    const value = scope.get()
    return (value && typeof value === 'object' && value.sessions
      && typeof value.sessions === 'object') ? value.sessions : {}
  }

  /** Register the per-session prompt section through the agent's own scoped ctx. */
  function registerForAgent(agent) {
    const sessionId = agent.id
    try {
      agent.ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: () => sessionsOf()[sessionId] ?? '',
      })
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-custom-system-prompt] section for ${sessionId}: ${error.message}`)
    }
  }

  // Already-live agents (plugin loaded after a session started) plus every
  // future one. `agent/created` is scope-filtered; a root listener receives
  // every agent's creation.
  for (const agent of agents.list()) registerForAgent(agent)
  const offCreated = ctx.on('agent/created', ({ agent }) => registerForAgent(agent))

  const sendConfig = (res) => json(res, 200, { sessions: sessionsOf() })

  const readPatch = async (req) => {
    const chunks = []
    let bytes = 0
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 16384) throw new Error('request body too large')
      chunks.push(chunk)
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('patch must be an object')
    }
    if (typeof value.sessionId !== 'string' || !value.sessionId) throw new Error('sessionId must be a non-empty string')
    if (typeof value.text !== 'string') throw new Error('text must be a string')
    return { sessionId: value.sessionId, text: value.text }
  }

  const handleConfig = async (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress)) return json(res, 403, { error: 'local access only' })
    if (req.method === 'GET') return sendConfig(res)
    if (req.method !== 'PATCH') return json(res, 405, { error: 'method not allowed' })
    const origin = req.headers?.origin
    if (origin) {
      let originHost
      try { originHost = new URL(origin).host } catch { /* malformed */ }
      if (!originHost || originHost !== req.headers.host) return json(res, 403, { error: 'origin mismatch' })
    }
    try {
      const { sessionId, text } = await readPatch(req)
      const current = sessionsOf()
      const next = { ...current }
      if (text === '') delete next[sessionId]
      else next[sessionId] = text
      // `update` deep-merges, so a removed key would survive; `replace` swaps
      // the whole user section, which is exactly the removal/reset path.
      await scope.replace({ sessions: next })
      return sendConfig(res)
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleSessions = (req, res) => {
    if (!isLoopback(req.socket?.remoteAddress)) return json(res, 403, { error: 'local access only' })
    if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
    const sessions = agents.list().map((agent) => {
      // The session-title service folds the latest `session/title` event from
      // the session log; sessions without any title yet (e.g. brand-new or
      // subagent sessions) yield undefined, and the card falls back to the id.
      const snapshot = ctx.sessionTitle.get(agent.session)
      return { id: agent.id, title: snapshot?.title ?? null }
    })
    return json(res, 200, { sessions })
  }

  const disposers = [
    offCreated,
    ctx.webServer.register({ kind: 'exact', path: `${BASE_PATH}/config`, handler: handleConfig }),
    ctx.webServer.register({ kind: 'exact', path: `${BASE_PATH}/sessions`, handler: handleSessions }),
  ]

  ctx.logger?.info?.('[dsh-custom-system-prompt] host mounted')
  return () => {
    for (const dispose of disposers) dispose()
  }
}
