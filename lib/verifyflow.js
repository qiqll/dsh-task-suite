/**
 * 待验证流转规则（loop 调度员与手动单步共用，口径见 skills/task-loop.md）。
 *
 * - 任务进入「待验证」时写 `待验证起：YYYY-MM-DD` 与 `怎么验：<≤3 步>`（首条命令或 URL）。
 * - 挂满 `**待验证超时：** N 天`（backlog 缺省 7，`0` 关闭）且无人打回：
 *   到期前 1 天写 `超时预告`，满 24 小时且交付提交仍在分支上则归档「已完成」，run.log 记 TIMEOUT_PASS。
 * - 高风险路径、改动测试、`默认通过：否` 一律不默认通过；交付提交不可达时转「待决策」。
 * - 机器验收全过且满足规则 a（只改测试）或规则 b（P2/P3 且 note 标 `验收方式：自动`）时直接归档。
 */
import { join } from 'node:path'
import { day, epoch, exists, git, gitText, TEST_PATH_RE } from './util.js'
import { STATUS } from './markdown.js'
import { addDecision, confirmTask } from './tasks.js'
import { diffAgainstSnapshot } from './filesnapshot.js'

export const DEFAULT_TIMEOUT_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const CLAUSE_KEYS = ['待验证起', '超时预告', '怎么验', '后续迹象', '默认通过']
// 重交时只替换待验证流程子句；`默认通过：否` 是需求方的长期偏好，保留。
const STRIP_KEYS = ['待验证起', '超时预告', '怎么验', '后续迹象']
const CLAUSE_RE = new RegExp(`^(${CLAUSE_KEYS.join('|')})：`)
const STRIP_RE = new RegExp(`^(${STRIP_KEYS.join('|')})：`)
const HOLD_RE = /默认通过：否|⚠\s*高风险区域改动|⚠\s*测试有改动/

/** 把 note 拆成 `；` 分隔的子句（note 都是工具写的，分隔符统一）。 */
export function splitNote(note) {
  const text = String(note ?? '')
  if (!text || text === '—') return []
  return text.split('；').map(part => part.trim()).filter(Boolean)
}

export function noteClauses(note) {
  const out = {}
  for (const part of splitNote(note)) {
    const m = CLAUSE_RE.exec(part)
    if (m) out[m[1]] = part.slice(m[1].length + 1).trim()
  }
  return out
}

/** 删掉全部待验证流程子句（重交时旧日期/旧预告不能沿用）。 */
export function stripVerifyClauses(note) {
  const kept = splitNote(note).filter(part => !STRIP_RE.test(part))
  return kept.length ? kept.join('；') : ''
}

export function setNoteClause(note, key, value) {
  const parts = splitNote(note).filter(part => !new RegExp(`^${key}：`).test(part))
  parts.push(`${key}：${value}`)
  return parts.join('；')
}

export function removeNoteClause(note, key) {
  const parts = splitNote(note).filter(part => !new RegExp(`^${key}：`).test(part))
  return parts.length ? parts.join('；') : ''
}

export function timeoutDaysOf(backlog) {
  const explicit = backlog?.verifyTimeoutDays
  if (explicit != null && String(explicit).trim() !== '' && Number.isFinite(Number(explicit))) {
    return Math.max(0, Number(explicit))
  }
  const m = /\*\*待验证超时：\*\*\s*(\d+)\s*天/.exec(String(backlog?.text || ''))
  return m ? Math.max(0, Number(m[1])) : DEFAULT_TIMEOUT_DAYS
}

/** `2026-11-25 09:30`（UTC，与 run.log / 待验证起同口径）。 */
export function stampText(ms = epoch()) {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
}

function parseStamp(text) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(text || '').trim())
  return m ? Date.parse(`${m[1]}T${m[2]}:00Z`) : null
}

