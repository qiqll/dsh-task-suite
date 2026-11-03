import { splitRow, cell, isSeparatorRow, isPlaceholderRow } from './util.js'

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const PRIORITY_TITLES = {
  P0: 'P0 — 紧急（打断一切）',
  P1: 'P1 — 重要',
  P2: 'P2 — 增强 / 技术债',
  P3: 'P3 — 想法池',
}
export const STATUS = {
  TODO: '待开始',
  DOING: '进行中',
  BLOCKED: '阻塞',
  DECISION: '待决策',
  VERIFY: '待验证',
  REWORK: '打回',
  DONE: '已完成',
  CANCELLED: '已取消',
}
export const KNOWN_STATUSES = new Set(Object.values(STATUS))

const STD_ORDER = ['状态机', '优先级定义', ...PRIORITIES.map(p => `${p} `), '待决策', '人工阻塞事项', 'ID 分配规则']

const TASK_HEADER = ['ID', '任务', '模块', '状态', '依赖', '备注']
const DECISION_HEADER = ['任务', '问题', '选项（推荐在前）', '挂起时间']
const BLOCKER_HEADER = ['编号', '描述', '阻塞的任务', '状态']

export const BACKLOG_TEMPLATE = `# 任务待办池（Backlog）

> **这是需求方的唯一入口。** 你只需往对应优先级的表里加一行，AI 会按序消化。
> 不需要关心当前开发到哪了，不需要等 AI 空闲，随时追加即可。

**配套文件：** 开发计划 \`dev-plan.md\`（AI 维护的排期与依赖分析） · 进度流水 \`dev-progress.md\`（已完成任务的归档）
**驱动方式：** 工具 \`task_add\` 录入 · \`task_pick\` 认领 · \`task_status\` 看全局 · skill \`task-loop\` 自动循环

---

## 状态机

\`\`\`
待开始 ──► 进行中 ──► 待验证 ──► 已完成
   │          │          │
   └──► 已取消 └──► 阻塞  └──► 打回（验证不通过，回到进行中）
\`\`\`

| 状态 | 含义 | 谁改 |
|------|------|------|
| \`待开始\` | 已录入，排队中 | 需求方录入时 / AI |
| \`进行中\` | AI 正在实施（同一时刻最多 1 个） | AI |
| \`阻塞\` | 缺前置条件（依赖任务未完成 / 需人工操作 / 需你决策） | AI |
| \`待决策\` | 自动循环遇到需你拍板的问题，已挂到「待决策」表，答复后回到待开始 | AI |
| \`待验证\` | 代码已提交并过门禁，等你实际使用确认 | AI |
| \`已完成\` | 你确认无误，移入 \`dev-progress.md\` | 需求方确认后由 AI 移动 |
| \`打回\` | 你使用后发现不对，说明问题后回到进行中 | 需求方 |
| \`已取消\` | 不做了 | 需求方 |

## 优先级定义

| 级别 | 含义 | 消化顺序 |
|------|------|---------|
| **P0** | 线上故障、数据错误、安全漏洞 —— 打断一切 | 立即，可中断进行中的任务 |
| **P1** | 用户可感知的功能缺失或体验问题 | P0 清空后 |
| **P2** | 功能增强、重构、技术债 | P1 清空后 |
| **P3** | 想法池，做不做都行 | 有余力时 |

---

## P0 — 紧急（打断一切）

| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |
|----|------|------|------|------|------|
| — | 暂无 | | | | |

## P1 — 重要

| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |
|----|------|------|------|------|------|
| — | 暂无 | | | | |

## P2 — 增强 / 技术债

| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |
|----|------|------|------|------|------|
| — | 暂无 | | | | |

## P3 — 想法池

| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |
|----|------|------|------|------|------|
| — | 暂无 | | | | |

---

## 待决策

> 自动循环遇到需要你拍板的问题时挂在这里，然后跳去做别的任务。回答方式：在调度会话里直接说「T-0NN 选 A」，或调用 \`task_answer\`。

| 任务 | 问题 | 选项（推荐在前） | 挂起时间 |
|------|------|-----------------|---------|
| — | 暂无 | | |

---

## 人工阻塞事项

> 需要你（人）动手才能推进的，AI 无法代劳。这里的条目会阻塞对应任务。

| 编号 | 描述 | 阻塞的任务 | 状态 |
|------|------|-----------|------|
| — | 暂无 | | |

---

## ID 分配规则

- 格式 \`T-NNN\`，三位数字，全局递增，**永不复用**（即使任务取消）
- 下一个可用 ID：**T-001**（AI 录入后须更新此行）
- 人工阻塞事项用 \`H-NNN\`，下一个可用：**H-001**
`

function headingKey(line) {
  return line.replace(/^##\s+/, '').trim()
}

export function parseDoc(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const sections = []
  const preamble = []
  let current = null
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      current = { heading: headingKey(line), body: [] }
      sections.push(current)
      continue
    }
    if (current) current.body.push(line)
    else preamble.push(line)
  }
  return { preamble, sections }
}

