import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from './lib/tools.js'
import { buildDashboard, resolveDashboardCwd } from './lib/dashboard.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(HERE, 'skills')

const SKILL_DESCRIPTORS = [
  {
    name: 'task-loop',
    file: 'task-loop.md',
    description: '自动任务循环调度员：主会话只做调度（合并 inbox → 挑任务 → 后台 worker → 机器验收 → 回写 backlog → 派下一个），直到池空或触发停机条件。需求方随时可插话或投递。',
    whenToUse: '需求方说「自动跑 / 挂机 / 连续消化 / 开启自动模式 / 继续循环」，或要求无人值守地按待办池连续交付时。',
  },
  {
    name: 'task-worker',
    file: 'task-worker.md',
    description: '任务系统的后台 worker 契约：在全新上下文里完整交付一个指派任务（定向 → 风险判定 → 实施 → 门禁 → 提交/快照 → 结构化报告）；git 任务 commit，非 git 任务直接改文件。不碰任务池状态。',
    whenToUse: '被 task-loop / task_pick 指派为后台 worker，或手动模式认领任务后实施时。',
  },
  {
    name: 'task-admin',
    file: 'task-admin.md',
    description: '任务池手动管理：初始化、录入（查重/拆分/优先级/验收）、单步挑任务、交付验收、需求方确认/打回、inbox 投递与合并。',
    whenToUse: '需求方描述待办需求、要求录入任务、询问进度、确认或打回某个任务、手动单步开发时。',
  },
]

const PROMPT_SECTION = `## 任务系统（Task Suite）

本工作区可维护 \`.dsh/tasks/\` 任务池（backlog / dev-plan / dev-progress / inbox / auto）。工具：\`task_init\` \`task_add\` \`task_status\` \`task_list\` \`task_show\` \`task_pick\` \`task_accept\` \`task_confirm\` \`task_reject\` \`task_answer\` \`task_inbox\` \`task_merge\` \`task_verify\` \`task_audit\` \`task_loop\`。

- 需求方描述需求但不要立刻做 → \`task_add\` 录入（先看 \`task_status\` 查重；待办池为空也可以先 \`task_init\`）。
- 需求方说「自动跑 / 挂机 / 连续消化 / 继续」 → 加载 skill \`task-loop\`，主会话只调度，用 \`subagent\` 派后台 worker。
- 手动一单一单做 / 确认或打回 → 加载 skill \`task-admin\`。
- 问「进度 / 还有什么没做」 → \`task_status\`。
- 不要把任务池运行状态当业务代码提交：\`.dsh/tasks/auto/\` 与 inbox 是运行时状态（\`task_init\` 会加入 .gitignore）。
- 待办池空了就报空，**不要自己发明需求**；「待验证」的关闭方式（需求方确认 / 自动验收 / 超时默认通过）都记在 dev-progress.md，打回已归档任务会重开。`

export const name = 'dsh-task-suite'
export const inject = ['tools', 'skills', 'systemPrompt', 'workingDirectory']

function registerDashboard(ctx, config) {
  ctx.effect(() => ctx.inject(['webServer'], (injected) => {
    const webServer = injected.get('webServer')
    if (!webServer?.register) return
    const handler = async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost')
      const send = (status, body) => {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'GET') return send(405, { ok: false, error: 'method not allowed' })
      try {
        const sessionId = url.searchParams.get('sessionId') || ''
        const requestedCwd = url.searchParams.get('cwd') || ''
        const cwd = await resolveDashboardCwd(ctx, sessionId, requestedCwd, config)
        const state = await buildDashboard({ cwd, config, sessionId, ctx })
        send(200, { ok: true, ...state })
      } catch (error) {
        send(500, { ok: false, error: String(error?.message ?? error) })
      }
    }
    return webServer.register({
      kind: 'exact',
      path: '/dsh-task-suite/state',
      handler,
    })
  }), 'dsh-task-suite: dashboard route')
}

export function apply(ctx, config) {
  for (const definition of createTools(ctx, config)) {
    ctx.effect(() => ctx.tools.register(definition), `dsh-task-suite: tool ${definition.name}`)
  }

  for (const descriptor of SKILL_DESCRIPTORS) {
    const content = readFileSync(join(SKILLS_DIR, descriptor.file), 'utf8')
    const path = join(SKILLS_DIR, descriptor.file)
    ctx.effect(() => ctx.skills.register({
      name: descriptor.name,
      description: descriptor.description,
      whenToUse: descriptor.whenToUse,
      content,
      source: 'custom',
      path,
      resourceBase: { kind: 'directory', path: SKILLS_DIR },
      invocation: { modelInvocable: true, userInvocable: true },
    }), `dsh-task-suite: skill ${descriptor.name}`)
  }

  let sectionOrder = 2801
  try { sectionOrder = ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT') + 1 } catch {}
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'task-suite',
    order: sectionOrder,
    text: PROMPT_SECTION,
    interpolate: false,
  }), 'dsh-task-suite: prompt section')

  registerDashboard(ctx, config)
}