function utcDayStart(ms) {
  return Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00Z`)
}

/** 待验证状态：起始日、已挂天数、到期日、预告、是否被 hold。 */
export function verifyState(taskOrNote, opts = {}) {
  const note = typeof taskOrNote === 'string' ? taskOrNote : String(taskOrNote?.note || '')
  const timeoutDays = Number.isFinite(Number(opts.timeoutDays)) ? Number(opts.timeoutDays) : DEFAULT_TIMEOUT_DAYS
  const nowMs = Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : epoch()
  const clauses = noteClauses(note)
  const startText = clauses['待验证起'] || ''
  const startMatch = /^(\d{4}-\d{2}-\d{2})/.exec(startText)
  const start = startMatch ? startMatch[1] : ''
  const startMs = start ? Date.parse(`${start}T00:00:00Z`) : null
  const days = startMs == null ? null : Math.max(0, Math.floor((utcDayStart(nowMs) - startMs) / DAY_MS))
  const dueMs = startMs == null ? null : startMs + timeoutDays * DAY_MS
  const due = dueMs == null ? '' : new Date(dueMs).toISOString().slice(0, 10)
  const announceText = clauses['超时预告'] || ''
  const announceMs = parseStamp(announceText)
  const hold = HOLD_RE.test(note)
  const disabled = timeoutDays === 0
  const dueSoon = !disabled && days != null && days >= timeoutDays - 1
  const closable = !disabled && !hold && announceMs != null && days != null && days >= timeoutDays && nowMs - announceMs >= DAY_MS
  return {
    timeoutDays,
    start,
    inferred: /（推断|存量）/.test(startText),
    days,
    due,
    announceText,
    announceMs,
    announced: announceMs != null,
    hold,
    disabled,
    dueSoon,
    closable,
    steps: clauses['怎么验'] || '',
  }
}

export function describeVerifyTask(task, opts = {}) {
  const st = verifyState(task, opts)
  let phase = 'waiting'
  if (st.disabled) phase = 'disabled'
  else if (st.hold) phase = 'hold'
  else if (st.days == null) phase = 'unknown'
  else if (st.closable) phase = 'closing'
  else if (st.announced) phase = 'announced'
  else if (st.dueSoon) phase = 'due'
  return { id: task.id, title: task.title, priority: task.priority, ...st, phase }
}

export function describeVerifyLine(v) {
  const days = v.days == null ? '起始日未知' : `等待 ${v.days} 天`
  const due = v.disabled ? '默认通过已关闭（待验证超时 0）' : `到期 ${v.due}`
  let tail = ''
  if (v.phase === 'hold') tail = '｜不默认通过（高风险 / 改测试 / 默认通过：否）'
  else if (v.phase === 'due') tail = '｜明天默认通过'
  else if (v.phase === 'announced') tail = `｜已预告（${v.announceText}），到期默认通过`
  else if (v.phase === 'closing') tail = '｜已到期，下次检查默认通过'
  const steps = v.steps && v.steps !== '—' ? v.steps : '待补'
  return `${v.id}（${days}，${due}${tail}）怎么验：${steps}`
}

/** 状态报告里的待验证明细行（只读，不写文件）。 */
export function describeVerifyRows(backlog, opts = {}) {
  const timeoutDays = timeoutDaysOf(backlog)
  return backlog.tasks
    .filter(t => t.status === STATUS.VERIFY)
    .map(t => describeVerifyTask(t, { timeoutDays, ...opts }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.id.localeCompare(b.id))
    .map(describeVerifyLine)
}

/** 验收标准必须是需求方给的（没有「AI 拟」标记），规则 b 才成立。 */
export function acceptanceFromRequester(note) {
  const m = /验收：([^；\n]+)/.exec(String(note || ''))
  if (!m) return false
  const text = m[1].trim()
  if (!text || /^（未提供/.test(text) || /AI 拟/.test(text)) return false
  return true
}

export function onlyTestChanges(changed) {
  const list = (changed || []).filter(Boolean)
  if (!list.length) return false
  return list.every(p => TEST_PATH_RE.test(p) && !/\.(ya?ml|json)$/i.test(p))
}

export function reportAcceptanceFromBacklog(report) {
  return /来源：\s*backlog/i.test(String(report?.acceptance || ''))
}

/**
 * 自动验收判定（loop 的 task_accept 路径；手动单步永不自动验收）。
 * 公共条件全过 + 规则 a（只改测试）或规则 b（P2/P3 且 note 含 `验收方式：自动`，验收标准来自需求方）。
 */
export function shouldAutoAccept({ report, task, changed, test, weakenWarnings = [], risky = [], warnings = [], newDecisions = 0, dispatch = 'manual' } = {}) {
  if (dispatch !== 'auto') return { ok: false, reason: '手动单步不做自动验收' }
  if (test?.verdict !== 'PASS') return { ok: false, reason: `测试结果 ${test?.verdict || '未知'} 不是 PASS` }
  if (weakenWarnings.length) return { ok: false, reason: '测试改弱审计有告警' }
  if (risky.length) return { ok: false, reason: `命中高风险区域：${risky.join(', ')}` }
  if (newDecisions > 0) return { ok: false, reason: '本轮新增待决策' }
  if (warnings.length) return { ok: false, reason: '仍有验收告警' }
  const assumptions = String(report?.assumptions || '').trim()
  if (assumptions && assumptions !== '—') return { ok: false, reason: '报告带 ASSUMPTIONS' }
  if (onlyTestChanges(changed)) return { ok: true, rule: 'a', reason: '只改了测试' }
  const note = String(task?.note || '')
  if (/验收方式：自动/.test(note)
    && ['P2', 'P3'].includes(task?.priority)
    && reportAcceptanceFromBacklog(report)
    && acceptanceFromRequester(note)) {
    return { ok: true, rule: 'b', reason: '录入时标了「验收方式：自动」' }
  }
  return { ok: false, reason: '不满足自动验收的规则 a / b' }
}

/** 进入待验证时写进 note 的「不默认通过」标记。 */
export function verifyHoldMarkers({ risky = [], changed = [] } = {}) {
  const out = []
  if (risky.length) out.push(`⚠ 高风险区域改动：${risky.slice(0, 6).join('、')}`)
  const tests = (changed || []).filter(p => TEST_PATH_RE.test(p))
  if (tests.length) out.push(`⚠ 测试有改动：${tests.slice(0, 6).join('、')}`)
  return out
}

/** 怎么写怎么验：≤3 步，用 → 连接；去掉 `;` `；` ` · `（表格单元格拆分符）。 */
export function normalizeVerifySteps(raw) {
  let text = String(raw ?? '').trim()
  if (!text || text === '—' || text === '-') return ''
  text = text.replace(/\r?\n/g, ' → ').replace(/\s*[;；]\s*/g, ' → ').replace(/\s+·\s+/g, ' → ')
  const steps = text
    .split(/\s*(?:→|->)\s*/)
    .map(s => s.replace(/^[-*\d.、\s]+/, '').trim())
    .filter(Boolean)
  return steps.slice(0, 3).join(' → ')
}

/** 重交时替换旧子句；没有 VERIFY 的老报告留 `—（待补）`。 */
export function stampVerifyEntry(note, { steps, date = day(), tag = '' } = {}) {
  const kept = stripVerifyClauses(note)
  const parts = kept ? [kept] : []
  parts.push(`待验证起：${date}${tag}`)
  parts.push(`怎么验：${steps || '—（待补：worker 报告未给 VERIFY）'}`)
  return parts.join('；')
}

export const MANUAL_VERIFY_RE = /默认通过[:：]\s*否|别默认通过|不要默认通过|不默认通过|我要亲自看|先别默认/

/** 「别默认通过 / 我要亲自看」：保留待验证，删预告，加标记。 */
export function setDefaultPassOff(note) {
  return setNoteClause(removeNoteClause(note, '超时预告'), '默认通过', '否')
}

async function inferVerifyStart(store, task) {
  const shas = []
  for (const m of String(task.note || '').matchAll(/commits?\s+([0-9a-f]{7,40}(?:\s+[0-9a-f]{7,40})*)/gi)) {
    shas.push(m[1].split(/\s+/)[0])
  }
  for (const sha of shas) {
    const date = (await gitText(store.root, ['log', '-1', '--format=%as', `${sha}^{commit}`])).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date, source: 'commit' }
  }
  const log = await gitText(store.root, ['log', '--format=%as%x09%s', '-100'])
  for (const line of log.split(/\r?\n/)) {
    const [date, ...rest] = line.split('\t')
    const subject = rest.join('\t')
    if (!subject.includes(task.id)) continue
    if (/docs\(task\):/.test(subject)) continue
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date, source: 'log' }
  }
  return { date: day(), source: 'today' }
}

async function deliveryEvidence(store, task) {
  const note = String(task.note || '')
  const snapshotPath = (/文件快照：([^；\n]+)/.exec(note) || [])[1]?.trim()
  if (snapshotPath) {
    if (!(await exists(join(snapshotPath, 'manifest.json')))) return { level: 'unknown', text: '无法检查（开工快照已清理）' }
    try {
      const diff = await diffAgainstSnapshot({
        root: store.root,
        snapshot: snapshotPath,
        stateRel: store.rel(store.dir),
        ignore: store.config.snapshotIgnore,
      })
      if (!diff.count) return { level: 'missing', text: '文件快照差异为空（交付改动已不在工作区）' }
      return { level: 'ok', text: `快照差异显示改动仍在（${diff.count} 个文件）` }
    } catch (error) {
      return { level: 'unknown', text: `无法检查（快照比对失败：${error?.message ?? error}）` }
    }
  }
  const shas = new Set()
  for (const m of note.matchAll(/commits?\s+([0-9a-f]{7,40}(?:\s+[0-9a-f]{7,40})*)/gi)) {
    for (const sha of m[1].split(/\s+/)) shas.add(sha)
  }
  const log = await gitText(store.root, ['log', '--format=%H%x09%s', '-100'])
  for (const line of log.split(/\r?\n/).filter(Boolean)) {
    const [sha, ...rest] = line.split('\t')
    const subject = rest.join('\t')
    if (!subject.includes(task.id)) continue
    if (/docs\(task\):/.test(subject)) continue
    shas.add(sha)
  }
  if (!shas.size) return { level: 'unknown', text: '无法检查（没有交付提交记录）' }
  for (const sha of shas) {
    const full = (await gitText(store.root, ['rev-parse', '--verify', `${sha}^{commit}`])).trim()
    if (!full) continue
    const ancestor = await git(store.root, ['merge-base', '--is-ancestor', full, 'HEAD'])
    if (!ancestor.ok) continue
    const revert = await gitText(store.root, ['log', '-1', '--format=%h', '--grep', `This reverts commit ${full}`])
    if (revert) continue
    return { level: 'ok', text: `提交在当前分支（${full.slice(0, 7)}）` }
  }
  return { level: 'missing', text: '交付提交已不在当前分支或已被 revert' }
}

/**
 * 待验证到期检查：补起始日 → 预告 → 到期默认通过 / 转待决策。
 * 由 loop tick 在合并 inbox 之后、以及手动单步（无循环时）调用。
 */
export async function checkVerifyTimeout({ store, nowMs = epoch() } = {}) {
  const data = await store.load()
  const backlog = data.backlog
  const timeoutDays = timeoutDaysOf(backlog)
  const result = { timeoutDays, disabled: timeoutDays === 0, announced: [], closed: [], decisions: [], held: [], inferred: [] }
  if (result.disabled) return result

  let dirty = false
  const candidates = []
  for (const task of backlog.tasks.filter(t => t.status === STATUS.VERIFY)) {
    let st = verifyState(task, { timeoutDays, nowMs })
    if (!st.start) {
      const inferred = await inferVerifyStart(store, task)
      task.note = setNoteClause(task.note, '待验证起', `${inferred.date}（推断）`)
      result.inferred.push({ task: task.id, date: inferred.date, source: inferred.source })
      st = verifyState(task, { timeoutDays, nowMs })
      dirty = true
    }
    if (st.hold) {
      result.held.push({ task: task.id, title: task.title, days: st.days, steps: st.steps })
      continue
    }
    if (!st.announced) {
      if (st.days != null && st.days >= timeoutDays - 1) {
        task.note = setNoteClause(task.note, '超时预告', stampText(nowMs))
        dirty = true
        result.announced.push({ task: task.id, title: task.title, days: st.days, due: st.due, steps: st.steps })
        await store.log(`${task.id} | VERIFY_DUE | 待验证 ${st.days} 天 | 明天默认通过 | 怎么验：${st.steps || '待补'}`)
      }
      continue
    }
    if (st.closable) candidates.push({ task, state: st })
  }
  if (dirty) await store.saveBacklog(backlog)

  for (const { task, state } of candidates) {
    const evidence = await deliveryEvidence(store, task)
    if (evidence.level === 'missing') {
      addDecision(backlog, {
        task: task.id,
        question: `${task.id} 的交付提交已不在当前分支或已被 revert，到期无法默认通过`,
        options: 'A（推荐）打回重做；B 取消；C 仍按通过关闭',
        since: day(),
      })
      result.decisions.push({ task: task.id, evidence: evidence.text })
      await store.log(`${task.id} | TIMEOUT_HOLD | 交付提交不可达 | ${evidence.text}`)
      continue
    }
    const closeMethod = `超时默认通过（${state.days} 天无人打回）${state.inferred ? ' · 存量' : ''}`
    await confirmTask(store, backlog, task, {
      conclusion: `超时默认通过：${task.title}`,
      gate: 'TIMEOUT_PASS',
      closeMethod,
      evidence: evidence.text,
      silent: true,
    })
    result.closed.push({ task: task.id, title: task.title, days: state.days, evidence: evidence.text })
    await store.log(`${task.id} | TIMEOUT_PASS | 待验证 ${state.days} 天 | ${evidence.text}`)
  }
  if (result.decisions.length) await store.saveBacklog(backlog)
  return result
}
