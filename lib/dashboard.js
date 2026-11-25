/**
 * Read-only dashboard snapshot for the Web UI.
 *
 * The task pool is still the source of truth: this module only reads
 * `.dsh/tasks` and the live agent registry. It never mutates task state.
 *
 * Metrics and the 待验证 cards follow claude-task 0.3.10–0.3.13:
 * - every rate / duration is `null` when run.log holds nothing to count, so the
 *   panel renders `—` instead of `NaN`;
 * - delivery / rejection / auto-close are counted per task, so a REJECT line
 *   plus the loop's REJECTED line for the same rejection is one intervention;
 * - dates and durations are UTC, like `run.log` (`new Date().toISOString()`).
 */
import { STATUS } from './markdown.js'
import { TaskStore, normalizeConfig } from './store.js'
import { verifyState, timeoutDaysOf } from './verifyflow.js'

const ACTIVE_STATUSES = new Set([STATUS.DOING, STATUS.VERIFY, STATUS.BLOCKED, STATUS.DECISION, STATUS.REWORK])
const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_WINDOW_DAYS = 7
/** `DONE→待验证`, `FAILED（超时）→阻塞`: result / state of an ended run. */
const RUN_OUTCOME_RE = /^([A-Z_]+)[^→]*→\s*(\S*)/
const REJECT_RE = /^REJECT(ED|_CMD)?$/
/** REJECT + REJECTED written by the same decision are one rejection episode. */
const REJECT_EPISODE_GAP_MS = 60 * 1000

function optional(ctx, name) {
  try { return ctx.get?.(name) } catch { return undefined }
}

function acceptanceOf(note) {
  return /验收：([^；\n]+)/.exec(note || '')?.[1]?.trim() || ''
}

function derivedFrom(note) {
  return /来源：衍生自\s*(T-\d{3})/.exec(note || '')?.[1] || ''
}

/**
 * run.log 的时间戳是 ISO（`2026-11-25T09:00:00.000Z`）。老日志 / 手写行可能是
 * `2026-11-25 09:00:00`：按 UTC 解释，不做本地时区换算。
 */
export function parseStamp(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const spaced = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/.exec(raw)
  if (spaced) {
    const time = Date.parse(`${spaced[1]}T${spaced[2]}:${spaced[3] ?? '00'}Z`)
    return Number.isFinite(time) ? time : null
  }
  const time = Date.parse(raw)
  return Number.isFinite(time) ? time : null
}

