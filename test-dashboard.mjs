#!/usr/bin/env node
/**
 * `node test-dashboard.mjs` — 面板快照的零依赖回归测试。
 *
 * 在临时目录里造一个最小任务池（复用 lib 的模板与 TaskStore），写死一份
 * CLAIM / DONE / CONFIRM / TIMEOUT_PASS / ROLLBACK / REJECT / DECIDED 的
 * run.log 与 current.json，然后调用 buildDashboard 断言指标、待验证卡片与
 * `—` 降级口径。不触碰真实 `.dsh/tasks/`。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TaskStore } from './lib/store.js'
import { STATUS } from './lib/markdown.js'
import { buildDashboard } from './lib/dashboard.js'

const NOW = Date.parse('2026-11-25T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const PROGRESS = `# 开发进度流水（Dev Progress）

**统计：** 已归档 3 项 · 打回 1 次

---

## 2026-11

### T-001 甲
**完成：** 2026-11-18 · **优先级：** P2 · **模块：** 测试
**结论：** ok
**关闭方式：** 需求方确认
**Commits：** abc1234

### T-002 乙
**完成：** 2026-11-20 · **优先级：** P1 · **模块：** 测试
**结论：** ok
**关闭方式：** 需求方确认（打回后重做）
**Commits：** def5678

### T-007 免验
**完成：** 2026-11-25 · **优先级：** P2 · **模块：** 测试
**结论：** 超时默认通过
**关闭方式：** 超时默认通过（7 天无人打回）
**Commits：** 0123abc
`

// 注意：TIMEOUT_PASS 与 DECIDED 用「空格 + 无 Z」的老式时间戳，断言它们按 UTC 解释。
const RUN_LOG = [
  '2026-11-18T09:00:00.000Z | T-001 | CLAIM | manual/git | start=abc | dirty=0',
  '2026-11-18T10:00:00.000Z | T-001 | DONE→待验证 | 机器验收 PASS',
  '2026-11-18T12:00:00.000Z | T-001 | CONFIRM | 已完成 | 需求方确认',
  '2026-11-19T09:00:00.000Z | T-002 | CLAIM | manual/git | start=def | dirty=0',
  '2026-11-19T09:30:00.000Z | T-002 | DONE→待验证 | 机器验收 PASS',
  '2026-11-19T10:00:00.000Z | T-002 | REJECT | 打回 | 验收不通过',
  '2026-11-19T10:00:05.000Z | T-002 | REJECTED | 打回 | 同一次打回的另一行',
  '2026-11-20T09:00:00.000Z | T-002 | DONE→待验证 | 重做后 PASS',
  '2026-11-20T11:00:00.000Z | T-002 | CONFIRM | 已完成 | 需求方确认',
  '2026-11-21T09:00:00.000Z | T-007 | DONE→待验证 | 超时流程',
  '2026-11-22T09:00:00.000Z | T-005 | NEEDS_DECISION→待决策 | 需要拍板',
  '2026-11-23T09:00:00.000Z | T-005 | ROLLBACK | refs/task-failed/T-005-1',
  '2026-11-23T15:00:00.000Z | T-009 | DONE→已完成（自动验收） | 只改测试',
  '2026-11-24 09:00:00 | T-005 | DECIDED | 选 A',
  '2026-11-25 09:00:00 | T-007 | TIMEOUT_PASS | 待验证 7 天 | 提交在当前分支',
].join('\n')

const TASKS = [
  {
    id: 'T-003', title: '待验证甲', module: '面板', status: STATUS.VERIFY, deps: '—', priority: 'P2',
    note: '验收：打开面板看到指标；待验证起：2026-11-10；怎么验：node test-dashboard.mjs → 打开面板看指标',
  },
  {
    id: 'T-004', title: '待验证乙（hold）', module: '面板', status: STATUS.VERIFY, deps: '—', priority: 'P2',
    note: '验收：不改测试也通过；待验证起：2026-11-18；怎么验：跑 node selftest.mjs；⚠ 测试有改动：test-dashboard.mjs',
  },
  {
    id: 'T-005', title: '进行中丙', module: '面板', status: STATUS.DOING, deps: '—', priority: 'P1',
    note: '验收：—',
  },
]

const CURRENT = {
  task: 'T-005',
  title: '进行中丙',
  nonce: 'abcd1234',
  phase: 'running',
  start_sha: 'abc1234',
  dirty: [],
  started: Date.parse('2026-11-25T11:00:00.000Z'),
  worker: 'worker-T-005',
  output: '',
  run_started: Date.parse('2026-11-25T10:00:00.000Z'),
  max: 8,
  hours: 2,
  done: 0,
  noprog: 0,
  mode: 'git',
  dispatch: 'auto',
  snapshot: '',
  snapshot_count: 0,
  snapshot_bytes: 0,
}

let passed = 0
let failed = 0

async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed++
    console.error(`FAIL  ${name}\n      ${error?.message ?? error}`)
  }
}

async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'dsh-task-dashboard-'))
}

async function makePool() {
  const root = await makeRoot()
  const store = new TaskStore(root, {})
  await store.init()
  const backlog = await store.readBacklog()
  backlog.tasks = TASKS.map(task => ({ ...task }))
  await store.saveBacklog(backlog)
  await writeFile(join(root, '.dsh/tasks/dev-progress.md'), PROGRESS)
  await writeFile(join(root, '.dsh/tasks/auto/run.log'), RUN_LOG)
  await store.writeCurrent(CURRENT)
  return { root, store }
}

const emptyRoot = await makeRoot()
const bareRoot = await makeRoot()
try {
  const { root: poolRoot } = await makePool()
  const state = await buildDashboard({ cwd: poolRoot, config: {}, sessionId: '', ctx: null, nowMs: NOW })
  const metrics = state.metrics

  await step('任务池已初始化且计数正确', () => {
    assert.equal(state.initialized, true)
    assert.equal(state.counts.doing, 1)
    assert.equal(state.counts.verify, 2)
    assert.equal(metrics.completed, 3)
    assert.equal(metrics.total, 6)
    assert.equal(metrics.completionRate, 0.5)
    assert.equal(metrics.text.completionRate, '50%')
  })

  await step('一次通过率排除自动验收 / 超时默认通过', () => {
    // 交付过 T-001/T-002/T-007/T-009；T-007/T-009 没人看过（免验关闭）被排除，
    // T-002 被打回过 → 2 个任务里通过 1 个。
    assert.equal(metrics.delivered, 4)
    assert.equal(metrics.firstPassRate, 0.5)
    assert.equal(metrics.text.firstPassRate, '50%')
    assert.equal(metrics.autoClosed, 2)
    assert.equal(metrics.text.autoClosed, '2')
  })

  await step('7 日吞吐与中位周期按 UTC 计算', () => {
    assert.equal(metrics.throughput7d, 4)
    assert.equal(metrics.text.throughput7d, '4')
    // CLAIM → CONFIRM：3h 与 26h，偶数个取上中位。
    assert.equal(metrics.medianCycleMs, 26 * HOUR)
    assert.equal(metrics.text.medianCycle, '1d 2h')
    assert.equal(metrics.cycleSource, 'claim-confirm')
  })

  await step('WIP / 待验证 / 人工介入 / 决策等待 / 回滚率', () => {
    assert.equal(metrics.wip, 1)
    assert.equal(metrics.verify, 2)
    // 近 7 天：一次打回（REJECT + REJECTED 合并）+ 一个进入待决策的 run。
    assert.equal(metrics.interventions, 2)
    assert.equal(metrics.text.interventions, '2')
    assert.equal(metrics.decisionWaitMs, 48 * HOUR)
    assert.equal(metrics.text.decisionWait, '2d 0h')
    assert.equal(metrics.rollbacks, 1)
    assert.equal(metrics.runs, 6)
    assert.ok(Math.abs(metrics.rollbackRate - 1 / 6) < 1e-12)
    assert.equal(metrics.text.rollbackRate, '17%')
    assert.equal(metrics.windowDays, 7)
  })

  await step('待验证卡片：怎么验 / 默认通过日 / 已等天数', () => {
    assert.equal(state.verifyCards.length, 2)
    const card = state.verifyCards[0]
    assert.equal(card.id, 'T-003')
    assert.equal(card.howToVerify, 'node test-dashboard.mjs → 打开面板看指标')
    assert.equal(card.steps.length, 2)
    assert.equal(card.howToVerifyMissing, false)
    assert.equal(card.verifySince, '2026-11-10')
    assert.equal(card.waitingDays, 15)
    assert.equal(card.due, '2026-11-17')
    assert.equal(card.defaultPass.enabled, true)
    assert.equal(card.defaultPassText, '默认通过：2026-11-17')
    assert.equal(card.hold, false)
    assert.equal(card.phase, 'due')
    assert.equal(card.acceptance, '打开面板看到指标')
  })

  await step('待验证卡片：hold 显示不默认通过及原因', () => {
    const card = state.verifyCards[1]
    assert.equal(card.id, 'T-004')
    assert.equal(card.waitingDays, 7)
    assert.equal(card.hold, true)
    assert.equal(card.phase, 'hold')
    assert.equal(card.defaultPass.enabled, false)
    assert.equal(card.defaultPassText, '不默认通过：测试有改动')
    assert.deepEqual(card.holdReasons, ['测试有改动：test-dashboard.mjs'])
  })

  await step('子代理行降级到 current.json 并标 source=current', () => {
    assert.equal(state.agentsSource, 'current')
    assert.equal(state.agents.length, 1)
    const row = state.agents[0]
    assert.equal(row.id, 'worker-T-005')
    assert.equal(row.kind, 'worker')
    assert.equal(row.source, 'current')
    assert.equal(row.activity, 'running')
    assert.equal(row.lastActivity.event, 'DECIDED')
    assert.match(row.lastActivity.at, /^2026-11-24/)
  })

  await step('live ctx 可用时优先用实时子代理', async () => {
    const fakeCtx = {
      get(name) {
        if (name === 'agents') return { get: id => (id === 'sess-1' ? { id: 'sess-1' } : undefined), roots: () => [] }
        if (name === 'subagents') {
          return {
            listDescendants: async () => [
              { id: 'child-1', label: 'worker-T-003', kind: 'child', activity: 'running', depth: 1, parentId: 'sess-1', mode: 'subagent' },
            ],
          }
        }
        return undefined
      },
    }
    const live = await buildDashboard({ cwd: poolRoot, config: {}, sessionId: 'sess-1', ctx: fakeCtx, nowMs: NOW })
    assert.equal(live.agentsSource, 'live')
    const child = live.agents.find(row => row.id === 'child-1')
    assert.ok(child)
    assert.equal(child.source, 'live')
    assert.equal(child.activity, 'running')
  })

  await step('没有 run.log 时全部降级为 —，不出现 NaN', async () => {
    const store = new TaskStore(emptyRoot, {})
    await store.init()
    const empty = await buildDashboard({ cwd: emptyRoot, config: {}, sessionId: '', ctx: null, nowMs: NOW })
    assert.equal(empty.initialized, true)
    assert.equal(empty.metrics.total, 0)
    assert.equal(empty.metrics.completionRate, null)
    assert.equal(empty.metrics.firstPassRate, null)
    assert.equal(empty.metrics.medianCycleMs, null)
    assert.equal(empty.metrics.decisionWaitMs, null)
    assert.equal(empty.metrics.rollbackRate, null)
    for (const key of ['completionRate', 'firstPassRate', 'medianCycle', 'interventions', 'decisionWait', 'rollbackRate']) {
      assert.equal(empty.metrics.text[key], '—')
    }
    assert.equal(empty.metrics.text.throughput7d, '0')
    assert.equal(empty.metrics.text.autoClosed, '0')
    assert.deepEqual(empty.verifyCards, [])
    assert.ok(!JSON.stringify(empty).includes('NaN'))
  })

  await step('未初始化的工作区返回 initialized=false', async () => {
    const bare = await buildDashboard({ cwd: bareRoot, config: {}, sessionId: '', ctx: null, nowMs: NOW })
    assert.equal(bare.initialized, false)
    assert.equal(bare.loop.status, 'uninitialized')
    assert.deepEqual(bare.metrics, {})
  })

  await step('整个快照里没有 NaN', () => {
    assert.ok(!JSON.stringify(state).includes('NaN'))
  })
} finally {
  await rm(emptyRoot, { recursive: true, force: true })
  await rm(bareRoot, { recursive: true, force: true })
}

console.log(`\ntest-dashboard: ${passed}/${passed + failed} PASS`)
if (failed) process.exitCode = 1
