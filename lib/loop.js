import { STATUS, PRIORITIES, PRIORITY_TITLES } from './markdown.js'
import {
  taskById, addTasks, nextTask, claimTask, writePlan, countsOf,
  answerTask, confirmTask, rejectTask,
} from './tasks.js'
import { day, epoch, formatDuration, gitText, truncate } from './util.js'
import { dirtyPaths } from './verify.js'
import { diffAgainstSnapshot } from './filesnapshot.js'

const DECISION_RE = /^(通过|ok|OK|好的|没问题|确认|可以|PASS|pass)\b|^选\s*A|^A（推荐）/

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
        if (!task) { result.errors.push(`${entry.file}: 找不到任务 ${ref}`); continue }
        if (task.status === STATUS.VERIFY) {
          if (DECISION_RE.test(answer)) {
            await confirmTask(store, backlog, task, { conclusion: `需求方确认（${day()}）：${answer}` })
            result.decisions.push({ task: ref, action: 'confirm', answer })
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

  const current = await store.readCurrent()
  if (current) {
    if (current.phase === 'accepted') {
      await store.clearCurrent()
    } else if (current.phase === 'halted') {
      return { action: 'halted', current, text: `任务 ${current.task} 被叫停，phase=halted。向需求方复述断点（${current.halt_note || '未记录'}），问是继续还是放回队列。不回滚。`, merge }
    } else if (current.phase === 'running' || current.phase === 'review_pending' || current.phase === 'accepting') {
      const stale = epoch() - (current.started || epoch()) > 3 * 60 * 60 * 1000
      return {
        action: stale ? 'stale' : 'waiting',
        current,
        stale,
        text: stale
          ? `worker ${current.worker} 开工已超过 3 小时（${formatDuration(epoch() - current.started)}）。用 interrupt_agent 停掉它，然后按 task-worker 的失败路径提交/处理 FAILED（报告口令 ${current.nonce}）。`
          : `任务 ${current.task} 正由 ${current.worker} 处理（phase=${current.phase}，已 ${formatDuration(epoch() - current.started)}）。等完成通知，不要并行开工。`,
        merge,
      }
    }
  }

  const data = await store.load()
  const backlog = data.backlog
  const pick = nextTask(backlog, data.archived)
  if (!pick.task) {
    return {
      action: 'idle',
      text: `没有可派发的任务。待决策 ${backlog.decisions.length} 条，阻塞 ${backlog.tasks.filter(t => t.status === STATUS.BLOCKED).length} 条，待验证 ${backlog.tasks.filter(t => t.status === STATUS.VERIFY).length} 条。`,
      counts: countsOf(backlog).counts,
      decisions: backlog.decisions,
      blocked: pick.blocked.slice(0, 8).map(b => ({ task: b.task.id, reason: b.reason })),
      merge,
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
  return {
    action: 'dispatch',
    task: { id: task.id, title: task.title, priority: task.priority, module: task.module, acceptance: /验收：([^；]+)/.exec(task.note || '')?.[1] || '' },
    worker_prompt: claimed.prompt,
    current: claimed.current,
    branch: await gitText(store.root, ['branch', '--show-current']),
    onMain: /^(master|main)$/.test(await gitText(store.root, ['branch', '--show-current'])),
    merge,
    text: `已认领 ${task.id}（${task.priority}·${task.module}）。调用 subagent 工具，把 worker_prompt 原样作为 prompt 派发（后台运行），然后结束本回合等通知。`,
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
  return { session: await store.readSession(), logTail: await store.logTail(10) }
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
    return { current: { ...current, phase: 'halted' }, haltNote, text: `已叫停 ${current.task}。未回滚，改动保留。断点：\n${haltNote}` }
  }
  await store.log('HALT | 无进行中任务')
  return { current: null, text: '已停机（没有进行中任务）。' }
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