function sectionBody(section) {
  return section ? section.body.join('\n') : ''
}

function findSection(doc, prefix) {
  return doc.sections.find(s => s.heading.startsWith(prefix))
}

function replaceBody(doc, prefix, body) {
  let section = findSection(doc, prefix)
  if (!section) {
    section = { heading: prefix, body: [] }
    insertSection(doc, section)
  }
  section.body = body.split('\n')
}

function canonicalRank(heading) {
  for (const p of PRIORITIES) if (heading.startsWith(`${p} `)) return 2 + PRIORITIES.indexOf(p)
  if (heading.startsWith('待决策')) return 6
  if (heading.startsWith('人工阻塞')) return 7
  if (heading.startsWith('ID 分配规则')) return 8
  if (heading.startsWith('优先级定义')) return 1
  if (heading.startsWith('状态机')) return 0
  return 9
}

function insertSection(doc, section) {
  const rank = canonicalRank(section.heading)
  let index = doc.sections.findIndex(s => canonicalRank(s.heading) > rank)
  if (index < 0) index = doc.sections.length
  doc.sections.splice(index, 0, section)
}

export function renderTable(header, rows) {
  const head = `| ${header.join(' | ')} |`
  const sep = `|${header.map(() => '------').join('|')}|`
  const body = rows.length ? rows.map(r => `| ${r.join(' | ')} |`) : []
  return [head, sep, ...body].join('\n')
}

