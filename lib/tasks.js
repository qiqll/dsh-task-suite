import { STATUS, PRIORITIES, renderPlan, appendProgress } from './markdown.js'
import { normalizeTitle, cell, day, now, nonce as makeNonce, epoch, formatDuration, gitText } from './util.js'
import { progressEntry } from './store.js'
import { join } from 'node:path'
import { detectMode, snapshotProject, pruneSnapshots, removeSnapshot } from './filesnapshot.js'

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 }

export function taskById(backlog, id) {
  return backlog.tasks.find(t => t.id === id)
}

export function materialize(backlog) {
  return {
    doc: backlog.doc,
    tasks: [...backlog.tasks],
    decisions: [...backlog.decisions],
    blockers: [...backlog.blockers],
    nextTaskId: backlog.nextTaskId,
    nextBlockerId: backlog.nextBlockerId,
  }
}

export function bumpTaskId(backlog, used) {
  let n = Number(String(backlog.nextTaskId).slice(2)) || 1
  const ids = new Set(backlog.tasks.map(t => t.id).concat(used || []))
  while (ids.has(`T-${String(n).padStart(3, '0')}`)) n++
  backlog.nextTaskId = `T-${String(n + 1).padStart(3, '0')}`
  return `T-${String(n).padStart(3, '0')}`
}

export function bumpBlockerId(backlog) {
  const id = backlog.nextBlockerId
  const n = Number(String(id).slice(2)) || 1
  backlog.nextBlockerId = `H-${String(n + 1).padStart(3, '0')}`
  return id
}

export function parseDerivedLevel(note) {
  const m = /衍生层级：(\d+)/.exec(note || '')
  return m ? Number(m[1]) : 0
}

export function addTasks(backlog, items, opts = {}) {
  const added = []
  const duplicates = []
  const skipped = []
  const used = []
  for (const item of items) {
    const title = String(item?.title ?? '').trim()
    if (!title) { skipped.push({ title: '', reason: '缺少任务标题' }); continue }
    if (item.status && !Object.values(STATUS).includes(item.status)) {
      skipped.push({ title, reason: `非法状态 ${item.status}` })
      continue
    }
    const key = normalizeTitle(title)
    const existing = backlog.tasks.find(t => normalizeTitle(t.title) === key)
    if (existing) {
      const stamp = day()
      const extra = String(item.note ?? '').trim()
      existing.note = `${existing.note && existing.note !== '—' ? `${existing.note}；` : ''}重复录入（${stamp}）${extra ? `：${extra}` : ''}`
      duplicates.push({ id: existing.id, title })
      continue
    }
    let priority = String(item.priority ?? opts.defaultPriority ?? 'P2').toUpperCase()
    if (!PRIORITIES.includes(priority)) priority = 'P2'
    let parent = item.parent ? String(item.parent).trim().toUpperCase() : undefined
    let derivedLevel = Number.isFinite(Number(item.derivedLevel)) ? Number(item.derivedLevel) : (parent ? 0 : 0)
    if (parent) {
      const parentTask = taskById(backlog, parent)
      if (parentTask) {
        if (PRIORITY_RANK[priority] > PRIORITY_RANK[parentTask.priority]) priority = parentTask.priority
        derivedLevel = parseDerivedLevel(parentTask.note) + 1
      }
    }
    const id = bumpTaskId(backlog, used)
    used.push(id)
    const acceptance = String(item.acceptance ?? '').trim()
    const noteParts = []
    if (acceptance) noteParts.push(`验收：${acceptance}${item.acceptanceAi ? '（AI 拟，可改）' : ''}`)
    else noteParts.push('验收：（未提供，AI 拟，可改）')
    if (parent) noteParts.push(`来源：衍生自 ${parent}${derivedLevel ? `（第 ${derivedLevel} 层）` : ''}`)
    if (derivedLevel) noteParts.push(`衍生层级：${derivedLevel}`)
    if (item.source) noteParts.push(`来源说明：${item.source}`)
    const extra = String(item.note ?? '').trim()
    if (extra) noteParts.push(extra)
    const task = {
      id,
      title,
      module: String(item.module ?? '').trim() || (opts.defaultModule ?? '—'),
      status: item.status || STATUS.TODO,
      deps: String(item.deps ?? '').trim() || '—',
      note: noteParts.join('；'),
      priority,
    }
    backlog.tasks.push(task)
    added.push(task)
  }
  return { added, duplicates, skipped }
}

