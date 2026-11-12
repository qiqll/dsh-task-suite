/**
 * Read-only dashboard snapshot for the Web UI.
 *
 * The task pool is still the source of truth: this module only reads
 * `.dsh/tasks` and the live agent registry. It never mutates task state.
 */
import { STATUS } from './markdown.js'
import { TaskStore, normalizeConfig } from './store.js'

const ACTIVE_STATUSES = new Set([STATUS.DOING, STATUS.VERIFY, STATUS.BLOCKED, STATUS.DECISION, STATUS.REWORK])

function optional(ctx, name) {
  try { return ctx.get?.(name) } catch { return undefined }
}

function acceptanceOf(note) {
  return /验收：([^；\n]+)/.exec(note || '')?.[1]?.trim() || ''
}

function derivedFrom(note) {
  return /来源：衍生自\s*(T-\d{3})/.exec(note || '')?.[1] || ''
}

function parseEvents(lines) {
  const events = []
  for (const line of lines) {
    const match = /^(\S+)\s+\|\s+(T-\d{3}|INBOX|STOP|R3)\s+\|\s+([^|]+?)\s+\|\s*(.*)$/.exec(line)
    if (!match) continue
    events.push({
      time: match[1],
      task: match[2],
      event: match[3].trim(),
      detail: match[4].trim().slice(0, 240),
    })
  }
  return events
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function metricsOf({ tasks, archived, events }) {
  const completed = archived.size
  const total = tasks.length + completed
  const confirms = events.filter(e => /CONFIRM/i.test(e.event)).length
  const rejects = events.filter(e => /REJECT|打回|FAILED/i.test(e.event)).length
  const decide = confirms + rejects
  const cycles = []
  const claims = new Map()
  for (const event of events) {
    if (!/^T-\d{3}$/.test(event.task)) continue
    const time = Date.parse(event.time)
    if (!Number.isFinite(time)) continue
    if (/CLAIM/i.test(event.event)) claims.set(event.task, time)
    if (/CONFIRM/i.test(event.event) && claims.has(event.task)) {
      cycles.push(time - claims.get(event.task))
    }
  }
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const throughput7d = events.filter(e => /CONFIRM/i.test(e.event) && Date.parse(e.time) >= sevenDaysAgo).length
  return {
    completed,
    total,
    completionRate: total ? completed / total : 0,
    firstPassRate: decide ? confirms / decide : null,
    reworkRate: decide ? rejects / decide : 0,
    throughput7d,
    medianCycleMs: median(cycles),
    confirms,
    rejects,
  }
}

async function agentRows(ctx, sessionId) {
  const rows = []
  const agents = optional(ctx, 'agents')
  if (sessionId && agents?.get?.(sessionId)) {
    rows.push({ id: sessionId, label: '主 Agent', kind: 'main', activity: 'live', depth: 0, parentId: null, mode: 'main' })
  }
  const subagents = optional(ctx, 'subagents')
  if (sessionId && subagents?.listDescendants) {
    try {
      const descendants = await subagents.listDescendants(sessionId)
      for (const entry of descendants || []) {
        if (entry.kind !== 'child') continue
        rows.push({
          id: entry.id,
          label: entry.label || String(entry.id).slice(0, 8),
          kind: entry.kind,
          activity: entry.activity,
          depth: entry.depth,
          parentId: entry.parentId,
          mode: entry.mode,
        })
      }
    } catch {
      // Subagent catalogs are optional: a cold/foreign session may not have
      // one. The dashboard still works from the task pool alone.
    }
  }
  return rows
}

function loopState({ current, session, stopRequested }) {
  if (stopRequested) return 'stopped'
  if (current?.phase === 'halted') return 'halted'
  if (current) return 'running'
  if (session?.active) return 'running'
  if (session) return 'stopped'
  return 'idle'
}

export async function buildDashboard({ cwd, config, sessionId, ctx }) {
  const store = new TaskStore(cwd, normalizeConfig(config))
  if (!(await store.initialized())) {
    return {
      schema: 1,
      cwd,
      initialized: false,
      generatedAt: new Date().toISOString(),
      loop: { status: 'uninitialized' },
      counts: {},
      tasks: [],
      agents: await agentRows(ctx, sessionId),
      events: [],
      metrics: {},
    }
  }

  const data = await store.load()
  const [stopRequested, inbox, logLines] = await Promise.all([
    store.stopRequested(),
    store.readInbox().catch(() => []),
    store.logTail(160).catch(() => []),
  ])
  const current = data.current
  const session = data.session
  const events = parseEvents(logLines)
  const tasks = data.backlog.tasks
    .map(task => ({
      id: task.id,
      title: task.title,
      module: task.module,
      status: task.status,
      priority: task.priority,
      deps: task.deps,
      note: String(task.note || '').slice(0, 600),
      acceptance: acceptanceOf(task.note),
      derivedFrom: derivedFrom(task.note),
      current: current?.task === task.id,
      active: ACTIVE_STATUSES.has(task.status),
    }))
    .sort((a, b) => {
      const rank = { P0: 0, P1: 1, P2: 2, P3: 3 }
      return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || a.id.localeCompare(b.id)
    })

  const counts = { todo: 0, doing: 0, verify: 0, blocked: 0, decision: 0, rework: 0, done: data.archived.size, cancelled: 0 }
  for (const task of tasks) {
    if (task.status === STATUS.TODO) counts.todo++
    else if (task.status === STATUS.DOING) counts.doing++
    else if (task.status === STATUS.VERIFY) counts.verify++
    else if (task.status === STATUS.BLOCKED) counts.blocked++
    else if (task.status === STATUS.DECISION) counts.decision++
    else if (task.status === STATUS.REWORK) counts.rework++
    else if (task.status === STATUS.CANCELLED) counts.cancelled++
  }

  return {
    schema: 1,
    cwd,
    initialized: true,
    generatedAt: new Date().toISOString(),
    loop: {
      status: loopState({ current, session, stopRequested }),
      active: Boolean(session?.active),
      stopRequested,
      session: session
        ? {
            started: session.run_started || null,
            max: session.max ?? null,
            hours: session.hours ?? null,
            done: session.done ?? 0,
            noprog: session.noprog ?? 0,
            stopReason: session.stop_reason || '',
          }
        : null,
      current: current
        ? {
            task: current.task,
            title: current.title,
            phase: current.phase,
            worker: current.worker,
            started: current.started || null,
            mode: current.mode || '',
            snapshotCount: current.snapshot_count || 0,
            gateNote: current.gate_note || '',
            nonce: current.nonce || '',
          }
        : null,
      inbox: inbox.length,
    },
    counts,
    tasks,
    agents: await agentRows(ctx, sessionId),
    events: events.slice(-40),
    metrics: metricsOf({ tasks, archived: data.archived, events }),
    plan: String(data.plan || '').slice(0, 4000),
    progressTail: String(data.progress || '').split(/\r?\n/).slice(-30).join('\n'),
  }
}

/** Resolve the pool root for a browser request. */
export async function resolveDashboardCwd(ctx, sessionId, requestedCwd, config) {
  const agents = optional(ctx, 'agents')
  if (sessionId && agents?.get) {
    const agent = agents.get(sessionId)
    if (agent) {
      try {
        const cwd = await ctx.workingDirectory.ensure(agent)
        if (cwd) return cwd
      } catch {
        // Fall through to the request/default directory.
      }
    }
  }
  if (typeof requestedCwd === 'string' && requestedCwd.startsWith('/')) {
    try {
      if (await new TaskStore(requestedCwd, normalizeConfig(config)).initialized()) return requestedCwd
    } catch {
      // Ignore an unreadable candidate and use the host default.
    }
  }
  return ctx?.workingDirectory?.defaultDirectory || process.cwd()
}