export function parseTaskRows(body) {
  const tasks = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = splitRow(line)
    if (!cells.length || isSeparatorRow(cells)) continue
    if (!/^T-\d{3}/.test(cells[0] || '')) continue
    if (isPlaceholderRow(cells)) continue
    const id = cells[0]
    const note = cells.slice(5).join(' | ') || '—'
    tasks.push({
      id,
      title: cells[1] || '（未命名）',
      module: cells[2] || '—',
      status: (cells[3] || STATUS.TODO).replace(/`/g, '').trim(),
      deps: cells[4] || '—',
      note,
      priority: null,
    })
  }
  return tasks
}

export function parseDecisionRows(body) {
  const decisions = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = splitRow(line)
    if (!cells.length || isSeparatorRow(cells)) continue
    if (isPlaceholderRow(cells)) continue
    if (!/^T-\d{3}$/.test(cells[0] || '')) continue
    decisions.push({ task: cells[0], question: cells[1] || '', options: cells[2] || '', since: cells[3] || '—' })
  }
  return decisions
}

export function parseBlockerRows(body) {
  const blockers = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = splitRow(line)
    if (!cells.length || isSeparatorRow(cells)) continue
    if (isPlaceholderRow(cells)) continue
    if (!/^H-\d{3}$/.test(cells[0] || '')) continue
    blockers.push({ id: cells[0], desc: cells[1] || '', task: cells[2] || '—', status: cells[3] || '待处理' })
  }
  return blockers
}

export function parseBacklog(text) {
  const doc = parseDoc(text)
  const tasks = []
  for (const p of PRIORITIES) {
    const section = findSection(doc, p)
    const rows = parseTaskRows(sectionBody(section))
    for (const t of rows) { t.priority = p; tasks.push(t) }
  }
  const decisions = parseDecisionRows(sectionBody(findSection(doc, '待决策')))
  const blockers = parseBlockerRows(sectionBody(findSection(doc, '人工阻塞事项')))
  const idBody = sectionBody(findSection(doc, 'ID 分配规则'))
  const nextMatch = idBody.match(/下一个可用 ID：\*\*(T-\d{3})\*\*/)
  const blockerMatch = idBody.match(/下一个可用：\*\*(H-\d{3})\*\*/)
  return {
    doc,
    tasks,
    decisions,
    blockers,
    nextTaskId: nextMatch ? nextMatch[1] : nextId(tasks.map(t => t.id), 'T'),
    nextBlockerId: blockerMatch ? blockerMatch[1] : nextId(blockers.map(b => b.id), 'H'),
  }
}

function nextId(ids, prefix) {
  let max = 0
  for (const id of ids) {
    const m = new RegExp(`^${prefix}-(\\d{3})$`).exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

export function bumpId(id, prefix) {
  const m = new RegExp(`^${prefix}-(\\d{3})$`).exec(String(id ?? ''))
  const n = m ? Number(m[1]) : 0
  return `${prefix}-${String(n + 1).padStart(3, '0')}`
}

export function renderBacklog(parsed) {
  const doc = parsed.doc
  for (const p of PRIORITIES) {
    const rows = parsed.tasks.filter(t => t.priority === p).map(t => [
      cell(t.id), cell(t.title), cell(t.module), cell(t.status), cell(t.deps), cell(t.note),
    ])
    const bodyRows = rows.length ? rows : [['—', '暂无', '', '', '', '']]
    replaceBody(doc, `${p} `, `\n\n${renderTable(TASK_HEADER, bodyRows)}\n`)
  }
  const decisionRows = parsed.decisions.length ? parsed.decisions.map(d => [cell(d.task), cell(d.question), cell(d.options), cell(d.since)]) : [['—', '暂无', '', '']]
  replaceBody(doc, '待决策', `\n\n${renderTable(DECISION_HEADER, decisionRows)}\n`)
  const blockerRows = parsed.blockers.length ? parsed.blockers.map(b => [cell(b.id), cell(b.desc), cell(b.task), cell(b.status)]) : [['—', '暂无', '', '']]
  replaceBody(doc, '人工阻塞事项', `\n\n${renderTable(BLOCKER_HEADER, blockerRows)}\n`)
  replaceBody(doc, 'ID 分配规则', `\n\n- 格式 \`T-NNN\`，三位数字，全局递增，**永不复用**（即使任务取消）\n- 下一个可用 ID：**${parsed.nextTaskId}**（AI 录入后须更新此行）\n- 人工阻塞事项用 \`H-NNN\`，下一个可用：**${parsed.nextBlockerId}**\n`)
  // Ensure the two foundational sections exist in a hand-written file.
  if (!findSection(doc, '状态机')) insertSection(doc, { heading: '状态机', body: ['', '见 Backlog 模板：待开始 → 进行中 → 待验证 → 已完成；异常态 阻塞 / 待决策 / 打回 / 已取消。', ''] })
  if (!findSection(doc, '优先级定义')) insertSection(doc, { heading: '优先级定义', body: ['', 'P0 线上故障/安全 > P1 功能缺失 > P2 增强/技术债 > P3 想法池。', ''] })
  return renderDoc(doc)
}

export function renderDoc(doc) {
  const parts = []
  const pre = doc.preamble.join('\n').replace(/\s+$/, '')
  if (pre) parts.push(pre, '')
  for (const section of doc.sections) {
    parts.push(`## ${section.heading}`, '')
    const body = section.body.join('\n').replace(/\s+$/, '')
    if (body) parts.push(body, '')
  }
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function renderPlan({ batches, current, todoCounts, date }) {
  const batchRows = batches.length
    ? batches.map((t, i) => [String(i + 1), t.id, cell(t.title), cell(t.reason || '按优先级与依赖顺位')])
    : [['—', '—', '待办池为空', '—']]
  const currentRows = current
    ? [[current.task, cell(current.title || '—'), current.started ? new Date(current.started).toISOString().slice(0, 16).replace('T', ' ') : '—', cell(current.phase), cell(current.next || '等待 worker 交付')]]
    : [['—', '（空）', '—', '—', '—']]
  return `# 开发计划（Dev Plan）

> **这是 AI 维护的文件，需求方只读。** 内容是 AI 对 \`backlog.md\` 的排期分析：下一步做什么、为什么这个顺序、有哪些技术前置。
> 每次 \`task_pick\` / \`task_loop\` 开工前会刷新此文件的「当前批次」章节。

**最后更新：** ${date}

---

## 当前批次

> AI 认为接下来应该按此顺序消化。需求方若不同意，直接说，或改 \`backlog.md\` 的优先级。

${renderTable(['顺位', 'ID', '任务', '理由'], batchRows)}

**待验证（等需求方确认后归档）：** ${todoCounts.verify || 0} 条

**被阻塞、暂不排期：** ${todoCounts.blocked || 0} 条

## 进行中任务

${renderTable(['ID', '任务', '开工时间', '当前阶段', '下一步'], currentRows)}

> 同一时刻只允许 1 个任务处于「进行中」。若此处非空而你又要插 P0，先让当前任务落到可提交的中间态并记录断点。

---

## 技术前置分析

（暂无）
`
}

export const PROGRESS_TEMPLATE = `# 开发进度流水（Dev Progress）

> **已完成任务的归档。** 每个任务消化完毕后从 \`backlog.md\` 移到这里，追加在最上方（倒序）。
> 这是「做过什么」的可追溯记录，也是需求方回顾交付节奏的依据。

**统计：** 已归档 0 项 · 打回 0 次

---

## 记录格式

每条记录必须包含：任务 ID / 完成日期 / 一句话结论 / commit 列表 / 门禁结果 / 遗留项。
不写实现细节 —— 细节在 commit message 里。

---

## YYYY-MM

（暂无）
`

export function completedIds(progressText) {
  const ids = new Set()
  const re = /^###\s+(T-\d{3})/gm
  let m
  while ((m = re.exec(String(progressText ?? ''))) !== null) ids.add(m[1])
  return ids
}

export function appendProgress(text, entry) {
  const doc = parseDoc(text)
  const monthName = new Date().toISOString().slice(0, 7)
  let section = doc.sections.find(s => s.heading === monthName)
  if (!section) {
    section = { heading: monthName, body: [] }
    doc.sections.push(section)
  }
  const body = section.body.join('\n').replace(/^\s*（暂无）\s*$/, '').trimEnd()
  section.body = `${body}${body ? '\n\n' : ''}${entry}`.split('\n')
  doc.preamble = doc.preamble.map(line => line.replace(/已归档 (\d+) 项/, (_, n) => `已归档 ${Number(n) + 1} 项`))
  return renderDoc(doc)
}