export function dependencyState(task, backlog, archived) {
  const deps = String(task.deps ?? '').split(/[，,、;\s]+/).filter(Boolean)
  const reasons = []
  let ready = true
  for (const dep of deps) {
    if (dep === '—' || dep === '-') continue
    if (/^T-\d{3}$/.test(dep)) {
      const target = taskById(backlog, dep)
      if (target && target.status === STATUS.DONE) continue
      if (archived?.has(dep)) { reasons.push(`${dep} 已完成（已归档）`); continue }
      if (!target) { ready = false; reasons.push(`${dep} 不在待办池且未归档（依赖未知）`); continue }
      ready = false
      reasons.push(`${dep} 状态 ${target.status}`)
    } else if (/^H-\d{3}$/.test(dep)) {
      const blocker = backlog.blockers.find(b => b.id === dep)
      if (blocker && /已解除|已完成|已解决/.test(blocker.status)) continue
      ready = false
      reasons.push(`${dep} 人工阻塞${blocker ? `（${blocker.status}）` : '（条目缺失）'}`)
    }
  }
  return { ready, reasons }
}

export function skipReason(task, backlog, archived) {
  if (task.status === STATUS.DECISION) return '待决策'
  if (task.status === STATUS.BLOCKED) return '阻塞'
  if (task.status === STATUS.VERIFY) return '待验证'
  if (task.status === STATUS.DONE || task.status === STATUS.CANCELLED) return `状态 ${task.status}`
  if (Task_isRetryCandidate(task)) { /* allowed */ } else if (task.status !== STATUS.TODO) return `状态 ${task.status}`
  if (/只录不做|自动失败×2|需需求方定|先不排/.test(task.note || '')) return '备注标记暂不做'
  if (backlog.decisions.some(d => d.task === task.id)) return '待决策表中有未答复问题'
  return undefined
}

function Task_isRetryCandidate(task) {
  return task.status === STATUS.REWORK
}

export function readyTasks(backlog, archived) {
  const ready = []
  const blocked = []
  for (const p of PRIORITIES) {
    for (const task of backlog.tasks.filter(t => t.priority === p)) {
      const skip = skipReason(task, backlog, archived)
      if (skip) { blocked.push({ task, reason: skip }); continue }
      const dep = dependencyState(task, backlog, archived)
      if (!dep.ready) { blocked.push({ task, reason: dep.reasons.join('；') }); continue }
      ready.push(task)
    }
  }
  return { ready, blocked }
}

export function nextTask(backlog, archived) {
  const { ready, blocked } = readyTasks(backlog, archived)
  return { task: ready[0], blocked, ready }
}

export function planBatches(backlog, archived) {
  const { ready } = readyTasks(backlog, archived)
  return ready.slice(0, 10).map(t => ({ ...t, reason: `${t.priority} · ${t.module}` }))
}

export async function writePlan(store, backlog, archived, current) {
  const { counts } = countsOf(backlog)
  const text = renderPlan({
    batches: planBatches(backlog, archived),
    current,
    todoCounts: counts,
    date: day(),
  })
  await store.writePlan(text)
  return text
}

export function countsOf(backlog) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, verify: 0, blocked: 0, decision: 0, doing: 0, rework: 0 }
  for (const t of backlog.tasks) {
    counts[t.priority] = (counts[t.priority] || 0) + 1
    if (t.status === STATUS.VERIFY) counts.verify++
    else if (t.status === STATUS.BLOCKED) counts.blocked++
    else if (t.status === STATUS.DECISION) counts.decision++
    else if (t.status === STATUS.DOING) counts.doing++
    else if (t.status === STATUS.REWORK) counts.rework++
  }
  return { counts }
}

