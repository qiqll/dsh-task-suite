import { TaskStore, TaskError, normalizeConfig } from './store.js'
import {
  addTasks, addDecision, parseWorkerReport, taskById, buildTaskBrief, buildWorkerPrompt,
  claimTask, currentWork, buildStatusReport, countsOf, writePlan, nextTask, answerTask,
  confirmTask, rejectTask, addDerivedTasks, materialize,
} from './tasks.js'
import { STATUS, PRIORITIES } from './markdown.js'
import { acceptReport } from './accept.js'
import { mergeInbox, startLoop, loopTick, stopLoop, haltLoop, resumeHalted, requeueHalted, loopSummary } from './loop.js'
import { verifyTests, checkTestWeakening, commitsInRange, changedPaths, riskyPaths } from './verify.js'
import { day, epoch, formatDuration, gitText, truncate } from './util.js'
import { join } from 'node:path'
import { diffAgainstSnapshot } from './filesnapshot.js'

const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' }, data: { type: 'object' } },
    required: ['text'],
    additionalProperties: true,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

function tool(def) {
  return {
    output: TEXT_OUTPUT,
    timeoutMs: 120000,
    isConcurrencySafe: false,
    ...def,
  }
}

function ok(text, data) {
  return { text, data: data && JSON.parse(JSON.stringify(data)) }
}

