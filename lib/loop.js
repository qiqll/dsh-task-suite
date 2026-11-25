import { join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { STATUS, PRIORITIES, PRIORITY_TITLES } from './markdown.js'
import {
  taskById, addTasks, nextTask, claimTask, writePlan, countsOf,
  answerTask, confirmTask, rejectTask, reopenArchivedTask,
} from './tasks.js'
import { day, epoch, formatDuration, git, gitText, readText, truncate } from './util.js'
import { dirtyPaths } from './verify.js'
import { diffAgainstSnapshot } from './filesnapshot.js'
import { checkVerifyTimeout, describeVerifyRows, MANUAL_VERIFY_RE, setDefaultPassOff } from './verifyflow.js'
import { notifyTask } from './notify.js'

const DECISION_RE = /^(通过|ok|OK|好的|没问题|确认|可以|PASS|pass)\b|^选\s*A|^A（推荐）/

export function timeoutSummary(timeout) {
  if (!timeout) return ''
  const parts = []
  if (timeout.closed?.length) parts.push(`到期默认通过已归档：${timeout.closed.map(c => `${c.task}（${c.days} 天）`).join('、')}`)
  if (timeout.announced?.length) parts.push(`明天默认通过：${timeout.announced.map(a => a.task).join('、')}（有问题用 task_reject 打回）`)
  if (timeout.held?.length) parts.push(`不默认通过（高风险 / 改测试 / 已设置）：${timeout.held.map(h => h.task).join('、')}`)
  if (timeout.decisions?.length) parts.push(`交付提交不可达转待决策：${timeout.decisions.map(d => d.task).join('、')}`)
  return parts.length ? `\n\n待验证到期检查：${parts.join('；')}` : ''
}

/**
 * worker 停滞看门狗（对齐 claude-task 0.3.8 的 worker_progress.sh，只读）。
 *
 * 心跳时比较两个时间戳，不读 transcript、不给 subagent 发消息：
 * - out  = worker 输出（current.output 指向的文件，缺省用 auto/run.log）多久没增长 → IDLE
 * - tree = 工作区多久没变（新提交 / 非开工脏文件的改动）→ 输出在长但 tree 不动 = SPIN
 * 命中时写一行 `WATCHDOG`，并在 tick / task_status 里给调度员「建议 nudge / 建议停止」。
 */
const WATCHDOG_LOG_GAP_MS = 10 * 60 * 1000
const WATCHDOG_SCAN_LIMIT = 4000
const WATCHDOG_SKIP_DIRS = new Set([
  '.git', 'node_modules', '.dsh', '.claude', 'dist', 'build', 'out', 'target',
  'coverage', 'venv', '.venv', '__pycache__', '.next', '.cache', '.idea',
])

function positiveNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function watchdogThresholds(config = {}) {
  return {
    enabled: config.watchdog !== false,
    idleMin: positiveNumber(config.watchdogIdleMin, 30),
    spinMin: positiveNumber(config.watchdogSpinMin, 60),
  }
}

async function mtimeOf(path) {
  try { return (await stat(path)).mtimeMs } catch { return 0 }
}

async function scanNewestMtime(root, store, limit = WATCHDOG_SCAN_LIMIT) {
  const stateRel = store.rel(store.dir)
  let best = 0
  let seen = 0
  const walk = async (dir, depth) => {
    if (depth > 8 || seen >= limit) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (seen >= limit) return
      if (WATCHDOG_SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      const rel = store.rel(full)
      if (rel === stateRel || rel.startsWith(`${stateRel}/`)) continue
      if (entry.isDirectory()) { await walk(full, depth + 1); continue }
      if (!entry.isFile()) continue
      seen++
      const t = await mtimeOf(full)
      if (t > best) best = t
    }
  }
  await walk(root, 0)
  return best
}

async function newestTreeMtime({ store, current, startedMs }) {
  const stateRel = `${store.rel(store.dir)}/`
  const baseline = new Set((current.dirty || []).map(p => String(p).replace(/^\.\//, '')))
  let newest = startedMs
  const startSha = String(current.start_sha || '')
  const repo = await git(store.root, ['rev-parse', '--is-inside-work-tree'])
  const gitMode = repo.ok && startSha && !startSha.startsWith('file:')
  if (!gitMode) return Math.max(newest, await scanNewestMtime(store.root, store))

  const head = await gitText(store.root, ['rev-parse', 'HEAD'])
  if (head && head !== startSha) {
    const committed = Number(await gitText(store.root, ['log', '-1', '--format=%ct', 'HEAD']))
    if (Number.isFinite(committed) && committed * 1000 > newest) newest = committed * 1000
  }
  const status = await git(store.root, ['--no-optional-locks', 'status', '--porcelain', '-z', '-uall'])
  let skipNext = false
  for (const entry of String(status.stdout || '').split('\0')) {
    if (!entry) { skipNext = false; continue }
    if (skipNext) { skipNext = false; continue }
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (/[RC]/.test(code)) skipNext = true
    if (!path || path.startsWith(stateRel) || path === stateRel.slice(0, -1)) continue
    if (baseline.has(path)) continue
    const t = await mtimeOf(join(store.root, path))
    if (t > newest) newest = t
  }
  return newest
}

const DISPATCHER_ONLY_LINE_RE = /\| (WATCHDOG|NOTIFY) \|/

/**
 * 「worker 输出」最后活跃时间：current.output（若配置）> run.log 里最后一条非看门狗/非通知的
 * 事件时间。看门狗自己写 run.log 不算输出增长，否则 IDLE 会被自己的日志刷成 SPIN。
 * 旧格式日志（无 ISO 前缀）只能退回文件 mtime。
 */
async function outputLastActivity(store, current, startedMs) {
  let outAt = startedMs
  if (current.output && typeof current.output === 'string') {
    const t = await mtimeOf(current.output)
    if (t > outAt) outAt = t
  }
  let parsed = 0
  let hasLines = false
  try {
    const lines = (await readText(store.runLogPath)).split(/\r?\n/).filter(Boolean)
    hasLines = lines.length > 0
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \| (.*)$/.exec(lines[i])
      if (!m) continue
      if (DISPATCHER_ONLY_LINE_RE.test(m[2])) continue
      parsed = Date.parse(m[1])
      if (!Number.isFinite(parsed)) parsed = 0
      break
    }
  } catch {}
  if (parsed > outAt) return parsed
  if (!parsed && hasLines) {
    const t = await mtimeOf(store.runLogPath)
    if (t > outAt) outAt = t
  }
  return outAt
}

/** 只读采集信号：不写文件、不改 current。current 不存在时返回 null。 */
export async function workerSignals({ store, current, nowMs = epoch() } = {}) {
  const cur = current || (await store.readCurrent())
  if (!cur) return null
  const startedMs = Number(cur.started) || nowMs
  const outAt = await outputLastActivity(store, cur, startedMs)
  const treeAt = await newestTreeMtime({ store, current: cur, startedMs })
  return {
    task: cur.task,
    title: cur.title,
    phase: cur.phase,
    nonce: cur.nonce,
    worker: cur.worker,
    startedMs,
    outAt,
    treeAt,
    outMin: Math.max(0, Math.floor((nowMs - outAt) / 60000)),
    treeMin: Math.max(0, Math.floor((nowMs - treeAt) / 60000)),
    recent: await store.logTail(3),
  }
}

export function judgeWatchdog(signals, thresholds = watchdogThresholds()) {
  if (!signals) return 'OK'
  if (signals.outMin >= thresholds.idleMin) return 'IDLE'
  if (signals.treeMin >= thresholds.spinMin) return 'SPIN'
  return 'OK'
}

/** 给调度员的建议（不直接操作 worker：DSH 侧只给建议）。 */
export function watchdogAdvisory(signals, thresholds = watchdogThresholds()) {
  if (!signals || signals.verdict === 'OK') return { verdict: 'OK', suggestion: '', nudge: false, text: '' }
  const tail = signals.nonce ? `（报告口令 ${signals.nonce}）` : ''
  if (signals.verdict === 'IDLE') {
    const over = signals.outMin >= thresholds.idleMin + 40
    const stopHint = over
      ? `已超出阈值 40 分钟，建议停止：用 \`interrupt_agent\` 停掉 ${signals.worker || 'worker'}，按 FAILED（停滞）处理${tail}，再 tick。`
      : `若 nudge 后仍无输出，下一轮给「建议停止」。`
    return {
      verdict: 'IDLE',
      nudge: true,
      suggestion: over ? '建议 nudge，仍无输出则建议停止' : '建议 nudge',
      text: `⏱ worker ${signals.task} 疑似卡住：输出 ${signals.outMin} 分钟无增长（仓库 ${signals.treeMin} 分钟无变化，阈值 ${thresholds.idleMin} 分钟）。建议 nudge：本插件不能直接给 subagent 发消息，先确认它是否在跑长命令，必要时用平台工具催一次。${stopHint}`,
    }
  }
  return {
    verdict: 'SPIN',
    nudge: false,
    suggestion: '建议停止',
    text: `⏱ worker ${signals.task} 疑似原地打转：输出仍在增长，但 ${signals.treeMin} 分钟没有新提交/文件变化（阈值 ${thresholds.spinMin} 分钟）。建议停止：用 \`interrupt_agent\` 停掉 ${signals.worker || 'worker'}，按失败路径处理（保留提交${tail}），再 tick。`,
  }
}

/**
 * 心跳用：采集 → 判定 → 命中时写 WATCHDOG 行（同判定 10 分钟内不重复写）。
 * phase 不是 running（如 review_pending 特意在等）时不检测。
 */
export async function checkWatchdog({ store, config = {}, nowMs = epoch() } = {}) {
  const thresholds = watchdogThresholds(config)
  if (!thresholds.enabled) return null
  const current = await store.readCurrent()
  if (!current || current.phase !== 'running') return null
  const signals = await workerSignals({ store, current, nowMs })
  signals.verdict = judgeWatchdog(signals, thresholds)
  signals.advisory = watchdogAdvisory(signals, thresholds)
  if (signals.verdict === 'OK') {
    if (current.watchdog) {
      const next = { ...current }
      delete next.watchdog
      await store.writeCurrent(next)
    }
    return signals
  }
  const last = current.watchdog
  const shouldLog = !last || last.verdict !== signals.verdict || nowMs - Number(last.at || 0) >= WATCHDOG_LOG_GAP_MS
  if (shouldLog) {
    const recent = signals.recent
      .map(line => String(line).replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \| /, ''))
      .join(' / ')
    await store.log(`${signals.task} | WATCHDOG | ${signals.verdict} | out=${signals.outMin}m tree=${signals.treeMin}m | ${signals.advisory.suggestion} | 最近活动：${truncate(recent || '（无）', 200)}`)
    await store.writeCurrent({ ...current, watchdog: { verdict: signals.verdict, at: nowMs } })
  }
  return signals
}

/** 只读版本（task_status 用）：不写日志、不改 current。 */
export async function inspectWatchdog({ store, config = {}, nowMs = epoch() } = {}) {
  const thresholds = watchdogThresholds(config)
  if (!thresholds.enabled) return null
  const current = await store.readCurrent()
  if (!current || current.phase !== 'running') return null
  const signals = await workerSignals({ store, current, nowMs })
  signals.verdict = judgeWatchdog(signals, thresholds)
  signals.advisory = watchdogAdvisory(signals, thresholds)
  signals.idleMin = thresholds.idleMin
  signals.spinMin = thresholds.spinMin
  return signals
}

export function watchdogSummary(signals) {
  if (!signals || signals.verdict === 'OK') return ''
  return `\n\n**⚠ worker 停滞看门狗**\n${signals.advisory.text}`
}

function inboxItems(entry) {
  const body = String(entry.body ?? '').trim()
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const bullet = lines.filter(l => /^[-*]\s+/.test(l))
  if (bullet.length > 1) {
    return bullet.map(line => {
      const text = line.replace(/^[-*]\s+/, '')
      const acc = /验收：(.+)$/.exec(text)
      const clean = text.replace(/[；;]\s*验收：.+$/, '')
      return { title: clean, acceptance: acc ? acc[1].trim() : entry.acceptance, module: entry.module, priority: entry.priority, note: text }
    })
  }
  const first = lines[0] || entry.title || '（空投递）'
  return [{ title: entry.title || first, acceptance: entry.acceptance, module: entry.module, priority: entry.priority, note: body }]
}

const DECISION_EVENT = {
  confirm: 'DECIDED', hold: 'DECIDED', answer: 'DECIDED', reject: 'REJECTED', reopen: 'REJECTED',
}

async function logDecisionEvent(store, ref, action, answer) {
  const event = DECISION_EVENT[action] || 'DECIDED'
  await store.log(`${ref} | ${event} | inbox/${action} | ${truncate(String(answer ?? ''), 120)}`)
}

export async function mergeInbox({ store, config }) {
  const entries = await store.readInbox()
  const result = { tasks: [], decisions: [], merged: [], errors: [] }
  for (const entry of entries) {
    try {
      if (entry.type === 'decision') {
        const ref = entry.ref
        if (!ref) { result.errors.push(`${entry.file}: 缺少 ref，无法处理决策`); continue }
        const data = await store.load()
        const backlog = data.backlog
        const task = taskById(backlog, ref)
        const answer = entry.body.trim()
        if (!task) {
          // 已归档任务的打回 = 重开（按 dev-progress 记录重建行）。
          if (!(await store.archivedIds()).has(ref)) {
            result.errors.push(`${entry.file}: 找不到任务 ${ref}`)
            continue
          }
          if (!/打回|不对|不行|fail|重开/i.test(answer)) {
            result.errors.push(`${entry.file}: ${ref} 已归档，答复不是打回类，已跳过`)
            continue
          }
          const reopened = await reopenArchivedTask(store, backlog, ref, answer)
          if (!reopened) { result.errors.push(`${entry.file}: ${ref} 已归档但 dev-progress.md 里没有记录`); continue }
          result.decisions.push({ task: ref, action: 'reopen', answer })
        } else if (task.status === STATUS.VERIFY) {
          if (DECISION_RE.test(answer)) {
            await confirmTask(store, backlog, task, { conclusion: `需求方确认（${day()}）：${answer}` })
            result.decisions.push({ task: ref, action: 'confirm', answer })
          } else if (MANUAL_VERIFY_RE.test(answer)) {
            // 「别默认通过 / 我要亲自看」：保留待验证，只加标记并撤销预告。
            task.note = setDefaultPassOff(task.note)
            await store.saveBacklog(backlog)
            await store.log(`${ref} | DEFAULT_PASS_OFF | 需求方要求亲自验证`)
            result.decisions.push({ task: ref, action: 'hold', answer })
          } else {
            await rejectTask(store, backlog, task, answer)
            result.decisions.push({ task: ref, action: 'reject', answer })
          }
        } else if (/打回|不对|不行|fail/i.test(answer) && task.status !== STATUS.TODO) {
          await rejectTask(store, backlog, task, answer)
          result.decisions.push({ task: ref, action: 'reject', answer })
        } else {
          await answerTask(store, backlog, ref, answer)
          result.decisions.push({ task: ref, action: 'answer', answer, previous: task.status })
        }
      } else {
        const items = inboxItems(entry)
        const data = await store.load()
        const backlog = data.backlog
        const added = addTasks(backlog, items, {})
        await store.saveBacklog(backlog)
        result.tasks.push(...added.added)
        if (added.duplicates.length) result.decisions.push(...added.duplicates.map(d => ({ task: d.id, action: 'duplicate', answer: entry.body })))
      }
      const last = result.decisions.at(-1)
      if (entry.type === 'decision' && last && DECISION_EVENT[last.action]) {
        await logDecisionEvent(store, last.task, last.action, last.answer)
      }
      await store.archiveInbox(entry)
      result.merged.push(entry.file)
    } catch (error) {
      result.errors.push(`${entry.file}: ${error?.message ?? error}`)
    }
  }
  if (result.merged.length) {
    await store.log(`INBOX | merged ${result.merged.length} | tasks ${result.tasks.length} | decisions ${result.decisions.length}`)
  }
  return result
}

export async function startLoop({ store, config, max, hours }) {
  if (!(await store.initialized())) throw new Error('任务池未初始化，请先调用 task_init。')
  const previous = (await store.readSession()) || {}
  const session = {
    run_started: epoch(),
    max: Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : (previous.max ?? config.defaultMaxTasks),
    hours: Number.isFinite(Number(hours)) && Number(hours) > 0 ? Number(hours) : (previous.hours ?? config.defaultMaxHours),
    done: 0,
    noprog: 0,
    active: true,
    started_at: day(),
  }
  await store.writeSession(session)
  await store.clearStop()
  const current = await store.readCurrent()
  await store.log(`START | max=${session.max} hours=${session.hours}`)
  const branch = await gitText(store.root, ['branch', '--show-current'])
  return { session, current, branch, onMain: /^(master|main)$/.test(branch) }
}

export async function loopTick({ store, config }) {
  const session = await store.readSession()
  if (!session || session.active === false) {
    return { action: 'not_running', text: '自动循环未运行。用 `task_loop action=start` 启动，或用 `task_pick` 单步执行。' }
  }
  if (await store.stopRequested()) {
    return { action: 'stop', reason: 'STOP 文件存在', text: '已请求停机（STOP 存在）。不再派发；请调用 `task_loop action=stop` 做收尾总结。' }
  }
  const elapsedH = (epoch() - session.run_started) / 3600000
  if (session.done >= session.max) return stopReason('达到本次交付上限', session, config)
  if (elapsedH >= session.hours) return stopReason('达到本次最长时长', session, config)
  if (session.noprog >= config.maxNoprog) return stopReason(`连续 ${session.noprog} 次无进展`, session, config)

  const merge = await mergeInbox({ store, config })
  // 待验证到期检查：合并 inbox 之后、挑任务之前跑（心跳 idle 时也会跑到）。
  const timeout = await checkVerifyTimeout({ store })
  const due = timeoutSummary(timeout)

  const current = await store.readCurrent()
  if (current) {
    if (current.phase === 'accepted') {
      await store.clearCurrent()
    } else if (current.phase === 'halted') {
      return { action: 'halted', current, text: `任务 ${current.task} 被叫停，phase=halted。向需求方复述断点（${current.halt_note || '未记录'}），问是继续还是放回队列。不回滚。${due}`, merge, timeout }
    } else if (current.phase === 'running' || current.phase === 'review_pending' || current.phase === 'accepting') {
      const stale = epoch() - (current.started || epoch()) > 3 * 60 * 60 * 1000
      // review_pending 是 worker 特意在等调度员，不看看门狗。
      const watchdog = current.phase === 'running' ? await checkWatchdog({ store, config }) : null
      const watchdogText = watchdog && watchdog.verdict !== 'OK' ? `\n\n${watchdog.advisory.text}` : ''
      return {
        action: stale ? 'stale' : 'waiting',
        current,
        stale,
        watchdog,
        text: (stale
          ? `worker ${current.worker} 开工已超过 3 小时（${formatDuration(epoch() - current.started)}）。用 interrupt_agent 停掉它，然后按 task-worker 的失败路径提交/处理 FAILED（报告口令 ${current.nonce}）。${due}`
          : `任务 ${current.task} 正由 ${current.worker} 处理（phase=${current.phase}，已 ${formatDuration(epoch() - current.started)}）。等完成通知，不要并行开工。${due}`) + watchdogText,
        merge,
        timeout,
      }
    }
  }

  const data = await store.load()
  const backlog = data.backlog
  const pick = nextTask(backlog, data.archived)
  if (!pick.task) {
    return {
      action: 'idle',
      text: `没有可派发的任务。待决策 ${backlog.decisions.length} 条，阻塞 ${backlog.tasks.filter(t => t.status === STATUS.BLOCKED).length} 条，待验证 ${backlog.tasks.filter(t => t.status === STATUS.VERIFY).length} 条。${due}`,
      counts: countsOf(backlog).counts,
      decisions: backlog.decisions,
      blocked: pick.blocked.slice(0, 8).map(b => ({ task: b.task.id, reason: b.reason })),
      verifyRows: describeVerifyRows(backlog),
      merge,
      timeout,
    }
  }
  const task = pick.task
  let retryNote = ''
  const rework = /打回（[^）]*）：(.+)$/.exec(task.note || '')
  const fail = /自动失败×\d+：(.+)$/.exec(task.note || '')
  if (rework) retryNote = `上次被打回：${rework[1]}`
  else if (fail) retryNote = `上次自动失败：${fail[1]}`
  const dirty = await dirtyPaths(store.root)
  const claimed = await claimTask({ store, backlog, task, mode: 'auto', dirtyPaths: dirty, retryNote })
  await store.log(`${task.id} | DISPATCH | auto/${claimed.mode} | worker=${claimed.current.worker} | nonce=${claimed.nonce} | start=${String(claimed.startSha).slice(0, 14)}`)
  return {
    action: 'dispatch',
    task: { id: task.id, title: task.title, priority: task.priority, module: task.module, acceptance: /验收：([^；]+)/.exec(task.note || '')?.[1] || '' },
    worker_prompt: claimed.prompt,
    current: claimed.current,
    branch: await gitText(store.root, ['branch', '--show-current']),
    onMain: /^(master|main)$/.test(await gitText(store.root, ['branch', '--show-current'])),
    merge,
    timeout,
    text: `已认领 ${task.id}（${task.priority}·${task.module}）。调用 subagent 工具，把 worker_prompt 原样作为 prompt 派发（后台运行），然后结束本回合等通知。${due}`,
  }
}

function stopReason(reason, session, config) {
  return {
    action: 'stop',
    reason,
    session,
    text: `停机条件命中：${reason}。请调用 \`task_loop action=stop\`，然后给需求方总结（已交付、待决策、阻塞、待验证、失败留存）。`,
  }
}

export async function stopLoop({ store, reason = 'user' }) {
  await store.requestStop(reason)
  const session = await store.readSession()
  if (session) await store.writeSession({ ...session, active: false, stopped_at: epoch(), stop_reason: reason })
  await store.log(`STOP | ${reason}`)
  const notify = await notifyTask({
    store,
    config: store.config,
    event: 'stop',
    detail: `自动循环已停止（${reason}）`,
    key: `STOP:${session?.run_started ?? 'loop'}`,
  })
  return { session: await store.readSession(), logTail: await store.logTail(10), notify }
}

export async function haltLoop({ store }) {
  const current = await store.readCurrent()
  await store.requestStop('halt')
  if (current) {
    let haltNote
    if (current.mode === 'file' && current.snapshot) {
      const diff = await diffAgainstSnapshot({ root: store.root, snapshot: current.snapshot, stateRel: store.rel(store.dir), ignore: store.config.snapshotIgnore })
      haltNote = `文件快照:\n${current.snapshot}\n改动(${diff.count}): ${diff.changed.join(', ') || '无'}`
    } else {
      const commits = await gitText(store.root, ['log', '--format=%h %s', `${current.start_sha}..HEAD`])
      const dirty = await dirtyPaths(store.root)
      const newDirty = dirty.filter(p => !(current.dirty || []).includes(p))
      haltNote = `commits:\n${commits || '（无）'}\ndirty(新增): ${newDirty.join(', ') || '无'}`
    }
    await store.writeCurrent({ ...current, phase: 'halted', halt_note: haltNote })
    const session = await store.readSession()
    if (session) await store.writeSession({ ...session, active: false, stopped_at: epoch(), stop_reason: 'halt' })
    await store.log(`HALT | ${current.task}`)
    const notify = await notifyTask({
      store,
      config: store.config,
      event: 'stop',
      taskId: current.task,
      detail: `已叫停 ${current.task}（halt，未回滚）`,
      key: `STOP:halt:${current.nonce ?? current.task}`,
    })
    return { current: { ...current, phase: 'halted' }, haltNote, notify, text: `已叫停 ${current.task}。未回滚，改动保留。断点：\n${haltNote}` }
  }
  await store.log('HALT | 无进行中任务')
  const session = await store.readSession()
  const notify = await notifyTask({
    store, config: store.config, event: 'stop', detail: '已停机（没有进行中任务）', key: `STOP:halt:${session?.run_started ?? 'none'}`,
  })
  return { current: null, notify, text: '已停机（没有进行中任务）。' }
}

export function loopSummary({ store, data }) {
  const { backlog } = data
  const lines = []
  lines.push('## 自动循环收尾')
  lines.push('')
  lines.push(`待决策：${backlog.decisions.length} 条`)
  for (const d of backlog.decisions) lines.push(`- ${d.task}：${d.question}｜${d.options}`)
  lines.push(`阻塞：${backlog.tasks.filter(t => t.status === STATUS.BLOCKED).length} 条`)
  for (const t of backlog.tasks.filter(t => t.status === STATUS.BLOCKED)) lines.push(`- ${t.id}：${t.note}`)
  lines.push(`待验证：${backlog.tasks.filter(t => t.status === STATUS.VERIFY).length} 条`)
  for (const row of describeVerifyRows(backlog)) lines.push(`- ${row}`)
  return lines.join('\n')
}



export async function resumeHalted({ store, config }) {
  const current = await store.readCurrent()
  if (!current) throw new Error('没有可恢复的任务（current.json 不存在）。')
  if (current.phase !== 'halted') throw new Error(`当前任务 ${current.task} 的阶段是 ${current.phase}，不是 halted。`)
  const data = await store.load()
  const task = taskById(data.backlog, current.task)
  if (!task) { await store.clearCurrent(); throw new Error(`halted 任务 ${current.task} 已不在待办池，current 已清理。`) }
  const dirty = await dirtyPaths(store.root)
  const claimed = await claimTask({ store, backlog: data.backlog, task, mode: 'auto', dirtyPaths: dirty, retryNote: `上次被叫停的断点：\n${current.halt_note || '（未记录）'}` })
  const session = await store.readSession()
  if (session) await store.writeSession({ ...session, active: true })
  await store.log(`${task.id} | RESUME | start=${claimed.startSha.slice(0, 8)}`)
  await store.log(`${task.id} | DISPATCH | resume/${claimed.mode} | worker=${claimed.current.worker} | nonce=${claimed.nonce}`)
  return {
    action: 'dispatch',
    task: { id: task.id, title: task.title, priority: task.priority, module: task.module },
    worker_prompt: claimed.prompt,
    current: claimed.current,
    text: `已从断点重新派发 ${task.id}（新 START_SHA ${claimed.startSha.slice(0, 10)}，nonce ${claimed.nonce}）。断点记录已放进 worker prompt。`,
  }
}

export async function requeueHalted({ store }) {
  const current = await store.readCurrent()
  if (!current) throw new Error('没有可放回队列的任务（current.json 不存在）。')
  const data = await store.load()
  const task = taskById(data.backlog, current.task)
  if (task) {
    task.status = STATUS.TODO
    task.note = `${task.note && task.note !== '—' ? `${task.note}；` : ''}叫停断点（${day()}）：${truncate(current.halt_note || '被需求方放回队列', 200)}`
    await store.saveBacklog(data.backlog)
    await writePlan(store, data.backlog, await store.archivedIds(), null)
  }
  await store.clearCurrent()
  await store.log(`${current.task} | REQUEUE | 回待开始`)
  const session = await store.readSession()
  if (session) await store.writeSession({ ...session, active: false })
  return { action: 'requeued', task: current.task, text: `已把 ${current.task} 放回「待开始」，断点写入备注。` }
}