export async function currentWork(store) {
  const current = await store.readCurrent()
  if (!current) return null
  return {
    ...current,
    elapsedMs: epoch() - (current.started || epoch()),
    elapsed: formatDuration(epoch() - (current.started || epoch())),
    isStale: current.phase === 'running' && epoch() - (current.started || epoch()) > 3 * 60 * 60 * 1000,
  }
}

export function buildStatusReport(data, extra = {}) {
  const { backlog, session, current, archived, plan } = data
  const { counts } = countsOf(backlog)
  const lines = []
  lines.push(`## 任务池 · ${day()}`)
  lines.push('')
  if (current) {
    const elapsed = formatDuration(epoch() - (current.started || epoch()))
    lines.push(`**进行中**：${current.task}（${current.phase}，已 ${elapsed}${current.mode === 'file' ? '，文件快照模式' : ''}${current.worker ? `，worker ${current.worker}` : ''}）`)
  } else lines.push('**进行中**：无')
  lines.push(`**待验证**：${counts.verify} 条${counts.verify ? ' —— 等需求方确认' : ''}`)
  lines.push(`**待决策**：${backlog.decisions.length} 条${backlog.decisions.length ? ' —— 需要你拍板' : ''}`)
  if (session && session.active !== false) {
    lines.push(`**自动循环**：运行中（已交付 ${session.done ?? 0} / max ${session.max ?? '—'}，无进展 ${session.noprog ?? 0}）`)
  } else lines.push('**自动循环**：未运行')
  lines.push('')
  lines.push('| 优先级 | 待开始 | 阻塞 | 合计 |')
  lines.push('|--------|-------|------|------|')
  for (const p of PRIORITIES) {
    const total = counts[p] || 0
    const blocked = backlog.tasks.filter(t => t.priority === p && t.status === STATUS.BLOCKED).length
    lines.push(`| ${p} | ${Math.max(0, total - blocked)} | ${blocked} | ${total} |`)
  }
  if (backlog.decisions.length) {
    lines.push('', '**待决策清单**（最优先处理）')
    for (const d of backlog.decisions) lines.push(`- ${d.task}：${d.question}｜选项：${d.options}｜挂起 ${d.since}`)
  }
  const blockedRows = backlog.tasks.filter(t => t.status === STATUS.BLOCKED)
  if (blockedRows.length) {
    lines.push('', '**阻塞明细**')
    for (const t of blockedRows) lines.push(`- ${t.id}（${t.priority}）：${t.note}`)
  }
  const stale = staleDependencies(backlog, archived)
  if (stale.length) {
    lines.push('', '**⚠ 阻塞可解除**')
    for (const s of stale) lines.push(`- ${s.task} 依赖的 ${s.dep} 已完成，可改回「待开始」`)
  }
  const rework = backlog.tasks.filter(t => t.status === STATUS.REWORK)
  if (rework.length) {
    lines.push('', '**打回待重做**')
    for (const t of rework) lines.push(`- ${t.id}：${t.note}`)
  }
  if (extra.inboxCount) lines.push('', `**待合并投递**：${extra.inboxCount} 个 inbox 文件`)
  if (extra.logTail?.length) {
    lines.push('', '**最近运行流水**')
    for (const line of extra.logTail) lines.push(`- ${line}`)
  }
  const next = nextTask(backlog, archived)
  if (next.task) {
    lines.push('', `**建议下一步**：${next.task.id}（${next.task.priority}·${next.task.module}）${next.task.title}`)
  } else if (!backlog.tasks.length) {
    lines.push('', '待办池为空。用 `task_add` 录入需求；不要自己发明任务。')
  } else {
    lines.push('', '没有可派发的任务（全部待决策 / 阻塞 / 待验证）。处理上面的队列，或录入新需求。')
  }
  if (extra.plan) lines.push('', `计划视图：\`${extra.plan}\``)
  return lines.join('\n')
}