export function createTools(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const rootOf = async exec => {
    try {
      const dir = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      if (dir) return dir
    } catch {}
    return process.cwd()
  }
  const storeOf = async exec => new TaskStore(await rootOf(exec), config)

  const tools = [
    tool({
      name: 'task_init',
      description: '初始化任务待办池（.dsh/tasks/backlog.md、dev-plan.md、dev-progress.md、inbox/、auto/）。已存在的文件不动，运行时状态加入 .gitignore。之后用 task_add 录需求、task_pick 认领、skill task-loop 自动循环。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, exec) {
        const store = await storeOf(exec)
        const res = await store.init()
        return ok(`任务池已就绪：${res.dir}\n创建：${res.created.join(', ') || '无'}\n跳过：${res.skipped.join(', ') || '无'}\n\n下一步：task_add 录入需求（或 skill task-admin）。`, res)
      },
    }),

    tool({
      name: 'task_add',
      description: '把需求录入待办池：自动分配 T-NNN、判优先级、识别依赖、写验收标准；只录入不实施。可一次录多条。若与已有任务语义重复，会并入已有条目备注而不是新建。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '任务列表；每条可独立提交、独立验证。',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '动宾结构的一句话，说清改什么、达到什么效果。' },
                module: { type: 'string', description: '模块名；沿用待办池已有模块名。' },
                priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: '按后果定级，不按语气。' },
                acceptance: { type: 'string', description: '可用命令或操作判定的完成标准（验收）。' },
                acceptanceAi: { type: 'boolean', description: '验收标准是否由 AI 拟定。' },
                deps: { type: 'string', description: '依赖的任务 ID（T-0NN）或人工事项（H-0NN），多个用逗号分隔。' },
                parent: { type: 'string', description: '父任务 ID（用于衍生任务分层）。' },
                note: { type: 'string', description: '原始诉求要点、相关文件路径或补充说明。' },
                status: { type: 'string', description: '默认 待开始；前置未满足可填 阻塞。' },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
          source: { type: 'string', description: '来源说明（可选）。' },
        },
        required: ['items'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const store = await storeOf(exec)
        const data = await store.load()
        const backlog = data.backlog
        const res = addTasks(backlog, args.items ?? [], { source: args.source })
        await store.saveBacklog(backlog)
        await writePlan(store, backlog, data.archived, await currentWork(store))
        const counts = countsOf(backlog).counts
        const lines = []
        if (res.added.length) lines.push(`已录入 ${res.added.length} 条：`)
        for (const t of res.added) lines.push(`- ${t.id} [${t.priority}/${t.module}] ${t.title}${/依赖/.test(t.deps) ? '' : ''}${t.deps !== '—' ? `（依赖 ${t.deps}）` : ''}`)
        for (const d of res.duplicates) lines.push(`- 重复：${d.title} → 并入 ${d.id} 的备注`)
        for (const s of res.skipped) lines.push(`- 跳过：${s.title || '（空）'}（${s.reason}）`)
        lines.push('')
        lines.push(`待办池：P0×${counts.P0} P1×${counts.P1} P2×${counts.P2} P3×${counts.P3}`)
        return ok(lines.join('\n'), { added: res.added, duplicates: res.duplicates, skipped: res.skipped, counts })
      },
    }),

    tool({
      name: 'task_status',
      description: '任务池全局视图：进行中/待验证/待决策/阻塞计数、需你拍板的问题（最优先）、过期阻塞提示、inbox 待合并数、运行流水、下一步建议。只读。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      isConcurrencySafe: true,
      async execute(_args, exec) {
        const store = await storeOf(exec)
        const data = await store.load()
        const inbox = await store.readInbox()
        const current = await currentWork(store)
        const session = data.session
        const logTail = await store.logTail(8)
        const text = buildStatusReport({ ...data, current, session }, { inboxCount: inbox.length, logTail, plan: store.rel(store.planPath) })
        return ok(text, { counts: data.counts, current, decisions: data.backlog.decisions, inbox: inbox.length, session })
      },
    }),

    tool({
      name: 'task_list',
      description: '按优先级/状态筛选任务，列出 ID、状态、模块、依赖、标题。只读。',
      parameters: {
        type: 'object',
        properties: {
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          status: { type: 'string', description: '精确状态名，如 待开始 / 进行中 / 待验证 / 阻塞 / 待决策 / 打回。' },
          query: { type: 'string', description: '标题/备注关键词。' },
        },
        additionalProperties: false,
      },
      isConcurrencySafe: true,
      async execute(args, exec) {
        const store = await storeOf(exec)
        const data = await store.load()
        let tasks = data.backlog.tasks
        if (args.priority) tasks = tasks.filter(t => t.priority === args.priority)
        if (args.status) tasks = tasks.filter(t => t.status === args.status)
        if (args.query) {
          const q = String(args.query).toLowerCase()
          tasks = tasks.filter(t => `${t.title} ${t.note}`.toLowerCase().includes(q))
        }
        if (!tasks.length) return ok('没有匹配的任务。', { tasks: [] })
        const lines = ['| ID | 优先级 | 状态 | 模块 | 任务 | 依赖 |', '|----|-------|------|------|------|------|']
        for (const t of tasks) lines.push(`| ${t.id} | ${t.priority} | ${t.status} | ${t.module} | ${t.title.replace(/\|/g, '\\|')} | ${t.deps} |`)
        return ok(lines.join('\n'), { tasks })
      },
    }),

    tool({
      name: 'task_show',
      description: '查看单个任务的完整简报：验收标准、备注、依赖、待决策问题、衍生来源。worker 开工前用它定向。只读。',
      parameters: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'], additionalProperties: false },
      isConcurrencySafe: true,
      async execute(args, exec) {
        const store = await storeOf(exec)
        const data = await store.load()
        const task = taskById(data.backlog, args.task_id)
        if (!task) throw new Error(`找不到任务 ${args.task_id}`)
        return ok(buildTaskBrief(task, data.backlog), { task })
      },
    }),

    tool({
      name: 'task_pick',
      description: '认领下一个任务（可指定 ID）。auto 模式会写 current.json、捕获 START_SHA/脏文件/nonce 并返回 worker_prompt，供你用 subagent 后台派发；manual 模式只返回任务简报，由你自己实施。同时在 dev-plan 登记开工。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '指定任务 ID；留空按 P0→P1→P2→P3 与依赖顺位挑。' },
          mode: { type: 'string', enum: ['auto', 'manual'], description: 'auto=派后台 worker（默认）；manual=主 agent 自己做。' },
          interrupt: { type: 'boolean', description: 'P0 插入：把当前进行中任务标 halted（不回滚）后再认领。' },
        },
        additionalProperties: false,
      },
      async execute(args, exec) {
        const store = await storeOf(exec)
        const mode = args.mode === 'manual' ? 'manual' : 'auto'
        const current = await store.readCurrent()
        if (current && !args.interrupt) {
          return ok(`当前有任务在跑：${current.task}（${current.phase}）。等它交付并验收后再挑下一个；P0 插队请传 interrupt=true。`, { blocked: true, current })
        }
        if (current && args.interrupt) {
          await store.writeCurrent({ ...current, phase: 'halted', halt_note: 'P0 插队，被新任务中断' })
          await store.log(`${current.task} | HALTED | P0 interrupt`)
        }
        const data = await store.load()
        const backlog = data.backlog
        let task
        if (args.task_id) {
          task = taskById(backlog, args.task_id)
          if (!task) throw new Error(`找不到任务 ${args.task_id}`)
          if (![STATUS.TODO, STATUS.REWORK].includes(task.status)) throw new Error(`任务 ${task.id} 当前状态是「${task.status}」，不能认领。先解除阻塞/答复决策。`)
        } else {
          task = nextTask(backlog, data.archived).task
          if (!task) return ok('没有可派发的任务（全部待决策/阻塞/待验证，或待办池为空）。不要自己发明需求。', { idle: true })
        }
        const dirty = await (await import('./verify.js')).dirtyPaths(store.root)
        const retryMatch = /打回（[^）]*）：(.+)$/.exec(task.note || '')
        const claimed = await claimTask({ store, backlog, task, mode, dirtyPaths: dirty, retryNote: retryMatch ? `上次被打回：${retryMatch[1]}` : '' })
        const baseline = claimed.mode === 'file'
          ? `- 基线模式：文件快照（非 git）\n- 快照：${claimed.current.snapshot}（${claimed.current.snapshot_count} 个文件）`
          : `- START_SHA：${claimed.startSha.slice(0, 10)}`
        const head = `## ${task.id} ${task.title}\n\n- 优先级：${task.priority} · 模块：${task.module} · 状态：进行中\n- 验收：${/验收：([^；]+)/.exec(task.note || '')?.[1] || '（未提供）'}\n${baseline}\n- 报告口令：${claimed.nonce}\n- 开工脏文件：${dirty.join(', ') || '无'}\n`
        if (mode === 'auto') {
          return ok(`${head}\n### 后台派发\n调用 \`subagent\` 工具，prompt 原样传下面内容，description 用「${task.id} worker」：\n\n\`\`\`text\n${claimed.prompt}\n\`\`\`\n\n派发后结束本回合，等完成通知；收到报告后调用 task_accept。`, { mode, task, current: claimed.current, worker_prompt: claimed.prompt, start_sha: claimed.startSha, nonce: claimed.nonce })
        }
        return ok(`${head}\n### 手动实施\n加载 skill \`task-worker\`，按它实施；完成后用同样的报告块调用 \`task_accept\`。\n\n${claimed.brief}`, { mode, task, current: claimed.current, start_sha: claimed.startSha, nonce: claimed.nonce })
      },
    }),

    tool({
      name: 'task_accept',
      description: '验收 worker 交付的报告：核对 nonce、提交归属、越界/遗留文件、机器重跑 TEST_CMD（基线 worktree 比对）、测试改弱审计、高风险路径；通过则到「待验证」，否则待决策/阻塞/打回，并录入衍生任务。rollback=true 时失败可回滚（先存 refs/task-failed/*）。',
      parameters: {
        type: 'object',
        properties: {
          report: { type: 'string', description: 'worker 最后一条消息中的完整报告块（=== TASK-AUTO REPORT === … === END REPORT ===）。' },
          rollback: { type: 'boolean', description: '失败时是否回滚到 START_SHA（默认 false，先存 ref）。' },
          review: { type: 'string', description: '调度员复审结论：仅 GATE_PENDING_REVIEW 时用。以 pass/通过/ok 开头表示复审通过，直接继续验收；否则内容作为打回给 worker 的修改意见，不改状态。' },
          timeout_sec: { type: 'number', description: '测试命令超时，默认取插件配置 900 秒。' },
        },
        required: ['report'],
        additionalProperties: false,
      },
      timeoutMs: 25 * 60 * 1000,
      async execute(args, exec) {
        const store = await storeOf(exec)
        const res = await acceptReport({ store, reportText: args.report, rollback: !!args.rollback, review: args.review, timeoutSec: args.timeout_sec, config })
        const hint = res.code === 'REVIEW_PENDING'
          ? '\n\n请调度员自行审查该提交范围；通过后调用 task_accept 同一报告并传 review="pass: ..."；有发现则发回 worker 修复后重交。'
          : res.code === 'REVIEW_FIX'
            ? '\n\n把上面的发现用 send_message 发回 worker，让其修复并重新交付报告；本次不改任务状态。'
            : res.action ? `\n\n调度动作：${actionHint(res.action)}` : ''
        return ok(res.text + hint + `\n\n下一步：调用 \`task_loop action=tick\` 继续循环，或按 action 与需求方交互。`, res)
      },
    }),

    tool({
      name: 'task_confirm',
      description: '需求方确认任务可用后归档到 dev-progress.md（从 backlog 删除），并清理 current。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          conclusion: { type: 'string', description: '一句话结论：做了什么、现在能用了吗。' },
          gate: { type: 'string', description: '门禁结果摘要。' },
        },
        required: ['task_id'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const store = await storeOf(exec)
        const data = await store.load()
        const task = taskById(data.backlog, args.task_id)
        if (!task) throw new Error(`找不到任务 ${args.task_id}`)
        const entry = await confirmTask(store, data.backlog, task, { conclusion: args.conclusion, gate: args.gate })
        await writePlan(store, data.backlog, await store.archivedIds(), null)
        return ok(`已归档 ${task.id} 到 dev-progress.md。`, { entry })
      },
    }),

    tool({
      name: 'task_reject',
      description: '需求方验证不通过：任务状态改「打回」，记录问题，重新排队；同时清理 current。',
      parameters: {
        type: 'object',
        properties: { task_id: { type: 'string' }, reason: { type: 'string', description: '具体哪里不对、期望是什么。' } },
        required: ['task_id', 'reason'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const store = await storeOf(exec)
        const data = await store.load()
        const task = taskById(data.backlog, args.task_id)
        if (!task) throw new Error(`找不到任务 ${args.task_id}`)
        await rejectTask(store, data.backlog, task, args.reason)
        await writePlan(store, data.backlog, await store.archivedIds(), null)
        return ok(`已打回 ${task.id}，重新排队。下次派发会带上打回意见。`, { task })
      },
    }),

    tool({
      name: 'task_answer',
      description: '答复待决策任务：把答复写进备注并回到待开始；若任务在待验证，答复为通过/OK 类则归档，打回类则重新排队。',
      parameters: {
        type: 'object',
        properties: { task_id: { type: 'string' }, answer: { type: 'string', description: '选项或决策原文；打回时写清问题。' } },
        required: ['task_id', 'answer'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const store = await storeOf(exec)
        const data = await store.load()
        const task = taskById(data.backlog, args.task_id)
        if (!task) throw new Error(`找不到任务 ${args.task_id}`)
        const PASS = /^(通过|ok|OK|好的|没问题|确认|可以|PASS|pass)\b|^选\s*A|^A（推荐）/
        if (task.status === STATUS.VERIFY) {
          if (PASS.test(args.answer.trim())) {
            await confirmTask(store, data.backlog, task, { conclusion: `需求方确认：${args.answer}`, gate: '需求方确认' })
            await writePlan(store, data.backlog, await store.archivedIds(), null)
            return ok(`已确认并归档 ${task.id}。`, { action: 'confirm' })
          }
          await rejectTask(store, data.backlog, task, args.answer)
          return ok(`已打回 ${task.id}，重新排队。`, { action: 'reject' })
        }
        await answerTask(store, data.backlog, args.task_id, args.answer)
        await writePlan(store, data.backlog, await store.archivedIds(), null)
        return ok(`已记录 ${task.id} 的答复；任务回到待开始。`, { action: 'answer' })
      },
    }),

    tool({
      name: 'task_inbox',
      description: '向任务池投递新需求或决策答复（worker 在跑时用；下次 tick 或 merge 时单点合并，避免与 worker 的提交交错）。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['task', 'decision'], description: 'task=新需求；decision=对某任务的答复。' },
          text: { type: 'string', description: '需求描述 / 决策原文。' },
          ref: { type: 'string', description: 'decision 时必填：任务 ID。' },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          module: { type: 'string' },
          acceptance: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const store = await storeOf(exec)
        if (args.type === 'decision' && !args.ref) throw new Error('decision 投递必须给 ref（任务 ID）')
        const res = await store.writeInbox({ type: args.type || 'task', ref: args.ref, priority: args.priority, module: args.module, acceptance: args.acceptance, title: args.title, body: args.text })
        return ok(`已投递到 ${store.rel(res.path)}；下次 tick/merge 会合并。`, res)
      },
    }),

    tool({
      name: 'task_merge',
      description: '立即合并 inbox 投递：task 录入待办池，decision 写回任务（待验证通过则归档、打回则重排队）。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, exec) {
        const store = await storeOf(exec)
        const res = await mergeInbox({ store, config })
        const lines = []
        lines.push(`合并 ${res.merged.length} 个投递：`)
        for (const t of res.tasks) lines.push(`- 录入 ${t.id} [${t.priority}/${t.module}] ${t.title}`)
        for (const d of res.decisions) lines.push(`- ${d.task}：${d.action}${d.answer ? `（${truncate(d.answer, 80)}）` : ''}`)
        for (const e of res.errors) lines.push(`- 错误：${e}`)
        return ok(lines.join('\n'), res)
      },
    }),

    tool({
      name: 'task_loop',
      description: '自动循环状态机。start=重置会话并清 STOP；tick=合并 inbox→停机检查→挑任务→认领并返回派发指令（无活则 idle）；stop=写 STOP 并收尾；halt=立刻叫停当前 worker（保留提交，不回滚）；resume=从 halted 断点重新派发同一任务；requeue=把 halted 任务放回待开始；status=只读状态。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'tick', 'stop', 'halt', 'resume', 'requeue', 'status'] },
          max: { type: 'number', description: 'start：本次最多交付任务数（默认 10）。' },
          hours: { type: 'number', description: 'start：本次最长时长（默认 8）。' },
          reason: { type: 'string', description: 'stop 的原因说明。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const store = await storeOf(exec)
        const action = args.action
        if (action === 'start') {
          const res = await startLoop({ store, config, max: args.max, hours: args.hours })
          const where = res.branch ? `分支 ${res.branch}` : '文件快照模式（非 git）'
          return ok(`自动循环已启动：max=${res.session.max} hours=${res.session.hours}，${where}${res.onMain ? '\n⚠ 当前在主分支，自动循环可能污染主干。建议先切到工作分支。' : ''}${res.current ? `\n⚠ 仍有未收尾任务 ${res.current.task}（phase=${res.current.phase}），先处理它。` : ''}\n\n下一步：调用 \`task_loop action=tick\`。`, res)
        }
        if (action === 'tick') {
          const res = await loopTick({ store, config })
          if (res.action === 'dispatch') {
            const dispatch = `\n\n### 后台 worker prompt（原样作为 subagent 的 prompt）\n\n\`\`\`text\n${res.worker_prompt}\n\`\`\`\n\n派发后结束本回合，等 worker 完成通知；收到报告后调用 task_accept。`
            return ok(res.text + dispatch, res)
          }
          return ok(res.text, res)
        }
        if (action === 'stop') {
          const res = await stopLoop({ store, reason: args.reason || 'user' })
          const data = await store.load()
          return ok(`${res.logTail?.at(-1) || '已停机。'}\n\n${loopSummary({ store, data })}`, { ...res, data })
        }
        if (action === 'halt') {
          const res = await haltLoop({ store })
          return ok(res.text, res)
        }
        if (action === 'resume' || action === 'requeue') {
          const res = action === 'resume' ? await resumeHalted({ store, config }) : await requeueHalted({ store })
          if (action === 'resume') {
            const dispatch = `\n\n### 后台 worker prompt（原样作为 subagent 的 prompt）\n\n\`\`\`text\n${res.worker_prompt}\n\`\`\`\n\n派发后结束本回合，等 worker 完成通知；收到报告后调用 task_accept。`
            return ok(res.text + dispatch, res)
          }
          return ok(res.text, res)
        }
        const data = await store.load()
        const current = await currentWork(store)
        const text = buildStatusReport({ ...data, current }, { logTail: await store.logTail(8) })
        return ok(text, { current, session: data.session })
      },
    }),

    tool({
      name: 'task_verify',
      description: '机器验收测试命令：校验命令合规（不得缩小范围/吞退出码/漏测改动的测试文件），在基线 worktree 重跑并比对失败用例；同时审计测试是否被改弱。只读。',
      parameters: {
        type: 'object',
        properties: {
          test_cmd: { type: 'string', description: '形如 [cd dir &&] <单条测试命令> <路径…>。' },
          start_sha: { type: 'string', description: '基线提交；缺省用当前任务的 START_SHA。非 git 任务忽略此参数，自动用当前任务的快照。' },
          timeout_sec: { type: 'number' },
        },
        required: ['test_cmd'],
        additionalProperties: false,
      },
      timeoutMs: 20 * 60 * 1000,
      isConcurrencySafe: false,
      async execute(args, exec) {
        const store = await storeOf(exec)
        const current = await store.readCurrent()
        const fileMode = current?.mode === 'file' && !!current.snapshot
        const startSha = args.start_sha || current?.start_sha
        if (!startSha) throw new Error('缺少 start_sha（当前也没有进行中的任务）。')
        const snapshot = fileMode ? current.snapshot : undefined
        const test = await verifyTests({
          root: store.root, startSha, testCmd: args.test_cmd, timeoutSec: args.timeout_sec || config.testTimeoutSec,
          mode: fileMode ? 'file' : 'git', snapshot,
          stateRel: store.rel(store.dir), ignore: store.config.snapshotIgnore,
        })
        const weaken = await checkTestWeakening({
          root: store.root, startSha, mode: fileMode ? 'file' : 'git', snapshot,
          stateRel: store.rel(store.dir), ignore: store.config.snapshotIgnore,
        })
        const lines = [`VERDICT: ${test.verdict}`]
        if (test.reason) lines.push(`原因：${test.reason}`)
        if (test.failures?.length) lines.push(`失败用例：${test.failures.join(', ')}`)
        if (test.preexisting?.length) lines.push(`基线既有失败：${test.preexisting.join(', ')}`)
        if (test.tail) lines.push('', '测试输出尾部：', '```', test.tail, '```')
        lines.push(`测试改弱审计：${weaken.verdict}${weaken.warnings.length ? '\n- ' + weaken.warnings.join('\n- ') : ''}`)
        return ok(lines.join('\n'), { test, weaken })
      },
    }),

    tool({
      name: 'task_audit',
      description: '只读审计某区间的提交与改动：提交归属、改动文件、高风险路径、遗留脏文件、测试改弱。用于验收前的独立核查。',
      parameters: {
        type: 'object',
        properties: {
          start_sha: { type: 'string', description: 'git 任务的基线提交；非 git 任务可省略。' },
          task_id: { type: 'string', description: '若给出，检查每个提交 message 是否含该任务 ID。' },
        },
        required: [],
        additionalProperties: false,
      },
      isConcurrencySafe: true,
      async execute(args, exec) {
        const store = await storeOf(exec)
        const current = await store.readCurrent()
        if (current?.mode === 'file' && current.snapshot) {
          const snapshot = current.snapshot
          const diff = await diffAgainstSnapshot({ root: store.root, snapshot, stateRel: store.rel(store.dir), ignore: store.config.snapshotIgnore })
          const risky = riskyPaths(diff.changed)
          const weaken = await checkTestWeakening({ root: store.root, mode: 'file', snapshot, stateRel: store.rel(store.dir), ignore: store.config.snapshotIgnore })
          const lines = [`文件快照模式：${current.task}（快照 ${current.snapshot}）`, `改动 ${diff.count} 个文件：新增 ${diff.added.length} / 修改 ${diff.modified.length} / 删除 ${diff.deleted.length}`]
          for (const f of diff.changed.slice(0, 60)) lines.push(`- ${f}`)
          if (risky.length) lines.push('', `⚠ 高风险区域：${risky.join(', ')}`)
          lines.push('', `测试改弱审计：${weaken.verdict}${weaken.warnings.length ? '\n- ' + weaken.warnings.join('\n- ') : ''}`)
          lines.push('', '说明：非 git 模式没有 commit 归属可审计；归属以开工快照与当前工作区的文件差异为准。')
          return ok(lines.join('\n'), { mode: 'file', changed: diff.changed, risky, weaken, diff })
        }
        if (!args.start_sha) throw new Error('缺少 start_sha（当前也没有进行中的 git 任务）。')
        const commits = await commitsInRange(store.root, args.start_sha)
        const changed = await changedPaths(store.root, args.start_sha)
        const risky = riskyPaths(changed)
        const weaken = await checkTestWeakening({ root: store.root, startSha: args.start_sha })
        const branch = await gitText(store.root, ['branch', '--show-current'])
        const lines = [`区间：${args.start_sha.slice(0, 8)}..HEAD（分支 ${branch || 'detached'}）`, `提交 ${commits.length} 个：`]
        for (const c of commits) lines.push(`- ${c.sha.slice(0, 8)} ${c.subject}`)
        if (args.task_id) {
          const bad = commits.filter(c => !c.subject.includes(args.task_id))
          if (bad.length) lines.push(`⚠ 不属于 ${args.task_id} 的提交：${bad.map(c => c.sha.slice(0, 8)).join(', ')}`)
        }
        lines.push('', `改动 ${changed.length} 个文件：`)
        for (const f of changed.slice(0, 60)) lines.push(`- ${f}`)
        if (risky.length) lines.push('', `⚠ 高风险区域：${risky.join(', ')}`)
        lines.push('', `测试改弱审计：${weaken.verdict}${weaken.warnings.length ? '\n- ' + weaken.warnings.join('\n- ') : ''}`)
        return ok(lines.join('\n'), { commits, changed, risky, weaken })
      },
    }),
  ]
  return tools
}

function actionHint(action) {
  switch (action) {
    case 'review': return '调度员代为审查，把发现发回同一 worker（同一 nonce）。'
    case 'fix_test_cmd': return '把 TEST_CMD 不合规意见发回同一 worker，重给合规命令。'
    case 'ask_user': return '把问题与选项直接贴给需求方，等 task_answer / inbox decision。'
    case 'report_blocker': return '把阻塞原因与人工事项编号报给需求方，然后 tick 继续别的任务。'
    case 'retry_or_stop': return '失败已记录；可重派同一任务（会带失败原因），或停机等人工。'
    case 'await_user': return '把简报给需求方，等确认（task_confirm）或打回（task_reject）。'
    case 'halt': return '工作区独占被打破，停止派发，等人工处理。'
    default: return '按任务池状态与需求方交互。'
  }
}
