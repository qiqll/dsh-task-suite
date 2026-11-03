import { join } from 'node:path'
import { STATUS, PRIORITIES } from './markdown.js'
import { TaskError } from './store.js'
import {
  taskById, addDecision, addBlocker, addDerivedTasks,
  parseWorkerReport, writePlan,
} from './tasks.js'
import { commitsInRange, changedPaths, dirtyPaths, verifyTests, checkTestWeakening, riskyPaths } from './verify.js'
import { day, epoch, formatDuration, git, gitText, normalizeTitle, truncate } from './util.js'
import { diffAgainstSnapshot, restoreSnapshot } from './filesnapshot.js'

function decideOptions(text) {
  const t = String(text ?? '').trim()
  if (!t) return { question: '（未给出问题）', options: '—' }
  const parts = t.split(/\s+\/\s+/).filter(Boolean)
  if (parts.length === 1) return { question: parts[0], options: '—' }
  return { question: parts[0], options: parts.slice(1).join('；') }
}

function noteAppend(task, text) {
  task.note = `${task.note && task.note !== '—' ? `${task.note}；` : ''}${text}`
}

export async function acceptReport({ store, reportText, rollback = false, review, timeoutSec, config }) {
  const current = await store.readCurrent()
  if (!current) return { ok: false, code: 'NO_CURRENT', text: '当前没有正在验收的任务（缺少 auto/current.json）。这可能是迟到或重复的通知，已丢弃。' }
  const report = parseWorkerReport(reportText)
  if (!report) return { ok: false, code: 'NO_REPORT', text: `未找到报告块。当前任务 ${current.task} 仍在进行，请让 worker 重新交付带 NONCE 的报告。` }
  if (report.nonce !== current.nonce) return { ok: false, code: 'NONCE_MISMATCH', text: `报告口令 ${report.nonce || '（缺失）'} 与当前任务 ${current.task} 的口令不一致。这是迟到或重复的通知，已丢弃。` }
  if (report.task && report.task !== current.task) return { ok: false, code: 'TASK_MISMATCH', text: `报告任务 ${report.task} 与当前任务 ${current.task} 不一致，已丢弃。` }
  if (!['running', 'review_pending', 'accepting'].includes(current.phase)) {
    return { ok: false, code: 'PHASE_MISMATCH', text: `当前阶段 ${current.phase} 不接受新报告，已丢弃。` }
  }

  const data = await store.load()
  const backlog = data.backlog
  const task = taskById(backlog, current.task)
  if (!task) {
    await store.clearCurrent()
    return { ok: false, code: 'TASK_MISSING', text: `任务 ${current.task} 不在待办池中（可能已被手工移动）。current 已清理。` }
  }

  const startSha = current.start_sha || report.start_sha
  const fileMode = current.mode === 'file' && !!current.snapshot
  const snapshotPath = fileMode ? current.snapshot : ''
  const elapsed = formatDuration(epoch() - (current.started || epoch()))
  let result = report.result

  const finish = async ({ status, verdict, tone, action, brief, extraText, noprogDelta = 0, doneDelta = 0, halt = false }) => {
    task.status = status
    await store.saveBacklog(backlog)
    const session = await store.readSession()
    if (session) {
      session.done = (session.done || 0) + doneDelta
      session.noprog = Math.max(0, (session.noprog || 0) + noprogDelta)
      await store.writeSession(session)
    }
    await writePlan(store, backlog, await store.archivedIds(), halt ? { ...current, phase: 'halted' } : null)
    const current2 = await store.readCurrent()
    if (current2) {
      await store.writeCurrent({ ...current2, phase: halt ? 'halted' : 'accepted', verdict })
      await store.clearCurrent()
    }
    await store.log(`${task.id} | ${result}→${status} | commits ${report.commits.length} | ${elapsed} | 衍生 ${report.derived.length} | ${truncate(brief || '', 120)}`)
    return {
      ok: true,
      code: 'ACCEPTED',
      task: task.id,
      result,
      status,
      attitude: tone,
      action,
      halt,
      brief: brief || '',
      text: extraText || `任务 ${task.id}：${result} → ${status}`,
      current: null,
      report,
    }
  }

  if (result === 'GATE_PENDING_REVIEW' && !review) {
    const next = { ...current, phase: 'review_pending', gate_note: report.gate }
    await store.writeCurrent(next)
    await store.log(`${task.id} | GATE_PENDING_REVIEW | 等调度员代为审查`)
    return {
      ok: true, code: 'REVIEW_PENDING', task: task.id, result, status: task.status, action: 'review',
      text: `worker 无法派发子 agent。请调度员审查 ${startSha}..HEAD，把发现（High/Critical/Medium）发给 worker-${task.id}（同一 nonce ${current.nonce}），让它修完重新交付报告。`,
      report,
    }
  }

  if (result === 'GATE_PENDING_REVIEW') {
    const verdict = String(review).trim()
    if (!/^(pass|通过|ok|approved|approve|可以|lgtm)/i.test(verdict)) {
      return {
        ok: false, code: 'REVIEW_FIX', task: task.id, result, status: task.status, action: 'review_fix',
        text: `调度员复审未通过，暂不验收。请把以下发现发回 worker-${task.id}（nonce ${current.nonce}）修复，修完让它重新输出报告；随后再 task_accept 同一报告 + review="pass: ..."。\n\n${verdict}`,
        report,
      }
    }
    report.result = 'DONE'
    result = 'DONE'
    report.gate = `${report.gate ? `${report.gate}；` : ''}调度员复审：${verdict}`
  }

  if (result === 'NEEDS_DECISION') {
    const d = decideOptions(report.decision || report.blocker)
    addDecision(backlog, { task: task.id, question: d.question, options: d.options, since: day() })
    task.status = STATUS.DECISION
    await store.saveBacklog(backlog)
    await finish({ status: STATUS.DECISION, verdict: `待决策：${d.question}`, tone: 'decision', action: 'ask_user', brief: report.brief, extraText: `任务 ${task.id} 需要你拍板：\n问题：${d.question}\n选项：${d.options}`, noprogDelta: 1 })
    return { ok: true, code: 'ACCEPTED', task: task.id, result, status: STATUS.DECISION, action: 'ask_user', decision: d, brief: report.brief, report, text: `任务 ${task.id} 挂入待决策：${d.question}｜${d.options}` }
  }

  if (result === 'BLOCKED' || result === 'BASELINE_RED') {
    let blockerText = report.blocker || (result === 'BASELINE_RED' ? `基线红：${report.test_result || '（用例未列出）'}` : '（未给出原因）')
    if (result === 'BASELINE_RED') {
      const derivedText = `修复基线失败：${report.test_result || '（用例未列出）'} | 涉及文件 ${report.fields?.TEST_CMD || '—'} | 来源 基线红`
      addDerivedTasks(backlog, task, [derivedText], config)
      noteAppend(task, `基线红（${day()}）：${blockerText}`)
    }
    const hid = addBlocker(backlog, { desc: `任务 ${task.id} 阻塞：${blockerText}`, task: task.id })
    await store.saveBacklog(backlog)
    await finish({ status: STATUS.BLOCKED, verdict: `阻塞（${hid}）：${truncate(blockerText, 120)}`, tone: 'blocked', action: 'report_blocker', brief: report.brief, extraText: `任务 ${task.id} 阻塞：${blockerText}\n已登记人工阻塞 ${hid}。`, noprogDelta: 1 })
    return { ok: true, code: 'ACCEPTED', task: task.id, result, status: STATUS.BLOCKED, action: 'report_blocker', blocker: blockerText, blockerId: hid, brief: report.brief, report, text: `任务 ${task.id} 阻塞：${truncate(blockerText, 200)}` }
  }

  if (result !== 'DONE') {
    // FAILED / unknown / absent.
    const reason = report.blocker || report.fields?.RESULT || '未给出原因'
    const failMatch = /自动失败×(\d+)/.exec(task.note || '')
    const failures = (failMatch ? Number(failMatch[1]) : 0) + 1
    noteAppend(task, `自动失败×${failures}：${truncate(reason, 160)}`)

    let rollbackInfo = ''
    if (rollback) {
      if (fileMode) {
        try {
          const restored = await restoreSnapshot({
            root: store.root,
            snapshot: snapshotPath,
            stateRel: store.rel(store.dir),
            ignore: store.config.snapshotIgnore,
            backupRoot: join(store.autoDir, 'rollback'),
          })
          rollbackInfo = `已恢复开工快照：恢复 ${restored.restored} 个文件，删除 ${restored.deleted} 个新增文件（恢复前备份在 ${store.rel(restored.backup)}）。`
        } catch (error) {
          rollbackInfo = `快照回滚失败：${error.message}。现场未改动，请人工处理。`
        }
      } else {
        const commits = await commitsInRange(store.root, startSha)
        const foreign = commits.filter(c => !c.subject.includes(task.id))
        if (foreign.length) {
          rollbackInfo = `未回滚：验收区间出现非本任务提交 ${foreign.map(c => c.sha.slice(0, 7)).join(', ')}，需人工处理。`
          addDecision(backlog, { task: task.id, question: '验收区间出现非本任务提交，是否回滚？', options: `A（推荐）保留现场人工检查/${foreign.map(c => c.sha.slice(0, 7)).join(' ')}；B 回滚到 ${startSha.slice(0, 7)}`, since: day() })
        } else {
          const ref = `refs/task-failed/${task.id}-${failures}`
          await git(store.root, ['update-ref', ref, 'HEAD'])
          const reset = await git(store.root, ['reset', '--keep', startSha])
          rollbackInfo = reset.ok
            ? `已回滚到 ${startSha.slice(0, 8)}（原 HEAD 保存在 ${ref}）。`
            : `回滚失败（--keep 拒绝）：${reset.text}。现场未改动，请人工处理。`
        }
      }
    }
    const leftovers = fileMode ? [] : (await dirtyPaths(store.root)).filter(p => !(current.dirty || []).includes(p))
    if (leftovers.length) {
      addDecision(backlog, { task: task.id, question: '失败任务的遗留未提交文件，请决定去留', options: `${leftovers.join('；')}（A 保留 / B 删除）`, since: day() })
    }
    const status = failures >= 2 ? STATUS.BLOCKED : STATUS.TODO
    if (status === STATUS.BLOCKED) addBlocker(backlog, { desc: `任务 ${task.id} 连续自动失败 ${failures} 次：${truncate(reason, 120)}`, task: task.id })
    await store.saveBacklog(backlog)
    await finish({ status, verdict: `自动失败×${failures}：${truncate(reason, 120)}`, tone: 'failed', action: 'retry_or_stop', brief: report.brief, extraText: `任务 ${task.id} 交付失败（第 ${failures} 次）：${truncate(reason, 300)}\n${rollbackInfo}${leftovers.length ? `\n遗留文件：${leftovers.join(', ')}` : ''}`, noprogDelta: 1 })
    return { ok: true, code: 'ACCEPTED', task: task.id, result, status, action: 'retry_or_stop', failures, rollbackInfo, brief: report.brief, report, text: `任务 ${task.id} 自动失败×${failures}，已回到 ${status}` }
  }

  // ---- DONE: machine acceptance ----
  const problems = []
  const warnings = []

  const commits = fileMode ? [] : await commitsInRange(store.root, startSha)
  if (!fileMode) {
    if (!report.commits.length) problems.push('报告中没有任何 commit。')
    if (!commits.length) problems.push(`验收区间 ${startSha.slice(0, 8)}..HEAD 没有提交。`)
  }
  const foreign = fileMode ? [] : commits.filter(c => !c.subject.includes(task.id))
  if (foreign.length) {
    addDecision(backlog, {
      task: task.id,
      question: '验收区间出现非本任务提交，工作区独占可能被打破',
      options: 'A（推荐）保留现场，人工确认这些提交归属；B 忽略并继续验收',
      since: day(),
    })
    await store.saveBacklog(backlog)
    await finish({ status: STATUS.DECISION, verdict: '非本任务提交', tone: 'decision', action: 'halt', brief: report.brief, halt: true, extraText: `验收停机：${startSha.slice(0, 8)}..HEAD 中出现不属于 ${task.id} 的提交：\n${foreign.map(c => `${c.sha.slice(0, 8)} ${c.subject}`).join('\n')}\n未回滚。已挂入待决策。`, noprogDelta: 1 })
    return { ok: true, code: 'ACCEPTED', task: task.id, result, status: STATUS.DECISION, action: 'halt', halt: true, brief: report.brief, report, text: '验收区间出现非本任务提交，已停机挂待决策。' }
  }
  const stateRel = `${store.rel(store.dir)}/`
  let changed = []
  if (fileMode) {
    const diff = await diffAgainstSnapshot({
      root: store.root,
      snapshot: snapshotPath,
      stateRel: store.rel(store.dir),
      ignore: store.config.snapshotIgnore,
    })
    changed = diff.changed
    if (!diff.count) warnings.push('未检测到任何文件改动（快照与当前工作区一致）')
    const declared = String(report.fields?.CHANGES || '').trim()
    if (declared && declared !== '—') {
      const listed = declared.split(/[,\s，、]+/).filter(Boolean)
      const missing = changed.filter(p => !listed.some(x => p === x || p.endsWith(x)))
      if (missing.length) warnings.push(`报告 CHANGES 未列出这些改动：${missing.slice(0, 10).join(', ')}`)
    }
  } else {
    const reported = new Set(report.commits)
    const unlisted = commits.filter(c => !reported.has(c.sha) && !reported.has(c.sha.slice(0, 7)))
    if (unlisted.length) problems.push(`有提交未写入报告 COMMITS：${unlisted.map(c => c.sha.slice(0, 7)).join(', ')}`)
    changed = await changedPaths(store.root, startSha)
    const touchedDirty = changed.filter(p => (current.dirty || []).some(d => p === d || p.startsWith(`${d}/`)))
    if (touchedDirty.length) problems.push(`改动了开工时的脏文件：${touchedDirty.join(', ')}`)
    const touchedState = changed.filter(p => p.startsWith(stateRel))
    if (touchedState.length) problems.push(`改动了任务池状态文件：${touchedState.join(', ')}`)
    const dirtyNow = await dirtyPaths(store.root)
    const leftovers = dirtyNow.filter(p => !(current.dirty || []).includes(p))
    if (leftovers.length) {
      warnings.push(`worker 遗留未提交改动：${leftovers.join(', ')}`)
      addDecision(backlog, { task: task.id, question: 'worker 遗留未提交改动，请决定去留', options: `${leftovers.join('；')}（A 保留 / B 删除）`, since: day() })
    }
  }

  let test = { verdict: 'FAIL_UNPARSED', failures: [], preexisting: [], output: '' }
  if (!report.test_cmd) problems.push('报告未提供 TEST_CMD。')
  else {
    test = await verifyTests({
      root: store.root, startSha, testCmd: report.test_cmd, timeoutSec: timeoutSec || config.testTimeoutSec,
      mode: fileMode ? 'file' : 'git', snapshot: snapshotPath,
      stateRel: store.rel(store.dir), ignore: store.config.snapshotIgnore,
    })
  }
  if (test.verdict === 'REJECT_CMD') {
    // Give the worker one chance to resubmit a compliant command under the same nonce.
    const next = { ...current, phase: 'review_pending', reject_cmd: test.reason }
    await store.writeCurrent(next)
    await store.log(`${task.id} | REJECT_CMD | ${test.reason}`)
    return {
      ok: true, code: 'REVIEW_PENDING', task: task.id, result, status: task.status, action: 'fix_test_cmd',
      text: `TEST_CMD 不合规：${test.reason}\n请把这条意见发给 worker-${task.id}（同一 nonce ${current.nonce}），让它按 task-worker 的 TEST_CMD 规则重给并重跑测试，再返回同一格式报告。`,
      report, test,
    }
  }
  if (test.verdict === 'FAIL_NEW' || test.verdict === 'FAIL_TIMEOUT' || test.verdict === 'FAIL_UNPARSED' || test.verdict === 'REJECT_CMD') {
    problems.push(`测试未通过：${test.verdict}${test.failures?.length ? `（${test.failures.join(', ')}）` : ''}`)
  }
  if (test.verdict === 'PASS_PREEXISTING') warnings.push('测试存在既有失败（基线已红）：' + test.preexisting.join(', '))

  const weaken = await checkTestWeakening({
    root: store.root, startSha, mode: fileMode ? 'file' : 'git', snapshot: snapshotPath,
    stateRel: store.rel(store.dir), ignore: store.config.snapshotIgnore,
  })
  if (weaken.warnings.length) {
    const explained = /仅新增/.test(report.test_changes || '')
    if (explained && /仅新增/.test(report.test_changes || '')) warnings.push(`⚠ 测试有改动：${weaken.warnings.join('；')}（报告说明：${report.test_changes}）`)
    else {
      warnings.push(`⚠ 测试改动需确认：${weaken.warnings.join('；')}`)
      addDecision(backlog, { task: task.id, question: '测试改动需确认', options: `${weaken.warnings.join('；')}（A 认可 / B 打回）`, since: day() })
    }
  }

  const risky = riskyPaths(changed)
  if (risky.length) {
    warnings.push(`⚠ 高风险区域改动：${risky.join(', ')}`)
    if (report.assumptions && report.assumptions !== '—') {
      addDecision(backlog, { task: task.id, question: '高风险区域内的自选方案需确认', options: `${report.assumptions}（A 认可 / B 打回重做）`, since: day() })
    }
  }

  if (problems.length) {
    const failures = 1 + Number((/自动失败×(\d+)/.exec(task.note || '') || [0, 0])[1])
    noteAppend(task, `自动失败×${failures}：${truncate(problems.join('；'), 200)}`)
    const status = failures >= 2 ? STATUS.BLOCKED : STATUS.TODO
    if (status === STATUS.BLOCKED) addBlocker(backlog, { desc: `任务 ${task.id} 连续验收失败 ${failures} 次`, task: task.id })
    await store.saveBacklog(backlog)
    await finish({ status, verdict: `验收失败：${truncate(problems.join('；'), 150)}`, tone: 'failed', action: 'retry_or_stop', brief: report.brief, noprogDelta: 1, extraText: `任务 ${task.id} 未通过机器验收：\n- ${problems.join('\n- ')}\n${warnings.length ? `告警：${warnings.join('；')}` : ''}` })
    return { ok: true, code: 'ACCEPTED', task: task.id, result, status, action: 'retry_or_stop', problems, warnings, test, weaken, brief: report.brief, report, text: `任务 ${task.id} 未通过验收：${problems.join('；')}` }
  }

  // All good.
  noteAppend(task, fileMode
    ? `自动交付（${day()}）：文件快照模式，改动 ${changed.length} 个文件；验收：${test.verdict}；假设：${report.assumptions || '—'}`
    : `自动交付（${day()}）：commits ${commits.map(c => c.sha.slice(0, 7)).join(' ')}；验收：${test.verdict}；假设：${report.assumptions || '—'}`)
  if (report.test_changes && report.test_changes !== '—') noteAppend(task, `测试改动：${truncate(report.test_changes, 120)}`)
  if (fileMode) noteAppend(task, `文件快照：${snapshotPath}`)
  const derived = addDerivedTasks(backlog, task, report.derived, config)
  const pendingDecision = backlog.decisions.some(d => d.task === task.id)
  task.status = STATUS.VERIFY
  await store.saveBacklog(backlog)
  await finish({ status: STATUS.VERIFY, verdict: `待验证（${test.verdict}）`, tone: 'success', action: 'await_user', brief: report.brief, doneDelta: 1, extraText: `任务 ${task.id} 已交付，待你验证。` })
  return {
    ok: true, code: 'ACCEPTED', task: task.id, result, status: STATUS.VERIFY, action: 'await_user',
    commits: commits.map(c => ({ sha: c.sha, subject: c.subject })), changed, mode: fileMode ? 'file' : 'git', warnings, test, weaken,
    derived: derived.added, derivedSkipped: derived.skipped,
    brief: report.brief, report,
    text: `任务 ${task.id} 通过机器验收 → 待验证。${warnings.length ? `\n告警：${warnings.join('；')}` : ''}${derived.added.length ? `\n衍生任务：${derived.added.map(t => t.id).join(', ')}` : ''}`,
  }
}