export function staleDependencies(backlog, archived) {
  const out = []
  for (const t of backlog.tasks) {
    if (t.status !== STATUS.BLOCKED) continue
    for (const dep of String(t.deps || '').match(/T-\d{3}/g) || []) {
      if (archived?.has(dep)) out.push({ task: t.id, dep })
    }
  }
  return out
}

export function buildTaskBrief(task, backlog, opts = {}) {
  const lines = []
  lines.push(`## ${task.id} ${task.title}`)
  lines.push('')
  lines.push(`- 优先级：${task.priority}`)
  lines.push(`- 模块：${task.module}`)
  lines.push(`- 状态：${task.status}`)
  lines.push(`- 依赖：${task.deps}`)
  const acceptance = /验收：([^；]+)/.exec(task.note || '')
  lines.push(`- 验收标准：${acceptance ? acceptance[1] : '（未给出，AI 拟定并在报告中标注）'}`)
  lines.push(`- 备注：${task.note}`)
  const decisions = backlog.decisions.filter(d => d.task === task.id)
  if (decisions.length) {
    lines.push('', '**待决策（先处理）**')
    for (const d of decisions) lines.push(`- ${d.question}｜选项：${d.options}`)
  }
  lines.push('', `下一步：${opts.next || '按 skill `task-worker` 实施并交付'}`)
  return lines.join('\n')
}

export function buildWorkerPrompt({ task, cwd, startSha, dirty, nonce, retryNote, mode = 'git', snapshot, snapshotCount, snapshotBytes }) {
  const reportHint = '最后一条消息只输出 `=== TASK-AUTO REPORT ===` 到 `=== END REPORT ===` 的报告块，字段见 skill `task-worker`。'
  const fileMode = mode === 'file'
  const baseline = fileMode
    ? `基线模式：文件快照（非 git 目录）
基线快照：${snapshot}（${snapshotCount ?? '?'} 个文件，${snapshotBytes >= 1024 * 1024 ? `${(snapshotBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round((snapshotBytes || 0) / 1024))} KB`}）
注意：本目录不是 git 仓库。**不要执行 git init / git add / git commit**；改动直接留在工作区，验收系统会按快照比对 changed files。报告里 COMMITS 填 —，CHANGES 列出改动文件（可留 —，系统会自己算）。`
    : `START_SHA：${startSha || '—'}`
  const dirtyHint = fileMode
    ? '开工时的脏文件：无（文件模式以快照为准，不区分 git 脏文件）'
    : `开工时的脏文件（不许碰、不许 add、不许 commit）：\n${dirty && dirty.length ? dirty.map(f => `- ${f}`).join('\n') : '无'}`
  return `读取并严格遵循 skill \`task-worker\`（先调用 skill 工具加载它），交付任务 ${task.id}。

项目根：${cwd}
任务 ID：${task.id}
任务标题：${task.title}
优先级：${task.priority}
模块：${task.module}
验收标准：${(() => { const m = /验收：([^；]+)/.exec(task.note || ''); return m ? m[1] : '（未提供，自行拟一条可用命令判定的标准并在报告标注 AI 拟定）' })()}
任务备注：${task.note}
${baseline}
报告口令（NONCE）：${nonce}
${dirtyHint}
${retryNote ? `上次失败/打回原因与需求方意见：\n${retryNote}\n` : ''}
${reportHint}
你是后台 worker，没有人回答你的问题：需要决策时返回 NEEDS_DECISION，缺前置条件时返回 BLOCKED，全部完成后返回 DONE。`
}