export function parseEvents(lines) {
  const events = []
  for (const line of lines) {
    const parts = String(line ?? '').split(' | ')
    if (parts.length < 3) continue
    const time = parts[0].trim()
    const task = parts[1].trim()
    if (!/^(T-\d{3}|INBOX|STOP|R3)$/.test(task)) continue
    events.push({
      time,
      at: parseStamp(time),
      task,
      event: (parts[2] || '').trim(),
      detail: parts.slice(3).join(' | ').trim().slice(0, 240),
    })
  }
  return events
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function formatPercent(rate) {
  return Number.isFinite(rate) ? `${Math.round(rate * 100)}%` : '—'
}

/** 与面板 client.js 的 duration() 同口径：`3h 12m` / `2d 5h`。 */
function formatSpan(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}h ${min % 60}m`
  return `${Math.floor(hour / 24)}d ${hour % 24}h`
}

/** 一次已结束的 run：`FAILED（超时）→阻塞` → `{ result: 'FAILED', state: '阻塞' }`。 */
export function runOutcome(event) {
  if (!/^T-\d{3}$/.test(event?.task || '')) return null
  const match = RUN_OUTCOME_RE.exec(event.event || '')
  return match ? { result: match[1], state: match[2] } : null
}

/** 近 `sinceMs` 内的打回次数：同一任务的 REJECT / REJECTED / REJECT_CMD 一分钟内合并为一次。 */
export function rejectionEpisodes(events, sinceMs = -Infinity) {
  const byTask = new Map()
  for (const event of events) {
    if (!/^T-\d{3}$/.test(event.task)) continue
    if (!REJECT_RE.test(event.event)) continue
    if (event.at == null || event.at < sinceMs) continue
    const list = byTask.get(event.task) || []
    list.push(event.at)
    byTask.set(event.task, list)
  }
  let count = 0
  for (const list of byTask.values()) {
    list.sort((a, b) => a - b)
    let previous = -Infinity
    for (const at of list) {
      if (at - previous > REJECT_EPISODE_GAP_MS) count++
      previous = at
    }
  }
  return count
}

export function metricsOf({ tasks, archived, events, nowMs = Date.now(), windowDays = DEFAULT_WINDOW_DAYS }) {
  // 归档集合：dev-progress 里有记录、但任务又被手工放回表里的（重开）按在办算。
  const open = new Set(tasks
    .filter(task => task.status !== STATUS.DONE && task.status !== STATUS.CANCELLED)
    .map(task => task.id))
  const archivedIds = new Set([...archived].filter(id => !open.has(id)))
  for (const task of tasks) if (task.status === STATUS.DONE) archivedIds.add(task.id)
  const completed = archivedIds.size
  const total = completed + open.size
  const wip = tasks.filter(task => task.status === STATUS.DOING).length
  const verify = tasks.filter(task => task.status === STATUS.VERIFY).length

  const delivered = new Set()
  const redone = new Set()
  const unattended = new Set()
  const closedNow = new Set()
  const deliveredTimes = []
  const decisionWaits = []
  const suspended = new Map()
  const claimed = new Map()
  const cycles = []
  let runEnds = 0
  let rollbacks = 0
  let interventionRuns = 0
  const windowStart = nowMs - windowDays * DAY_MS

  for (const event of events) {
    if (!/^T-\d{3}$/.test(event.task) || event.at == null) continue

    if (/^CLAIM$/i.test(event.event)) claimed.set(event.task, event.at)

    if (REJECT_RE.test(event.event)) {
      redone.add(event.task)
      closedNow.delete(event.task)
    }

    // 交付：`DONE→待验证`（自动验收记 `DONE→已完成（自动验收）`）。
    if (/^DONE[^→]*→/.test(event.event)) {
      delivered.add(event.task)
      deliveredTimes.push(event.at)
      if (/打回/.test(event.event)) redone.add(event.task)
    }

    // 免验关闭：自动验收直接归档，或待验证超时默认通过。
    if (event.event === 'TIMEOUT_PASS' || /^DONE[^→]*→\s*已完成/.test(event.event)) {
      unattended.add(event.task)
      closedNow.add(event.task)
    }

    if (/^CONFIRM$/i.test(event.event) && claimed.has(event.task)) {
      cycles.push(event.at - claimed.get(event.task))
      claimed.delete(event.task)
    }

    const outcome = runOutcome(event)
    if (outcome) {
      runEnds++
      if (/^(待决策|阻塞)/.test(outcome.state)) {
        suspended.set(event.task, event.at)
        if (event.at >= windowStart) interventionRuns++
      }
    } else if (/^(DECIDED|DONE)/.test(event.event) && suspended.has(event.task)) {
      decisionWaits.push(event.at - suspended.get(event.task))
      suspended.delete(event.task)
    }

    if (event.event === 'ROLLBACK') rollbacks++
  }

  // 已交付、现在停在「打回」的任务也算被打回过；只统计真的交付过的。
  for (const task of tasks) {
    if (task.status === STATUS.REWORK && delivered.has(task.id)) redone.add(task.id)
  }
  for (const id of redone) if (!delivered.has(id)) redone.delete(id)

  // 一次通过率按任务：排除自动验收 / 超时默认通过（没人看过），被人打回过的算没通过。
  const judged = [...delivered].filter(id => redone.has(id) || !unattended.has(id)).length
  const firstPassRate = judged ? (judged - redone.size) / judged : null
  const rejects = rejectionEpisodes(events)
  const interventions = events.length ? rejects + interventionRuns : null

  // 中位周期以 CLAIM → CONFIRM 为准；老日志没有 CONFIRM 时退回 DISPATCH → run 结束。
  let cycleSource = cycles.length ? 'claim-confirm' : null
  if (!cycles.length) {
    const dispatched = new Map()
    for (const event of events) {
      if (event.at == null || !/^T-\d{3}$/.test(event.task)) continue
      if (/^DISPATCH$/i.test(event.event)) dispatched.set(event.task, event.at)
      else if (runOutcome(event) && dispatched.has(event.task)) {
        cycles.push(event.at - dispatched.get(event.task))
        dispatched.delete(event.task)
      }
    }
    if (cycles.length) cycleSource = 'dispatch-outcome'
  }

  const medianCycleMs = median(cycles)
  const decisionWaitMs = median(decisionWaits)
  const rollbackRate = runEnds ? rollbacks / runEnds : null
  const autoClosed = closedNow.size
  const throughput7d = deliveredTimes.filter(at => at >= windowStart).length

  return {
    completed,
    total,
    completionRate: total ? completed / total : null,
    firstPassRate,
    throughput7d,
    delivered7d: throughput7d,
    medianCycleMs,
    cycleSource,
    wip,
    verify,
    interventions,
    decisionWaitMs,
    rollbacks,
    rollbackRate,
    autoClosed,
    runs: runEnds,
    delivered: delivered.size,
    rejects,
    confirms: events.filter(event => /^CONFIRM$/i.test(event.event)).length,
    windowDays,
    // 面板直接渲染这些字符串；无数据是 `—`，不会是 NaN。
    text: {
      completionRate: formatPercent(total ? completed / total : null),
      firstPassRate: formatPercent(firstPassRate),
      throughput7d: String(throughput7d),
      medianCycle: formatSpan(medianCycleMs),
      wip: String(wip),
      verify: String(verify),
      interventions: interventions == null ? '—' : String(interventions),
      decisionWait: formatSpan(decisionWaitMs),
      rollbackRate: formatPercent(rollbackRate),
      autoClosed: String(autoClosed),
    },
  }
}

/** note 里「不默认通过」的原因（verifyflow 写入的标记）。 */
export function holdReasonsOf(note) {
  const text = String(note ?? '')
  const reasons = []
  if (/默认通过[:：]\s*否/.test(text)) reasons.push('默认通过：否')
  for (const match of text.matchAll(/⚠\s*(高风险区域改动|测试有改动)[：:]\s*([^；\n]+)/g)) {
    reasons.push(`${match[1]}：${match[2].trim()}`)
  }
  return reasons
}

function holdLabel(reason) {
  if (reason.startsWith('默认通过：否')) return '默认通过：否'
  if (reason.startsWith('高风险区域改动')) return '高风险区域改动'
  if (reason.startsWith('测试有改动')) return '测试有改动'
  return reason
}

/** 待验证卡片：怎么验（≤3 步）、默认通过日 / 不默认通过的原因、已等待天数、hold。 */
export function verifyCardOf(task, { timeoutDays, nowMs } = {}) {
  const state = verifyState(task, { timeoutDays, nowMs })
  const steps = String(state.steps || '')
    .split(/\s*(?:→|->)\s*/)
    .map(step => step.trim())
    .filter(step => step && step !== '—')
    .slice(0, 3)
  const holdReasons = holdReasonsOf(task.note)
  const labels = holdReasons.map(holdLabel)
  const phase = state.disabled ? 'disabled'
    : state.hold ? 'hold'
      : state.days == null ? 'unknown'
        : state.closable ? 'closing'
          : state.announced ? 'announced'
            : state.dueSoon ? 'due'
              : 'waiting'

  let defaultPass
  let defaultPassText
  if (state.disabled) {
    defaultPass = { enabled: false, due: '', reason: '待验证超时已关闭' }
    defaultPassText = '不默认通过：待验证超时已关闭'
  } else if (state.hold) {
    defaultPass = { enabled: false, due: '', reason: labels.join(' / ') || '高风险 / 测试改动' }
    defaultPassText = `不默认通过：${labels.join(' / ') || '高风险 / 测试改动'}`
  } else if (state.days == null) {
    defaultPass = { enabled: true, due: state.due, reason: '缺待验证起' }
    defaultPassText = '默认通过：待推算（缺待验证起）'
  } else {
    defaultPass = { enabled: true, due: state.due, reason: '' }
    defaultPassText = `默认通过：${state.due}`
  }

  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    module: task.module,
    deps: task.deps,
    acceptance: acceptanceOf(task.note),
    howToVerify: steps.join(' → '),
    steps,
    howToVerifyMissing: steps.length === 0,
    waitingDays: state.days,
    verifySince: state.start,
    inferred: state.inferred,
    due: state.due,
    timeoutDays: state.timeoutDays,
    announced: state.announced,
    announceAt: state.announceText || '',
    hold: state.hold,
    holdReasons,
    phase,
    defaultPass,
    defaultPassText,
  }
}

export function verifyCardsOf(tasks, backlog, nowMs = Date.now()) {
  const timeoutDays = timeoutDaysOf(backlog)
  return tasks
    .filter(task => task.status === STATUS.VERIFY)
    .map(task => verifyCardOf(task, { timeoutDays, nowMs }))
    .sort((a, b) => (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.id.localeCompare(b.id))
}

function dedupeById(rows) {
  const seen = new Set()
  return rows.filter(row => {
    if (!row?.id || seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

function activityOf(entry) {
  return entry?.activity || entry?.status || entry?.phase || 'unknown'
}

/**
 * 会话内正在运行的 agent。DSH 不同版本暴露的服务形状不同，这里只用现有
 * `optional(ctx, name)` 取 `agents` / `subagents` / `sessions`，取不到就返回空，
 * 由 current.json 的 worker 字段降级，绝不伪造。
 */
async function liveAgentRows(ctx, sessionId) {
  const rows = []
  if (!sessionId) return rows

  const agents = optional(ctx, 'agents')
  if (agents?.get?.(sessionId)) {
    rows.push({ id: sessionId, label: '主 Agent', kind: 'main', activity: 'live', depth: 0, parentId: null, mode: 'main', source: 'live' })
  }

  const subagents = optional(ctx, 'subagents')
  if (subagents?.listDescendants) {
    try {
      const descendants = await subagents.listDescendants(sessionId)
      for (const entry of descendants || []) {
        if (entry?.kind !== 'child') continue
        rows.push({
          id: entry.id,
          label: entry.label || String(entry.id).slice(0, 8),
          kind: entry.kind,
          activity: activityOf(entry),
          depth: entry.depth,
          parentId: entry.parentId,
          mode: entry.mode,
          source: 'live',
        })
      }
    } catch {
      // Subagent catalogs are optional: a cold/foreign session may not have
      // one. The dashboard still works from the task pool alone.
    }
  }

  const sessions = optional(ctx, 'sessions')
  if (sessions) {
    try {
      const entry = sessions.get?.(sessionId)
        || sessions.list?.()?.find?.(item => item?.id === sessionId || item?.sessionId === sessionId)
      const children = entry?.children || entry?.subagents || entry?.agents || []
      for (const child of Array.isArray(children) ? children : []) {
        const id = child?.id || child?.agentId || child?.sessionId
        if (!id) continue
        rows.push({
          id,
          label: child.label || child.name || String(id).slice(0, 8),
          kind: child.kind || 'child',
          activity: activityOf(child),
          depth: child.depth ?? 1,
          parentId: sessionId,
          mode: child.mode || 'subagent',
          source: 'live',
        })
      }
    } catch {
      // Same as above: an unknown sessions shape degrades to current.json.
    }
  }

  return dedupeById(rows)
}

/** 降级：current.json 的 worker + run.log 里该任务最近一条活动（标 source: 'current'）。 */
function workerRowsFromCurrent({ current, events, sessionId }) {
  if (!current?.task) return []
  const taskEvents = events.filter(event => event.task === current.task)
  const last = taskEvents.at(-1) || events.at(-1)
  const activity = current.phase === 'running' ? 'running' : (current.phase || 'unknown')
  return [{
    id: current.worker || `worker-${current.task}`,
    label: current.worker || `worker-${current.task}`,
    kind: 'worker',
    activity,
    depth: 0,
    parentId: sessionId || null,
    mode: current.mode || '',
    source: 'current',
    task: current.task,
    lastActivity: last
      ? { at: last.time, event: last.event, detail: last.detail }
      : null,
  }]
}

async function agentSnapshot({ ctx, sessionId, current, events }) {
  const rows = await liveAgentRows(ctx, sessionId)
  if (rows.some(row => row.kind !== 'main')) {
    return { agents: rows, agentsSource: 'live' }
  }
  const fallback = workerRowsFromCurrent({ current, events, sessionId })
  if (fallback.length) {
    return { agents: dedupeById([...rows, ...fallback]), agentsSource: 'current' }
  }
  return { agents: rows, agentsSource: rows.length ? 'live' : 'none' }
}

function loopState({ current, session, stopRequested }) {
  if (stopRequested) return 'stopped'
  if (current?.phase === 'halted') return 'halted'
  if (current) return 'running'
  if (session?.active) return 'running'
  if (session) return 'stopped'
  return 'idle'
}

export async function buildDashboard({ cwd, config, sessionId, ctx, nowMs = Date.now() }) {
  const store = new TaskStore(cwd, normalizeConfig(config))
  if (!(await store.initialized())) {
    const snapshot = await agentSnapshot({ ctx, sessionId, current: null, events: [] })
    return {
      schema: 1,
      cwd,
      initialized: false,
      generatedAt: new Date(nowMs).toISOString(),
      loop: { status: 'uninitialized' },
      counts: {},
      tasks: [],
      verifyCards: [],
      agents: snapshot.agents,
      agentsSource: snapshot.agentsSource,
      events: [],
      metrics: {},
    }
  }

  const data = await store.load()
  const [stopRequested, inbox, logLines] = await Promise.all([
    store.stopRequested(),
    store.readInbox().catch(() => []),
    store.logTail(200).catch(() => []),
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

  const snapshot = await agentSnapshot({ ctx, sessionId, current, events })

  return {
    schema: 1,
    cwd,
    initialized: true,
    generatedAt: new Date(nowMs).toISOString(),
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
    verifyCards: verifyCardsOf(tasks, data.backlog, nowMs),
    agents: snapshot.agents,
    agentsSource: snapshot.agentsSource,
    events: events.slice(-40),
    metrics: metricsOf({ tasks, archived: data.archived, events, nowMs }),
    plan: String(data.plan || '').slice(0, 4000),
    progressTail: String(data.progress || '').split(/\r?\n/).slice(-30).join('\n'),
  }
}

async function initializedCwd(ctx, cwd, config) {
  try {
    return cwd && await new TaskStore(cwd, normalizeConfig(config)).initialized() ? cwd : null
  } catch {
    return null
  }
}

/** Resolve the pool root for a browser request. */
export async function resolveDashboardCwd(ctx, sessionId, requestedCwd, config) {
  const agents = optional(ctx, 'agents')
  let fallback = ''

  if (sessionId && agents?.get) {
    const agent = agents.get(sessionId)
    if (agent) {
      try {
        const cwd = await ctx.workingDirectory.ensure(agent)
        if (cwd) {
          if (await initializedCwd(ctx, cwd, config)) return cwd
          fallback ||= cwd
        }
      } catch {
        // Fall through to the request/registry/default directory.
      }
    }
  }

  if (typeof requestedCwd === 'string' && requestedCwd.startsWith('/')) {
    if (await initializedCwd(ctx, requestedCwd, config)) return requestedCwd
  }

  // A dashboard tab can be opened outside a Session (or its scope can be
  // empty). Fall back to live agents first, then the durable workspace
  // registry, so the panel shows the workspace the user is actually using
  // instead of the profile's own directory.
  const roots = agents?.roots?.() || []
  for (const agent of roots) {
    try {
      const cwd = await ctx.workingDirectory.ensure(agent)
      if (await initializedCwd(ctx, cwd, config)) return cwd
      fallback ||= cwd
    } catch {
      // Ignore an agent whose directory cannot be resolved.
    }
  }

  const registry = optional(ctx, 'workspaceRegistry')
  const workspaces = registry?.list?.() || []
  for (const workspace of workspaces) {
    const cwd = workspace?.path
    if (await initializedCwd(ctx, cwd, config)) return cwd
    fallback ||= cwd
  }

  return fallback || ctx?.workingDirectory?.defaultDirectory || process.cwd()
}