export function workerReportTemplate(task, startSha, nonce, mode = 'git') {
  return `=== TASK-AUTO REPORT ===
NONCE: ${nonce}
RESULT: DONE
TASK: ${task.id}
START_SHA: ${startSha || '—'}
COMMITS: ${mode === 'file' ? '—' : '<sha1> <sha2> ...'}
CHANGES: ${mode === 'file' ? '<相对路径列表；留 — 由系统按快照计算>' : '<可选：改动文件列表>'}
TEST_CMD: <可在项目根直接运行的完整命令>
TEST_RESULT: 基线 <x passed, y failed> → 交付后 <x passed, y failed>；既有失败：<用例名或 —>
TEST_CHANGES: <对既有测试的每一处修改及理由；只新增用例填「仅新增 N 个用例」>
GATE: code-reviewer <发现概要>；已修 <…>；跳过 <… + 理由>
ACCEPTANCE: <验收标准>（来源：backlog | AI 拟定）
ASSUMPTIONS: <自行做的选择；无填 —>
DECISION: —
BLOCKER: —
DERIVED: —
BRIEF:
<5–10 行简报>
=== END REPORT ===`
}

export async function claimTask({ store, backlog, task, mode, run, dirtyPaths, retryNote }) {
  const cwd = store.root
  const nc = makeNonce()
  const fileMode = await detectMode(cwd, store.config.mode) === 'file'
  let startSha = ''
  let snapshot = ''
  let snapshotCount = 0
  let snapshotBytes = 0
  let dirty = []
  if (fileMode) {
    const dir = join(store.snapshotsDir, `${task.id}-${nc}`)
    const info = await snapshotProject({
      root: cwd,
      dest: dir,
      stateRel: store.rel(store.dir),
      ignore: store.config.snapshotIgnore,
      maxBytes: store.config.snapshotMaxBytes,
      maxFiles: store.config.snapshotMaxFiles,
    })
    snapshot = info.dir
    snapshotCount = info.manifest.count
    snapshotBytes = info.manifest.bytes
    startSha = `file:${nc}`
    await pruneSnapshots({ snapshotsDir: store.snapshotsDir, keep: Math.max(1, store.config.snapshotKeep) })
  } else {
    startSha = (await gitText(cwd, ['rev-parse', 'HEAD'])) || ''
    if (!startSha) throw new Error('当前目录不是 git 仓库或没有提交，无法记录 START_SHA')
    dirty = (dirtyPaths ?? []).filter(Boolean)
  }
  const session = (await store.readSession()) || {}
  task.status = STATUS.DOING
  await store.saveBacklog(backlog)
  const current = {
    task: task.id,
    title: task.title,
    nonce: nc,
    phase: 'running',
    start_sha: startSha,
    dirty,
    started: epoch(),
    worker: `worker-${task.id}`,
    output: '',
    run_started: session.run_started || epoch(),
    max: session.max ?? store.config.defaultMaxTasks,
    hours: session.hours ?? store.config.defaultMaxHours,
    done: session.done ?? 0,
    noprog: session.noprog ?? 0,
    mode: fileMode ? 'file' : 'git',
    snapshot,
    snapshot_count: snapshotCount,
    snapshot_bytes: snapshotBytes,
  }
  await store.writeCurrent(current)
  await writePlan(store, backlog, await store.archivedIds(), current)
  await store.log(`${task.id} | CLAIM | ${mode}/${current.mode} | start=${startSha.slice(0, 14)} | ${fileMode ? `snapshot=${snapshotCount} files` : `dirty=${dirty.length}`}`)
  const prompt = buildWorkerPrompt({ task, cwd, startSha, dirty, nonce: nc, retryNote, mode: current.mode, snapshot, snapshotCount, snapshotBytes })
  return { current, prompt, brief: buildTaskBrief(task, backlog), startSha, nonce: nc, dirty, mode: current.mode }
}

export function parseWorkerReport(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('=== TASK-AUTO REPORT ===')
  const end = raw.indexOf('=== END REPORT ===')
  if (start < 0 || end < start) return null
  const block = raw.slice(start, end + '=== END REPORT ==='.length)
  const body = raw.slice(start + '=== TASK-AUTO REPORT ==='.length, end)
  const fields = {}
  let currentKey = null
  const derived = []
  for (const line of body.split(/\r?\n/)) {
    const m = /^([A-Z_]+):\s*(.*)$/.exec(line)
    if (m) {
      currentKey = m[1]
      if (currentKey === 'DERIVED') {
        const val = m[2].trim()
        if (val && val !== '—') derived.push(val)
        continue
      }
      fields[currentKey] = m[2].trim()
      continue
    }
    if (currentKey === 'DERIVED' && line.trim().startsWith('-')) derived.push(line.trim().slice(1).trim())
    else if (currentKey === 'BRIEF' && line.trim()) fields.BRIEF = `${fields.BRIEF || ''}${fields.BRIEF ? '\n' : ''}${line.trim()}`
  }
  const commits = (fields.COMMITS || '').split(/[\s,]+/).filter(s => /^[0-9a-f]{7,40}$/i.test(s))
  return {
    block,
    raw,
    nonce: fields.NONCE || '',
    result: (fields.RESULT || 'FAILED').trim().toUpperCase(),
    task: fields.TASK || '',
    start_sha: fields.START_SHA || '',
    commits,
    test_cmd: fields.TEST_CMD || '',
    test_result: fields.TEST_RESULT || '',
    test_changes: fields.TEST_CHANGES || '',
    gate: fields.GATE || '',
    acceptance: fields.ACCEPTANCE || '',
    assumptions: fields.ASSUMPTIONS || '',
    decision: fields.DECISION === '—' ? '' : (fields.DECISION || ''),
    blocker: fields.BLOCKER === '—' ? '' : (fields.BLOCKER || ''),
    derived,
    brief: fields.BRIEF || '',
    fields,
  }
}

export function addDerivedTasks(backlog, parent, derived, config) {
  const added = []
  const skipped = []
  if (!derived?.length) return { added, skipped }
  const parentLevel = parseDerivedLevel(parent.note)
  const level = parentLevel + 1
  if (level > config.maxDerivedDepth) return { added, skipped: [{ reason: `衍生层级 ${level} 超过上限 ${config.maxDerivedDepth}` }] }
  const existingCount = backlog.tasks.filter(t => (t.note || '').includes(`来源：衍生自 ${parent.id}`)).length
  let capacity = Math.max(0, config.maxDerivedPerParent - existingCount)
  for (const line of derived.slice(0, 8)) {
    if (capacity <= 0) { skipped.push({ line, reason: '父任务衍生数量已满' }); continue }
    const m = /^\s*(?:\[(P[0-3])\]\s*)?(.+?)(?:\s*\|\s*涉及文件\s*(.*?))?(?:\s*\|\s*来源\s*(.*))?$/.exec(String(line).replace(/^[-*]\s*/, ''))
    if (!m) { skipped.push({ line, reason: '无法解析' }); continue }
    const priority = m[1] || parent.priority
    const title = (m[2] || '').trim().replace(/[。；]$/, '')
    const files = (m[3] || '').trim()
    const source = (m[4] || '').trim()
    if (!title) { skipped.push({ line, reason: '缺少标题' }); continue }
    const dup = backlog.tasks.find(t => normalizeTitle(t.title) === normalizeTitle(title) && (!files || (t.note || '').includes(files.split(/[，,]/)[0].trim())))
    if (dup) {
      dup.note = `${dup.note}；重复来源：衍生自 ${parent.id}（${day()}）${source ? `，${source}` : ''}`
      skipped.push({ line, reason: `与 ${dup.id} 重复，已并入备注` })
      continue
    }
    const rank = Math.max(PRIORITY_RANK[parent.priority] ?? 2, PRIORITY_RANK[priority] ?? 2)
    const p = PRIORITIES[rank]
    const id = bumpTaskId(backlog)
    const task = {
      id,
      title,
      module: parent.module,
      status: STATUS.TODO,
      deps: '—',
      note: `验收：（AI 拟，可改）；来源：衍生自 ${parent.id}（第 ${level} 层）；衍生层级：${level}${files ? `；涉及文件：${files}` : ''}${source ? `；来源：${source}` : ''}${p === 'P3' ? '；AI 衍生 P3，只录不做' : ''}`,
      priority: p,
    }
    backlog.tasks.push(task)
    added.push(task)
    capacity--
  }
  return { added, skipped }
}

export function removeDecision(backlog, taskId) {
  const before = backlog.decisions.length
  backlog.decisions = backlog.decisions.filter(d => d.task !== taskId)
  return before !== backlog.decisions.length
}

export function addDecision(backlog, { task, question, options, since }) {
  if (backlog.decisions.some(d => d.task === task && d.question === question)) return
  backlog.decisions.push({ task, question: question || '（未给出）', options: options || '—', since: since || day() })
}

export function addBlocker(backlog, { desc, task }) {
  const existing = backlog.blockers.find(b => b.task === task && b.desc === desc)
  if (existing) return existing.id
  const id = bumpBlockerId(backlog)
  backlog.blockers.push({ id, desc: desc || '（未描述）', task: task || '—', status: '待处理' })
  return id
}

export async function confirmTask(store, backlog, task, opts = {}) {
  const idx = backlog.tasks.findIndex(t => t.id === task.id)
  if (idx < 0) throw new Error(`找不到任务 ${task.id}`)
  backlog.tasks.splice(idx, 1)
  removeDecision(backlog, task.id)
  await store.saveBacklog(backlog)
  const progress = await store.readProgress()
  let commits = '`—`'
  const commitInfo = opts.commits?.length ? opts.commits.map(c => `\`${c.slice(0, 7)}\``).join(' · ') : ''
  if (commitInfo) commits = commitInfo
  else {
    const m = /commits ([0-9a-f]{7,40}(?: [0-9a-f]{7,40})*)/.exec(task.note || '')
    if (m) commits = m[1].split(' ').map(c => `\`${c.slice(0, 7)}\``).join(' · ')
  }
  const entry = progressEntry({
    task: task.id,
    date: day(),
    priority: task.priority,
    module: task.module,
    conclusion: { title: task.title, text: opts.conclusion || task.title },
    commits,
    gate: opts.gate || '未记录',
    leftover: opts.leftover,
    derived: opts.derived,
  })
  await store.writeProgress(appendProgress(progress, entry))
  const current = await store.readCurrent()
  const snap = current?.task === task.id ? current.snapshot : (/文件快照：([^；\n]+)/.exec(task.note || '') || [])[1]
  if (snap) await removeSnapshot(snap, store.snapshotsDir)
  if (current && current.task === task.id) await store.clearCurrent()
  await store.log(`${task.id} | CONFIRM | 已完成 | ${opts.conclusion || task.title}`)
  return entry
}

export async function rejectTask(store, backlog, task, reason) {
  task.status = STATUS.REWORK
  task.note = `${task.note && task.note !== '—' ? `${task.note}；` : ''}打回（${day()}）：${reason}`
  removeDecision(backlog, task.id)
  await store.saveBacklog(backlog)
  const current = await store.readCurrent()
  const snap = current?.task === task.id ? current.snapshot : (/文件快照：([^；\n]+)/.exec(task.note || '') || [])[1]
  if (snap) await removeSnapshot(snap, store.snapshotsDir)
  if (current && current.task === task.id) await store.clearCurrent()
  await store.log(`${task.id} | REJECT | 打回 | ${reason}`)
}

export async function answerTask(store, backlog, taskId, answer) {
  const decision = backlog.decisions.find(d => d.task === taskId)
  removeDecision(backlog, taskId)
  const task = taskById(backlog, taskId)
  let resolvedTask = task
  if (task) {
    task.note = `${task.note && task.note !== '—' ? `${task.note}；` : ''}需求方决策（${day()}）：${answer}`
    if (task.status === STATUS.DECISION || task.status === STATUS.BLOCKED) task.status = STATUS.TODO
    await store.saveBacklog(backlog)
  }
  await store.log(`${taskId} | ANSWER | ${answer}`)
  return { task: resolvedTask, decision }
}

export { PRIORITY_RANK }
