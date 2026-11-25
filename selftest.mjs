import { mkdtemp, writeFile, mkdir, readFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'
import { access } from 'node:fs/promises'
import { runProcess, gitText, shellQuote } from './lib/util.js'
import { TaskStore } from './lib/store.js'
import { addTasks, nextTask, claimTask, buildStatusReport, confirmTask } from './lib/tasks.js'
import { acceptReport } from './lib/accept.js'
import { verifyTests, checkTestWeakening } from './lib/verify.js'
import { mergeInbox, startLoop, loopTick, stopLoop, haltLoop, resumeHalted, requeueHalted, inspectWatchdog, checkWatchdog } from './lib/loop.js'
import { currentWork } from './lib/tasks.js'
import { checkVerifyTimeout, describeVerifyRows, stampVerifyEntry, normalizeVerifySteps, timeoutDaysOf, verifyState } from './lib/verifyflow.js'
import { createTools } from './lib/tools.js'
import { notifyTask, composeNotifyMessage, notifySettings } from './lib/notify.js'

async function pathExists(p) { try { await access(p); return true } catch { return false } }

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

function reportBlock(fields) {
  const lines = ['=== TASK-AUTO REPORT ===']
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) lines.push(`- ${item}`)
      continue
    }
    lines.push(`${key}: ${value}`)
  }
  lines.push('=== END REPORT ===')
  return lines.join('\n')
}

async function sh(cwd, line) {
  return runProcess('bash', ['-c', line], { cwd, timeoutMs: 60000 })
}

async function commit(cwd, msg) {
  await sh(cwd, 'git add -A && git -c user.name=t -c user.email=t@t commit -q -m ' + JSON.stringify(msg))
  return (await gitText(cwd, ['rev-parse', 'HEAD'])).trim()
}

async function makePlainDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ts-plain-'))
  await mkdir(join(dir, 'tests'), { recursive: true })
  await writeFile(join(dir, 'README.md'), 'plain project\n')
  await writeFile(join(dir, 'tests/run.sh'), '#!/bin/bash\necho "2 passed"\nexit 0\n')
  await chmod(join(dir, 'tests/run.sh'), 0o755)
  await writeFile(join(dir, 'tests/test_old.py'), 'def test_one():\n    assert 1\n\ndef test_two():\n    assert 1\n')
  return dir
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ts-selftest-'))
  await sh(dir, 'git init -q && git config user.name t && git config user.email t@t && mkdir -p tests && echo "1 passed" > tests/run.sh && printf "#!/bin/bash\\ncat tests/*.log 2>/dev/null; echo \\"1 passed\\"\\nexit 0\\n" > tests/run.sh && chmod +x tests/run.sh && echo hi > README.md')
  await sh(dir, 'git add -A && git commit -q -m init')
  return dir
}

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }) }
  catch (error) { results.push({ name, ok: false, error: String(error?.message ?? error) }) }
}

async function testBacklogStore() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  const init = await store.init()
  assert.deepEqual(init.created, ['.dsh/tasks/backlog.md', '.dsh/tasks/dev-progress.md', '.dsh/tasks/dev-plan.md'])
  const data = await store.load()
  const res = addTasks(data.backlog, [
    { title: '修复并发扣减', priority: 'P1', module: '计费', acceptance: 'bash tests/run.sh' },
    { title: '补测试', priority: 'P2', module: '测试', deps: 'T-001' },
    { title: '2', priority: 'P3' },
    { title: '修复并发扣减', priority: 'P1' },
  ])
  assert.equal(res.added.length, 3)
  assert.equal(res.added[0].id, 'T-001')
  assert.equal(res.duplicates.length, 1)
  await store.saveBacklog(data.backlog)
  const text = await readFile(join(dir, '.dsh/tasks/backlog.md'), 'utf8')
  assert.match(text, /\| T-001 \| 修复并发扣减 \| 计费 \| 待开始 \| — \|/)
  assert.match(text, /下一个可用 ID：\*\*T-004\*\*/)
  const reloaded = await store.load()
  assert.equal(reloaded.backlog.tasks.length, 3)
  assert.equal(reloaded.counts.P1, 1)
  const pick = nextTask(reloaded.backlog, reloaded.archived)
  assert.equal(pick.task.id, 'T-001')
  await rm(dir, { recursive: true, force: true })
}

async function testClaimAcceptHappy() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const data = await store.load()
  addTasks(data.backlog, [
    { title: 'A 修复', priority: 'P1', module: 'core', acceptance: 'bash tests/run.sh' },
    { title: 'B 后续', priority: 'P2', module: 'core' },
  ])
  await store.saveBacklog(data.backlog)
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
  assert.ok(claim.nonce.length === 8)
  const cur = await currentWork(store)
  assert.equal(cur.phase, 'running')
  await writeFile(join(dir, 'fix.txt'), 'fixed\n')
  const sha = await commit(dir, 'feat(core): T-001 fix')
  const report = `=== TASK-AUTO REPORT ===
NONCE: ${claim.nonce}
RESULT: DONE
TASK: T-001
START_SHA: ${claim.startSha}
COMMITS: ${sha}
TEST_CMD: bash tests/run.sh
TEST_RESULT: 基线 1 passed, 0 failed → 交付后 1 passed, 0 failed；既有失败：—
TEST_CHANGES: 仅新增 1 个用例
GATE: code-reviewer H×0 M×0；跳过 —；security-analyst 未涉及
ACCEPTANCE: bash tests/run.sh（来源：backlog）
ASSUMPTIONS: —
DECISION: —
BLOCKER: —
DERIVED:
- [P2] 补充并发边界测试 | 涉及文件 tests/test_edge.py | 来源 review M1
BRIEF:
修好了并发扣减，补了回归测试。
=== END REPORT ===`
  const res = await acceptReport({ store, reportText: report, rollback: false, config: { testTimeoutSec: 900, maxDerivedPerParent: 3, maxDerivedDepth: 2 } })
  assert.equal(res.code, 'ACCEPTED')
  assert.equal(res.status, '待验证')
  const after = await store.load()
  assert.equal(after.backlog.tasks[0].status, '待验证')
  assert.ok(after.backlog.tasks.some(t => t.id === 'T-003'))
  assert.equal(await store.readCurrent(), null)
  assert.equal(after.session, null)
  const reportBad = report.replace(claim.nonce, 'deadbeef')
  const late = await acceptReport({ store, reportText: reportBad, rollback: false, config: { testTimeoutSec: 900, maxDerivedPerParent: 3, maxDerivedDepth: 2 } })
  assert.equal(late.code, 'NO_CURRENT')
  await rm(dir, { recursive: true, force: true })
}

async function testVerifyAndWeakening() {
  const dir = await makeRepo()
  // tests/run.sh is already pass-through; make a real test file with a failure line and exit 1.
  await writeFile(join(dir, 'tests/run.sh'), '#!/bin/bash\nif [ -f .fail ]; then echo "FAILED tests/test_x.py::test_new"; exit 1; fi\necho "1 passed"\nexit 0\n')
  await chmod(join(dir, 'tests/run.sh'), 0o755)
  await writeFile(join(dir, 'tests/test_old.py'), 'def test_one():\n    assert 1\n\ndef test_two():\n    assert 1\n')
  const start = await commit(dir, 'baseline tests')
  await writeFile(join(dir, '.fail'), '')
  await commit(dir, 'add failure')
  const v = await verifyTests({ root: dir, startSha: start, testCmd: 'bash tests/run.sh', timeoutSec: 60 })
  assert.equal(v.verdict, 'FAIL_NEW', JSON.stringify(v))
  assert.deepEqual(v.failures, ['tests/test_x.py::test_new'])
  await rm(join(dir, '.fail'), { force: true })
  await commit(dir, 'remove failure')
  const v2 = await verifyTests({ root: dir, startSha: start, testCmd: 'bash tests/run.sh', timeoutSec: 60 })
  assert.equal(v2.verdict, 'PASS')
  const bad = await verifyTests({ root: dir, startSha: start, testCmd: 'bash tests/run.sh; true', timeoutSec: 60 })
  assert.equal(bad.verdict, 'REJECT_CMD')
  const narrow = await verifyTests({ root: dir, startSha: start, testCmd: 'bash tests/run.sh tests/run.sh', timeoutSec: 60 })
  assert.equal(narrow.verdict, 'PASS', JSON.stringify(narrow))
  // Weakening: remove a test and add skip.
  await writeFile(join(dir, 'tests/test_old.py'), 'def test_one():\n    assert 1\n\nimport pytest\n\n@pytest.mark.skip\ndef test_two():\n    pass\n')
  await commit(dir, 'weaken test')
  const w = await checkTestWeakening({ root: dir, startSha: start })
  assert.ok(w.warnings.some(x => x.includes('消失的用例') || x.includes('skip')), JSON.stringify(w))
  await rm(dir, { recursive: true, force: true })
}

async function testDecisionAndInbox() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const start = await startLoop({ store, config: { defaultMaxTasks: 5, defaultMaxHours: 8, maxNoprog: 3 }, max: 5, hours: 8 })
  assert.equal(start.session.active, true)
  const tick0 = await loopTick({ store, config: { defaultMaxTasks: 5, defaultMaxHours: 8, maxNoprog: 3, maxDerivedPerParent: 3, maxDerivedDepth: 2 } })
  assert.equal(tick0.action, 'idle')
  await store.writeInbox({ type: 'task', title: '新需求', body: '做一个页面', priority: 'P1', module: 'ui' })
  const merged = await mergeInbox({ store, config: {} })
  assert.equal(merged.tasks.length, 1)
  assert.equal(merged.tasks[0].id, 'T-001')
  const tick = await loopTick({ store, config: { defaultMaxTasks: 5, defaultMaxHours: 8, maxNoprog: 3, maxDerivedPerParent: 3, maxDerivedDepth: 2 } })
  assert.equal(tick.action, 'dispatch')
  assert.ok(tick.worker_prompt.includes('task-worker'))
  const cur = await store.readCurrent()
  assert.equal(cur.task, 'T-001')
  const report = `=== TASK-AUTO REPORT ===
NONCE: ${cur.nonce}
RESULT: NEEDS_DECISION
TASK: T-001
START_SHA: ${cur.start_sha}
COMMITS: —
TEST_CMD: —
TEST_RESULT: —
TEST_CHANGES: —
GATE: —
ACCEPTANCE: —
ASSUMPTIONS: —
DECISION: 选 A 还是 B / A（推荐）改现有接口，代价 1 天 / B 新开接口，代价 3 天
BLOCKER: —
DERIVED: —
BRIEF:
需要拍板。
=== END REPORT ===`
  const res = await acceptReport({ store, reportText: report, rollback: false, config: { testTimeoutSec: 900, maxDerivedPerParent: 3, maxDerivedDepth: 2 } })
  assert.equal(res.status, '待决策')
  assert.equal(res.action, 'ask_user')
  const data = await store.load()
  assert.equal(data.backlog.decisions.length, 1)
  assert.match(data.backlog.decisions[0].question, /选 A 还是 B/)
  const stop = await stopLoop({ store, reason: 'test' })
  assert.equal(stop.session.active, false)
  await rm(dir, { recursive: true, force: true })
}

async function testFileModeHappy() {
  const dir = await makePlainDir()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const data = await store.load()
  addTasks(data.backlog, [{ title: '非 git 交付', priority: 'P1', module: 'plain', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
  assert.equal(claim.mode, 'file')
  assert.match(claim.prompt, /文件快照/)
  assert.match(claim.prompt, /不要执行 git/)
  const cur = await store.readCurrent()
  assert.equal(cur.mode, 'file')
  assert.match(cur.snapshot, /snapshots\/T-001-/)
  await writeFile(join(dir, 'demo.txt'), 'demo\n')
  await writeFile(join(dir, 'tests/run.sh'), '#!/bin/bash\necho "3 passed"\nexit 0\n')
  await chmod(join(dir, 'tests/run.sh'), 0o755)
  const report = `=== TASK-AUTO REPORT ===
NONCE: ${cur.nonce}
RESULT: DONE
TASK: T-001
START_SHA: ${cur.start_sha}
COMMITS: —
CHANGES: demo.txt tests/run.sh
TEST_CMD: bash tests/run.sh
TEST_RESULT: 基线 2 passed, 0 failed → 交付后 3 passed, 0 failed；既有失败：—
TEST_CHANGES: 仅新增 1 个用例
GATE: 自查，无高风险
ACCEPTANCE: bash tests/run.sh（来源：backlog）
ASSUMPTIONS: —
DECISION: —
BLOCKER: —
DERIVED: —
BRIEF:
非 git 目录交付完成。
=== END REPORT ===`
  const res = await acceptReport({ store, reportText: report, rollback: false, config })
  assert.equal(res.code, 'ACCEPTED')
  assert.equal(res.status, '待验证')
  assert.equal(res.mode, 'file')
  assert.ok(res.changed.includes('demo.txt'))
  assert.ok(res.changed.includes('tests/run.sh'))
  assert.ok(await pathExists(cur.snapshot))
  const after = await store.load()
  await confirmTask(store, after.backlog, after.backlog.tasks.find(t => t.id === 'T-001'), { conclusion: '非 git 通过', gate: 'PASS' })
  assert.equal(await pathExists(cur.snapshot), false)
  await rm(dir, { recursive: true, force: true })
}

async function testFileModeFailNew() {
  const dir = await makePlainDir()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const data = await store.load()
  addTasks(data.backlog, [{ title: '非 git 失败', priority: 'P1', module: 'plain', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
  const cur = await store.readCurrent()
  await writeFile(join(dir, 'tests/run.sh'), '#!/bin/bash\necho "FAILED tests/test_x.py::test_new"\nexit 1\n')
  await chmod(join(dir, 'tests/run.sh'), 0o755)
  const report = `=== TASK-AUTO REPORT ===
NONCE: ${cur.nonce}
RESULT: DONE
TASK: T-001
START_SHA: ${cur.start_sha}
COMMITS: —
TEST_CMD: bash tests/run.sh
TEST_RESULT: 基线 2 passed, 0 failed → 交付后 0 passed, 1 failed
TEST_CHANGES: 修改测试脚本
GATE: —
ACCEPTANCE: bash tests/run.sh
ASSUMPTIONS: —
DECISION: —
BLOCKER: —
DERIVED: —
BRIEF: 测试失败。
=== END REPORT ===`
  const res = await acceptReport({ store, reportText: report, rollback: false, config })
  assert.equal(res.test.verdict, 'FAIL_NEW', JSON.stringify(res.test))
  assert.equal(res.status, '待开始')
  assert.equal(cur.id, undefined)
  await rm(dir, { recursive: true, force: true })
}

async function testFileModeWeakeningAndRollback() {
  const dir = await makePlainDir()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const data = await store.load()
  addTasks(data.backlog, [
    { title: '改弱检测', priority: 'P2', module: 'plain', acceptance: 'bash tests/run.sh' },
    { title: '回滚检测', priority: 'P2', module: 'plain', acceptance: 'bash tests/run.sh' },
  ])
  await store.saveBacklog(data.backlog)
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
  let cur = await store.readCurrent()
  await writeFile(join(dir, 'tests/test_old.py'), 'def test_one():\n    assert 1\n\nimport pytest\n\n@pytest.mark.skip\ndef test_two():\n    pass\n')
  const report = `=== TASK-AUTO REPORT ===
NONCE: ${cur.nonce}
RESULT: DONE
TASK: T-001
START_SHA: ${cur.start_sha}
COMMITS: —
TEST_CMD: bash tests/run.sh .
TEST_RESULT: 2 passed
TEST_CHANGES: 删了一个用例
GATE: —
ACCEPTANCE: bash tests/run.sh
ASSUMPTIONS: —
DECISION: —
BLOCKER: —
DERIVED: —
BRIEF: 改测试。
=== END REPORT ===`
  const res = await acceptReport({ store, reportText: report, rollback: false, config })
  assert.ok(res.weaken.warnings.some(w => w.includes('skip')), JSON.stringify(res.weaken))
  assert.ok(res.weaken.warnings.some(w => w.includes('断言净减少')), JSON.stringify(res.weaken))
  await store.clearCurrent()
  // second task: explicit rollback restores the snapshot
  const data2 = await store.load()
  const second = data2.backlog.tasks.find(t => t.id === 'T-002')
  const claim2 = await claimTask({ store, backlog: data2.backlog, task: second, mode: 'manual', dirtyPaths: [] })
  cur = await store.readCurrent()
  await writeFile(join(dir, 'scratch.txt'), 'junk\n')
  await writeFile(join(dir, 'README.md'), 'broken\n')
  const failReport = `=== TASK-AUTO REPORT ===
NONCE: ${cur.nonce}
RESULT: FAILED
TASK: T-002
START_SHA: ${cur.start_sha}
COMMITS: —
TEST_CMD: bash tests/run.sh
TEST_RESULT: —
TEST_CHANGES: —
GATE: —
ACCEPTANCE: —
ASSUMPTIONS: —
DECISION: —
BLOCKER: 故意失败
DERIVED: —
BRIEF: 回滚测试。
=== END REPORT ===`
  const rolled = await acceptReport({ store, reportText: failReport, rollback: true, config })
  assert.match(rolled.rollbackInfo, /已恢复开工快照/)
  assert.equal(await readFile(join(dir, 'README.md'), 'utf8'), 'plain project\n')
  await rm(join(dir, 'scratch.txt'), { force: true })
  await rm(dir, { recursive: true, force: true })
}

async function testHaltResumeRequeue() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const data = await store.load()
  addTasks(data.backlog, [{ title: 'H 任务', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const config = { defaultMaxTasks: 5, defaultMaxHours: 8, maxNoprog: 3, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  await startLoop({ store, config, max: 5, hours: 8 })
  const tick = await loopTick({ store, config })
  assert.equal(tick.action, 'dispatch')
  const halted = await haltLoop({ store })
  assert.match(halted.text, /保留/)
  assert.equal((await store.readCurrent()).phase, 'halted')
  const resumed = await resumeHalted({ store, config })
  assert.equal(resumed.action, 'dispatch')
  const cur = await store.readCurrent()
  assert.equal(cur.phase, 'running')
  assert.notEqual(cur.nonce, tick.current.nonce)
  await haltLoop({ store })
  const requeued = await requeueHalted({ store })
  assert.equal(requeued.action, 'requeued')
  assert.equal(await store.readCurrent(), null)
  const after = await store.load()
  assert.equal(after.backlog.tasks[0].status, '待开始')
  assert.match(after.backlog.tasks[0].note, /叫停断点/)
  await rm(dir, { recursive: true, force: true })
}

async function testVerifyTimeoutConfig() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const path = join(dir, '.dsh/tasks/backlog.md')
  const text = await readFile(path, 'utf8')
  assert.match(text, /\*\*待验证超时：\*\* 7 天/)
  // 旧 backlog 没有这一行 → 按 7 天（向后兼容）。
  assert.equal(timeoutDaysOf({ text: '# 空 backlog\n' }), 7)
  await writeFile(path, text.replace(/\*\*待验证超时：\*\*[^\n]*\n/, ''))
  assert.equal(timeoutDaysOf((await store.load()).backlog), 7)
  // `0` 关闭默认通过。
  await writeFile(path, text.replace(/\*\*待验证超时：\*\*[^\n]*/, '**待验证超时：** 0 天'))
  const data = await store.load()
  assert.equal(timeoutDaysOf(data.backlog), 0)
  assert.equal(verifyState('待验证起：2020-01-01', { timeoutDays: 0, nowMs: Date.now() }).disabled, true)
  assert.equal(verifyState('待验证起：2020-01-01；默认通过：否', { timeoutDays: 7 }).hold, true)
  await rm(dir, { recursive: true, force: true })
}

async function testVerifyTimeoutPass() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2, maxNoprog: 3 }
  let data = await store.load()
  addTasks(data.backlog, [
    { title: '到期默认通过', priority: 'P1', module: 'core', acceptance: 'bash tests/run.sh' },
    { title: '标记不默认通过', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' },
    { title: '提交不可达', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' },
  ])
  await store.saveBacklog(data.backlog)
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
  await writeFile(join(dir, 'feature.txt'), 'ok\n')
  const sha = await commit(dir, 'feat(core): T-001 timeout')
  const res = await acceptReport({
    store,
    reportText: reportBlock({
      NONCE: claim.nonce, RESULT: 'DONE', TASK: 'T-001', START_SHA: claim.startSha,
      COMMITS: sha, TEST_CMD: 'bash tests/run.sh',
      TEST_RESULT: '基线 1 passed, 0 failed → 交付后 1 passed, 0 failed；既有失败：—',
      TEST_CHANGES: '仅新增 1 个用例',
      GATE: 'code-reviewer H×0 M×0；跳过 —',
      ACCEPTANCE: 'bash tests/run.sh（来源：backlog）',
      ASSUMPTIONS: '—',
      VERIFY: 'bash tests/run.sh → 打开 /demo 看输出',
      DECISION: '—', BLOCKER: '—', DERIVED: '—',
      BRIEF: '交付完成。',
    }),
    config,
  })
  assert.equal(res.status, '待验证', JSON.stringify(res))
  data = await store.load()
  const t1 = data.backlog.tasks.find(t => t.id === 'T-001')
  assert.match(t1.note, /待验证起：\d{4}-\d{2}-\d{2}/)
  assert.match(t1.note, /怎么验：bash tests\/run\.sh → 打开 \/demo 看输出/)
  t1.note = t1.note.replace(/待验证起：\d{4}-\d{2}-\d{2}/, `待验证起：${daysAgo(6)}`)
  const t2 = data.backlog.tasks.find(t => t.id === 'T-002')
  t2.status = '待验证'
  t2.note = `验收：bash tests/run.sh；待验证起：${daysAgo(20)}；怎么验：bash tests/run.sh；默认通过：否`
  const t3 = data.backlog.tasks.find(t => t.id === 'T-003')
  t3.status = '待验证'
  t3.note = `验收：bash tests/run.sh；自动交付（${daysAgo(30)}）：commits deadbeef；待验证起：${daysAgo(30)}；怎么验：bash tests/run.sh`
  await store.saveBacklog(data.backlog)

  // 到期前 1 天：状态里能看到「明天默认通过」，但还没写预告。
  const rows = describeVerifyRows(data.backlog)
  assert.ok(rows.some(r => r.includes('明天默认通过')), rows.join('\n'))
  const statusText = buildStatusReport({ ...data, current: null, session: null }, { verifyRows: rows })
  assert.match(statusText, /明天默认通过/)

  // loop tick 在合并 inbox 之后自动做到期检查。
  await startLoop({ store, config, max: 5, hours: 8 })
  const tick = await loopTick({ store, config })
  assert.equal(tick.action, 'idle', JSON.stringify(tick))
  assert.match(tick.text, /明天默认通过/)
  const first = tick.timeout
  assert.deepEqual(first.closed, [])
  assert.ok(first.announced.some(a => a.task === 'T-001'), JSON.stringify(first))
  assert.ok(first.held.some(h => h.task === 'T-002'), JSON.stringify(first))
  const dueLog = await store.logTail(40)
  assert.ok(dueLog.some(l => l.includes('T-001 | VERIFY_DUE')), dueLog.join('\n'))
  data = await store.load()
  assert.match(data.backlog.tasks.find(t => t.id === 'T-001').note, /超时预告：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)

  // 满 24 小时：T-001 提交仍在分支 → 默认通过；T-003 提交不可达 → 待决策；T-002 hold 不动。
  const later = await checkVerifyTimeout({ store, nowMs: Date.now() + 25 * 3600 * 1000 })
  assert.ok(later.closed.some(c => c.task === 'T-001'), JSON.stringify(later))
  assert.ok(later.decisions.some(d => d.task === 'T-003'), JSON.stringify(later))
  data = await store.load()
  assert.equal(data.backlog.tasks.some(t => t.id === 'T-001'), false)
  assert.ok(data.backlog.tasks.some(t => t.id === 'T-002' && t.status === '待验证'))
  assert.ok(data.backlog.tasks.some(t => t.id === 'T-003' && t.status === '待验证'))
  assert.ok(data.backlog.decisions.some(d => d.task === 'T-003' && d.question.includes('交付提交')))
  const progress = await store.readProgress()
  assert.match(progress, /### T-001/)
  assert.match(progress, /关闭方式：\*\* 超时默认通过（7 天无人打回）/)
  const tail = await store.logTail(60)
  assert.ok(tail.some(l => l.includes('TIMEOUT_PASS')), tail.join('\n'))
  assert.ok(tail.some(l => l.includes('TIMEOUT_HOLD')), tail.join('\n'))
  await rm(dir, { recursive: true, force: true })
}

async function testManualVerifyHold() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  let data = await store.load()
  addTasks(data.backlog, [{ title: '老报告交付', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
  await writeFile(join(dir, 'feature.txt'), 'v1\n')
  const sha = await commit(dir, 'feat(core): T-001 old report')
  const res = await acceptReport({
    store,
    reportText: reportBlock({
      NONCE: claim.nonce, RESULT: 'DONE', TASK: 'T-001', START_SHA: claim.startSha,
      COMMITS: sha, TEST_CMD: 'bash tests/run.sh',
      TEST_RESULT: '基线 1 passed, 0 failed → 交付后 1 passed, 0 failed；既有失败：—',
      TEST_CHANGES: '未改动测试', GATE: '自查', ACCEPTANCE: 'bash tests/run.sh（来源：backlog）',
      ASSUMPTIONS: '—', DECISION: '—', BLOCKER: '—', DERIVED: '—', BRIEF: '老报告格式。',
    }),
    config,
  })
  assert.equal(res.status, '待验证', JSON.stringify(res))
  data = await store.load()
  let task = data.backlog.tasks.find(t => t.id === 'T-001')
  // 老报告没有 VERIFY 字段：怎么验留「待补」，向后兼容。
  assert.match(task.note, /怎么验：—（待补/)
  await store.writeInbox({ type: 'decision', ref: 'T-001', body: '别默认通过，我要亲自看' })
  const merged = await mergeInbox({ store, config: {} })
  assert.equal(merged.decisions[0].action, 'hold', JSON.stringify(merged))
  data = await store.load()
  task = data.backlog.tasks.find(t => t.id === 'T-001')
  assert.equal(task.status, '待验证')
  assert.match(task.note, /默认通过：否/)
  assert.doesNotMatch(task.note, /超时预告/)
  const rows = describeVerifyRows(data.backlog)
  assert.ok(rows.some(r => r.includes('不默认通过')), rows.join('\n'))
  // 重交时旧子句被替换（旧日期/旧迹象不能沿用），步骤最多 3 条并用 → 连接。
  const restamped = stampVerifyEntry(`${task.note}；后续迹象：无，建议先看`, { steps: 'curl http://localhost/x/health → 看 200', date: '2026-01-02' })
  assert.match(restamped, /待验证起：2026-01-02/)
  assert.doesNotMatch(restamped, /后续迹象/)
  assert.match(restamped, /默认通过：否/) // 需求方的长期偏好不因重交丢失
  assert.equal((restamped.match(/待验证起：/g) || []).length, 1)
  assert.equal(normalizeVerifySteps('a;b；c · d'), 'a → b → c')
  await rm(dir, { recursive: true, force: true })
}

async function testAutoAcceptRules() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  // 任务池初始化改的 .gitignore 属于基线，不能算进 worker 的交付改动。
  await commit(dir, 'chore: ignore task state')
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  let data = await store.load()
  addTasks(data.backlog, [
    { title: '只改测试的任务', priority: 'P1', module: 'tests', acceptance: 'bash tests/run.sh' },
    { title: '免验 P3 任务', priority: 'P3', module: 'core', acceptance: 'bash tests/run.sh', note: '验收方式：自动' },
    { title: '手动单步任务', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh', note: '验收方式：自动' },
  ])
  await store.saveBacklog(data.backlog)
  const fields = (id, nonce, startSha, sha, extra = {}) => ({
    NONCE: nonce, RESULT: 'DONE', TASK: id, START_SHA: startSha, COMMITS: sha,
    TEST_CMD: 'bash tests/run.sh',
    TEST_RESULT: '基线 1 passed, 0 failed → 交付后 1 passed, 0 failed；既有失败：—',
    TEST_CHANGES: '仅新增 1 个用例',
    GATE: 'code-reviewer H×0 M×0', ACCEPTANCE: 'bash tests/run.sh（来源：backlog）',
    ASSUMPTIONS: '—', VERIFY: 'bash tests/run.sh → 看输出',
    DECISION: '—', BLOCKER: '—', DERIVED: '—', BRIEF: '交付完成。',
    ...extra,
  })

  // 规则 a：只改了测试 → 直接归档
  let claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'auto', dirtyPaths: [] })
  await writeFile(join(dir, 'tests/test_old.py'), 'def test_one():\n    assert 1\n\ndef test_two():\n    assert 1\n\ndef test_three():\n    assert 3\n')
  let sha = await commit(dir, 'test(tests): T-001 add case')
  let res = await acceptReport({ store, reportText: reportBlock(fields('T-001', claim.nonce, claim.startSha, sha, { TEST_CMD: 'bash tests/run.sh tests/test_old.py' })), config })
  assert.equal(res.status, '已完成', JSON.stringify(res))
  assert.equal(res.action, 'auto_accept')
  assert.equal(res.autoAccept.rule, 'a')
  assert.match(await store.readProgress(), /自动验收（规则 a）/)
  assert.ok((await store.logTail(20)).some(l => l.includes('DONE→已完成（自动验收）')))

  // 规则 b：P2/P3 + note 含「验收方式：自动」+ 验收标准来自 backlog → 直接归档
  data = await store.load()
  claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks.find(t => t.id === 'T-002'), mode: 'auto', dirtyPaths: [] })
  await writeFile(join(dir, 'feature.txt'), 'v2\n')
  sha = await commit(dir, 'feat(core): T-002 auto accept')
  res = await acceptReport({ store, reportText: reportBlock(fields('T-002', claim.nonce, claim.startSha, sha, { CHANGES: 'feature.txt' })), config })
  assert.equal(res.status, '已完成', JSON.stringify(res))
  assert.equal(res.autoAccept.rule, 'b')

  // 手动单步（dispatch=manual）不做自动验收 → 待验证
  data = await store.load()
  claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks.find(t => t.id === 'T-003'), mode: 'manual', dirtyPaths: [] })
  await writeFile(join(dir, 'feature2.txt'), 'v3\n')
  sha = await commit(dir, 'feat(core): T-003 manual')
  res = await acceptReport({ store, reportText: reportBlock(fields('T-003', claim.nonce, claim.startSha, sha, { CHANGES: 'feature2.txt' })), config })
  assert.equal(res.status, '待验证', JSON.stringify(res))
  data = await store.load()
  assert.match(data.backlog.tasks.find(t => t.id === 'T-003').note, /待验证起：\d{4}-\d{2}-\d{2}/)
  await rm(dir, { recursive: true, force: true })
}

async function testDerivedP3Security() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  let data = await store.load()
  addTasks(data.backlog, [{ title: '父任务', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
  await writeFile(join(dir, 'feature.txt'), 'x\n')
  const sha = await commit(dir, 'feat(core): T-001 parent')
  const res = await acceptReport({
    store,
    reportText: reportBlock({
      NONCE: claim.nonce, RESULT: 'DONE', TASK: 'T-001', START_SHA: claim.startSha, COMMITS: sha,
      TEST_CMD: 'bash tests/run.sh',
      TEST_RESULT: '基线 1 passed, 0 failed → 交付后 1 passed, 0 failed；既有失败：—',
      TEST_CHANGES: '仅新增 1 个用例', GATE: 'code-reviewer',
      ACCEPTANCE: 'bash tests/run.sh（来源：backlog）', ASSUMPTIONS: '—', VERIFY: 'bash tests/run.sh',
      DECISION: '—', BLOCKER: '—',
      DERIVED: [
        '[P2] 补充并发边界测试 | 涉及文件 tests/test_edge.py | 来源 review M1 | 级别 一般',
        '修复鉴权绕过 | 涉及文件 auth/login.py | 来源 review H1 | 级别 安全 Critical',
        '补鉴权文档 | 涉及文件 docs/auth.md | 来源 同类缺陷 | 级别 安全 High',
      ],
      BRIEF: '交付并衍生三条。',
    }),
    config,
  })
  assert.equal(res.status, '待验证', JSON.stringify(res))
  assert.equal(res.derived.length, 3, JSON.stringify(res.derived))
  data = await store.load()
  const byTitle = title => data.backlog.tasks.find(t => t.title === title)
  const general = byTitle('补充并发边界测试')
  const security = byTitle('修复鉴权绕过')
  const docs = byTitle('补鉴权文档')
  assert.ok(general && security && docs, JSON.stringify(data.backlog.tasks.map(t => t.title)))
  assert.equal(general.priority, 'P3')
  assert.match(general.note, /AI 衍生 P3，只录不做/)
  assert.equal(security.priority, 'P2') // 安全例外：不高于父任务（P2）
  assert.match(security.note, /安全例外/)
  assert.equal(docs.priority, 'P3') // 来源不是 reviewer finding → 不例外
  assert.match(docs.note, /只录不做/)
  assert.equal(nextTask(data.backlog, data.archived).task.id, security.id)
  // 人工把 P3 衍生任务挪出 P3 表后照常派发（即使 note 里还有只录不做）
  general.priority = 'P1'
  await store.saveBacklog(data.backlog)
  assert.equal(nextTask(data.backlog, data.archived).task.id, general.id)
  await rm(dir, { recursive: true, force: true })
}

async function testBaselineRedDerived() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const config = { defaultMaxTasks: 5, defaultMaxHours: 8, maxNoprog: 3, testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  await startLoop({ store, config, max: 5, hours: 8 })
  const data = await store.load()
  addTasks(data.backlog, [{ title: '基线红任务', priority: 'P1', module: 'core', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'auto', dirtyPaths: [] })
  const res = await acceptReport({
    store,
    reportText: reportBlock({
      NONCE: claim.nonce, RESULT: 'BASELINE_RED', TASK: 'T-001', START_SHA: claim.startSha,
      COMMITS: '—', TEST_CMD: 'bash tests/run.sh',
      TEST_RESULT: '基线 1 passed, 1 failed（tests/test_old.py::test_two）→ 交付后 —',
      TEST_CHANGES: '—', GATE: '—', ACCEPTANCE: 'bash tests/run.sh（来源：backlog）',
      ASSUMPTIONS: '—', DECISION: '—', BLOCKER: '基线红：tests/test_old.py::test_two',
      DERIVED: '—', BRIEF: '基线红，未动手。',
    }),
    config,
  })
  assert.equal(res.status, '阻塞', JSON.stringify(res))
  const after = await store.load()
  const repair = after.backlog.tasks.find(t => t.title.includes('修复基线失败'))
  assert.ok(repair, JSON.stringify(after.backlog.tasks.map(t => t.title)))
  assert.equal(repair.priority, 'P3')
  assert.match(repair.note, /只录不做/)
  assert.match(repair.note, /来源说明：基线红/)
  assert.equal((await store.readSession()).noprog, 0)
  assert.ok(after.backlog.decisions.some(d => d.question.includes('修复任务')), JSON.stringify(after.backlog.decisions))
  await rm(dir, { recursive: true, force: true })
}

async function testRejectReopenArchived() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const data = await store.load()
  addTasks(data.backlog, [{ title: '归档后打回', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  await confirmTask(store, data.backlog, data.backlog.tasks[0], { conclusion: '先确认', gate: 'PASS' })
  let progress = await store.readProgress()
  assert.match(progress, /关闭方式：\*\* 需求方确认/)
  const tools = createTools({ workingDirectory: { ensure: async () => dir } }, {})
  const reject = tools.find(t => t.name === 'task_reject')
  const res = await reject.execute({ task_id: 'T-001', reason: '用法还是不对' }, {})
  assert.match(res.text, /已重开/)
  const after = await store.load()
  const back = after.backlog.tasks.find(t => t.id === 'T-001')
  assert.ok(back, 'reopened task should be back in backlog')
  assert.equal(back.status, '打回')
  assert.match(back.note, /重开（\d{4}-\d{2}-\d{2}）：原关闭方式 需求方确认/)
  progress = await store.readProgress()
  assert.match(progress, /\*\*重开：\*\*/)
  assert.match(progress, /打回 1 次/)
  await rm(dir, { recursive: true, force: true })
}

async function testNotifyPolicy() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  const data = await store.load()
  addTasks(data.backlog, [{ title: '通知任务', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const config = { testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }

  const out = join(dir, 'notify.out')
  const script = "require('fs').appendFileSync(process.env.NOTIFY_OUT, process.argv[1] + '|' + process.argv[2] + '\\n')"
  const cmd = `${shellQuote(process.execPath)} -e ${shellQuote(script)}`
  const env = { TASK_NOTIFY: 'on', TASK_NOTIFY_CMD: cmd, NOTIFY_OUT: out }

  // 默认静默：没有显式开关不发，也不碰去重文件。
  assert.equal(notifySettings({}, {}).enabled, false)
  assert.equal(notifySettings({}, { TASK_NOTIFY: '1' }).enabled, true)
  assert.equal(notifySettings({ notify: 'on' }, { TASK_NOTIFY: 'off' }).enabled, false)
  assert.equal(notifySettings({ notify: 'off' }, {}).dedupeSec, 600)
  const silent = await notifyTask({ store, config: store.config, event: 'verify', taskId: 'T-001', detail: 'x', env: {} })
  assert.equal(silent.ok, false)
  assert.equal(silent.skipped, 'disabled')
  assert.equal(await pathExists(out), false)

  // TASK_NOTIFY=off 明确关闭（即使给了命令）。
  const off = await notifyTask({ store, config: store.config, event: 'verify', taskId: 'T-001', detail: 'x', env: { ...env, TASK_NOTIFY: 'off' } })
  assert.equal(off.skipped, 'disabled')
  assert.equal(await pathExists(out), false)

  // 文案：≤100 字，附 `dsh-task -d <ID> "…"` 回复命令；停机用 --status。
  const longMessage = composeNotifyMessage({ event: 'decision', taskId: 'T-001', detail: '很长的说明'.repeat(40) })
  assert.ok([...longMessage].length <= 100, longMessage)
  assert.match(longMessage, /^待决策 T-001：/)
  assert.match(longMessage, /回复：dsh-task -d T-001 "…"/)
  const stopMessage = composeNotifyMessage({ event: 'stop', detail: 'user' })
  assert.match(stopMessage, /^循环停止：user/)
  assert.match(stopMessage, /回复：dsh-task --status/)

  // 开启：注入命令收到标题 + 文案，不弹真实系统通知。
  const sent = await notifyTask({ store, config: store.config, event: 'verify', taskId: 'T-001', detail: '交付完成，请验证', env })
  assert.equal(sent.ok, true, JSON.stringify(sent))
  assert.equal(sent.channel, 'cmd')
  let lines = (await readFile(out, 'utf8')).trim().split('\n')
  assert.equal(lines.length, 1)
  const [title, message] = lines[0].split('|')
  assert.match(title, /^task · /)
  assert.match(message, /^待验证 T-001：交付完成，请验证/)
  assert.match(message, /dsh-task -d T-001 "…"/)

  // 去重：同事件 + 任务 600s 内只发一次；别的任务/事件照发；过了 TTL 再发。
  const dup = await notifyTask({ store, config: store.config, event: 'verify', taskId: 'T-001', detail: 'again', env })
  assert.equal(dup.skipped, 'duplicate')
  assert.equal((await readFile(out, 'utf8')).trim().split('\n').length, 1)
  await notifyTask({ store, config: store.config, event: 'verify', taskId: 'T-002', detail: 'another', env })
  await notifyTask({ store, config: store.config, event: 'decision', taskId: 'T-001', detail: 'need answer', env })
  assert.equal((await readFile(out, 'utf8')).trim().split('\n').length, 3)
  const later = await notifyTask({ store, config: store.config, event: 'verify', taskId: 'T-001', detail: 'after ttl', env, nowMs: Date.now() + 601000 })
  assert.equal(later.ok, true)
  assert.equal((await readFile(out, 'utf8')).trim().split('\n').length, 4)

  // 命令超时：只写 run.log WARN，不抛；失败不记去重键（下一轮可重发）。
  const hang = `${shellQuote(process.execPath)} -e ${shellQuote('setTimeout(() => {}, 60000)')}`
  const slow = await notifyTask({
    store, config: store.config, event: 'blocked', taskId: 'T-003', detail: 'hang',
    env: { TASK_NOTIFY: 'on', TASK_NOTIFY_CMD: hang, TASK_NOTIFY_TIMEOUT_MS: '300' },
  })
  assert.equal(slow.ok, false, JSON.stringify(slow))
  assert.equal(slow.skipped, 'failed')
  assert.match(slow.reason, /timeout/)
  assert.ok((await store.logTail(10)).some(l => l.includes('NOTIFY | WARN')), (await store.logTail(10)).join('\n'))
  const retried = await notifyTask({ store, config: store.config, event: 'blocked', taskId: 'T-003', detail: 'retry', env: { ...env, TASK_NOTIFY_DEDUPE_SEC: '1' } })
  assert.equal(retried.ok, true, JSON.stringify(retried))

  // 接进主流程：任务进待决策 / 循环停止时各发一次（env 开关生效）。
  await rm(join(store.autoDir, 'notified.json'), { force: true })
  const saved = {}
  for (const key of ['TASK_NOTIFY', 'TASK_NOTIFY_CMD', 'NOTIFY_OUT']) {
    saved[key] = process.env[key]
    process.env[key] = key === 'NOTIFY_OUT' ? out : env[key]
  }
  try {
    const loaded = await store.load()
    const claim = await claimTask({ store, backlog: loaded.backlog, task: loaded.backlog.tasks[0], mode: 'manual', dirtyPaths: [] })
    const res = await acceptReport({
      store,
      reportText: reportBlock({
        NONCE: claim.nonce, RESULT: 'NEEDS_DECISION', TASK: 'T-001', START_SHA: claim.startSha,
        COMMITS: '—', TEST_CMD: '—', TEST_RESULT: '—', TEST_CHANGES: '—', GATE: '—',
        ACCEPTANCE: '—', ASSUMPTIONS: '—', DECISION: '选 A 还是 B / A（推荐）A / B B',
        BLOCKER: '—', DERIVED: '—', BRIEF: '需要拍板。',
      }),
      config,
    })
    assert.equal(res.status, '待决策')
    assert.equal(res.notify?.ok, true, JSON.stringify(res.notify))
    const after = (await readFile(out, 'utf8')).trim().split('\n')
    assert.ok(after.at(-1).includes('|待决策 T-001：'), after.at(-1))
    await startLoop({ store, config, max: 5, hours: 8 })
    const stopped = await stopLoop({ store, reason: 'test notify' })
    assert.equal(stopped.notify?.ok, true, JSON.stringify(stopped.notify))
    const stoppedLines = (await readFile(out, 'utf8')).trim().split('\n')
    assert.ok(stoppedLines.at(-1).includes('|循环停止：'), stoppedLines.at(-1))
    // 同一轮 stop 再发一次 → 去重。
    const again = await stopLoop({ store, reason: 'test notify' })
    assert.equal(again.notify?.skipped, 'duplicate')
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  await rm(dir, { recursive: true, force: true })
}

async function testWatchdogStates() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks', watchdogIdleMin: 30, watchdogSpinMin: 60 })
  await store.init()
  // 清掉 init 改的 .gitignore：否则它一直是「新鲜脏文件」，tree 永远算新的。
  await commit(dir, 'chore: task state ignore')
  const data = await store.load()
  addTasks(data.backlog, [{ title: '看门狗任务', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' }])
  await store.saveBacklog(data.backlog)
  const config = { defaultMaxTasks: 5, defaultMaxHours: 8, maxNoprog: 3, watchdogIdleMin: 30, watchdogSpinMin: 60 }
  await startLoop({ store, config, max: 5, hours: 8 })
  const claimed = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks[0], mode: 'auto', dirtyPaths: [] })
  const now = Date.now()
  const old = new Date(now - 120 * 60000)
  let cur = await store.readCurrent()
  cur = { ...cur, started: now - 120 * 60000 }

  // 1) SPIN：输出（run.log）新鲜，但仓库 2 小时没有新提交/文件变化。
  await store.writeCurrent(cur)
  let wd = await inspectWatchdog({ store, config, nowMs: now })
  assert.equal(wd.verdict, 'SPIN', JSON.stringify(wd))
  assert.match(wd.advisory.text, /建议停止/)
  assert.match(wd.advisory.text, /没有新提交\/文件变化/)

  // review_pending 是 worker 特意在等调度员 → 不检测。
  await store.writeCurrent({ ...cur, phase: 'review_pending' })
  assert.equal(await inspectWatchdog({ store, config, nowMs: now }), null)
  await store.writeCurrent(cur)

  // 2) IDLE：输出也 2 小时没增长（把 run.log 里已有事件的记录时间改老）。
  const rawLog = await readFile(store.runLogPath, 'utf8')
  await writeFile(store.runLogPath, rawLog.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z/gm, old.toISOString()))
  wd = await inspectWatchdog({ store, config, nowMs: now })
  assert.equal(wd.verdict, 'IDLE', JSON.stringify(wd))
  assert.ok(wd.outMin >= 119, String(wd.outMin))
  assert.match(wd.advisory.text, /建议 nudge/)

  // 心跳写 WATCHDOG 行：判定 + 两个时长 + worker 最近活动摘要。
  const checked = await checkWatchdog({ store, config, nowMs: now })
  assert.equal(checked.verdict, 'IDLE')
  const tail = await store.logTail(20)
  const line = tail.find(l => l.includes('| WATCHDOG | IDLE |'))
  assert.ok(line, tail.join('\n'))
  assert.match(line, /out=1\d\dm tree=1\d\dm/)
  assert.match(line, /最近活动：/)
  assert.match(line, /CLAIM/)
  // 同一判定 10 分钟内不重复写。
  await checkWatchdog({ store, config, nowMs: now + 60000 })
  assert.equal(((await readFile(store.runLogPath, 'utf8')).match(/\| WATCHDOG \| IDLE \|/g) || []).length, 1)

  // tick 的返回文本带「建议 nudge」（看门狗自己的日志不算输出增长，仍是 IDLE）。
  const tick = await loopTick({ store, config })
  assert.equal(tick.action, 'waiting')
  assert.equal(tick.watchdog.verdict, 'IDLE', JSON.stringify(tick.watchdog))
  assert.match(tick.text, /建议 nudge/)

  // task_status 也带看门狗建议（只读，不写 WATCHDOG）。
  const tools = createTools({ workingDirectory: { ensure: async () => dir } }, config)
  const status = await tools.find(t => t.name === 'task_status').execute({}, {})
  assert.match(status.text, /worker 停滞看门狗/)
  assert.match(status.text, /建议 nudge/)
  assert.equal(status.data.watchdog.verdict, 'IDLE')

  // 3) OK：输出与仓库都刚有变化；恢复后清掉 watchdog 标记。
  await store.writeCurrent({ ...cur, started: Date.now() })
  const okWd = await checkWatchdog({ store, config })
  assert.equal(okWd.verdict, 'OK', JSON.stringify(okWd))
  assert.equal((await store.readCurrent()).watchdog, undefined)
  assert.equal((await inspectWatchdog({ store, config })).verdict, 'OK')
  assert.ok(claimed.prompt.length > 0)

  // 非 git（文件快照模式）也能采集，不报错。
  const plainDir = await makePlainDir()
  const plainStore = new TaskStore(plainDir, { stateDir: '.dsh/tasks', watchdogIdleMin: 30, watchdogSpinMin: 60 })
  await plainStore.init()
  const plainData = await plainStore.load()
  addTasks(plainData.backlog, [{ title: 'plain watchdog', priority: 'P2', module: 'plain', acceptance: 'bash tests/run.sh' }])
  await plainStore.saveBacklog(plainData.backlog)
  await claimTask({ store: plainStore, backlog: plainData.backlog, task: plainData.backlog.tasks[0], mode: 'auto', dirtyPaths: [] })
  const plainSignals = await inspectWatchdog({ store: plainStore, config, nowMs: Date.now() + 5 * 60000 })
  assert.ok(plainSignals, 'plain dir should produce signals')
  assert.equal(plainSignals.verdict, 'OK', JSON.stringify(plainSignals))
  await rm(plainDir, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
}

async function testRunLogEvents() {
  const dir = await makeRepo()
  const store = new TaskStore(dir, { stateDir: '.dsh/tasks' })
  await store.init()
  await commit(dir, 'chore: task state ignore')
  const config = { defaultMaxTasks: 5, defaultMaxHours: 8, maxNoprog: 3, testTimeoutSec: 60, maxDerivedPerParent: 3, maxDerivedDepth: 2 }
  await startLoop({ store, config, max: 5, hours: 8 })
  let data = await store.load()
  addTasks(data.backlog, [
    { title: '事件任务', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' },
    { title: '回滚任务', priority: 'P2', module: 'core', acceptance: 'bash tests/run.sh' },
  ])
  await store.saveBacklog(data.backlog)

  // DISPATCH：claim 派发时。
  const tick = await loopTick({ store, config })
  assert.equal(tick.action, 'dispatch')
  let log = await readFile(store.runLogPath, 'utf8')
  assert.match(log, /T-001 \| DISPATCH \| auto\/git \| worker=worker-T-001 \| nonce=[0-9a-f]{8}/)

  // 待决策 → DECIDED（task_answer 答复）。
  const cur = await store.readCurrent()
  await acceptReport({
    store,
    reportText: reportBlock({
      NONCE: cur.nonce, RESULT: 'NEEDS_DECISION', TASK: 'T-001', START_SHA: cur.start_sha,
      COMMITS: '—', TEST_CMD: '—', TEST_RESULT: '—', TEST_CHANGES: '—', GATE: '—',
      ACCEPTANCE: '—', ASSUMPTIONS: '—', DECISION: '选 A 还是 B / A（推荐）A / B B',
      BLOCKER: '—', DERIVED: '—', BRIEF: '需要拍板。',
    }),
    config,
  })
  const tools = createTools({ workingDirectory: { ensure: async () => dir } }, config)
  await tools.find(t => t.name === 'task_answer').execute({ task_id: 'T-001', answer: '选 A' }, {})
  log = await readFile(store.runLogPath, 'utf8')
  assert.match(log, /T-001 \| DECIDED \| 选 A/)

  // REJECTED（task_reject）。
  await tools.find(t => t.name === 'task_reject').execute({ task_id: 'T-001', reason: '用法还是不对' }, {})
  log = await readFile(store.runLogPath, 'utf8')
  assert.match(log, /T-001 \| REJECTED \| 用法还是不对/)

  // ROLLBACK（task_accept rollback=true 真实回滚 git 提交）。
  data = await store.load()
  const claim = await claimTask({ store, backlog: data.backlog, task: data.backlog.tasks.find(t => t.id === 'T-002'), mode: 'manual', dirtyPaths: [] })
  await writeFile(join(dir, 'bad.txt'), 'bad\n')
  await commit(dir, 'feat(core): T-002 broken')
  const rolled = await acceptReport({
    store,
    reportText: reportBlock({
      NONCE: claim.nonce, RESULT: 'FAILED', TASK: 'T-002', START_SHA: claim.startSha,
      COMMITS: '—', TEST_CMD: '—', TEST_RESULT: '—', TEST_CHANGES: '—', GATE: '—',
      ACCEPTANCE: '—', ASSUMPTIONS: '—', DECISION: '—', BLOCKER: '故意失败', DERIVED: '—', BRIEF: '回滚。',
    }),
    rollback: true,
    config,
  })
  assert.match(rolled.rollbackInfo, /已回滚到/)
  log = await readFile(store.runLogPath, 'utf8')
  assert.match(log, /T-002 \| ROLLBACK \| git \| reset [0-9a-f]{8} \| ref=refs\/task-failed\/T-002-1/)
  assert.equal(await gitText(dir, ['rev-parse', 'HEAD']), claim.startSha.slice(0, 40))
  // 旧日志仍可解析：行格式仍是 `时间 | 文本`，早先没有事件名的行不受影响。
  assert.match(log, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \| START \| max=5 hours=8$/m)
  await rm(dir, { recursive: true, force: true })
}

async function main() {  const tests = [
    ['backlog store + add + parse', testBacklogStore],
    ['verify tests + weakening audit', testVerifyAndWeakening],
    ['loop start / inbox merge / decision report', testDecisionAndInbox],
    ['claim + accept happy path + nonce gate', testClaimAcceptHappy],
    ['file mode: claim + accept happy path', testFileModeHappy],
    ['file mode: FAIL_NEW baseline', testFileModeFailNew],
    ['file mode: weakening + rollback', testFileModeWeakeningAndRollback],
    ['halt / resume / requeue', testHaltResumeRequeue],
    ['待验证超时配置：缺省 7 / 0 关闭 / 旧 backlog 兼容', testVerifyTimeoutConfig],
    ['待验证：到期前提示 + 超时默认通过 + 不可达转待决策', testVerifyTimeoutPass],
    ['待验证：老报告待补 + 别默认通过 hold', testManualVerifyHold],
    ['自动验收：规则 a / 规则 b / 手动单步不自动验收', testAutoAcceptRules],
    ['衍生任务 P3 只录不做 + 安全例外入队', testDerivedP3Security],
    ['BASELINE_RED：修复任务 P3 只录不做 + 不计 noprog', testBaselineRedDerived],
    ['打回已归档任务：重开', testRejectReopenArchived],
    ['通知：默认静默 / 开关 / 命令注入 / 去重 / 超时 / 主流程接线', testNotifyPolicy],
    ['看门狗：IDLE / SPIN / OK 三态 + WATCHDOG 行 + 状态建议', testWatchdogStates],
    ['run.log 事件：DISPATCH / WATCHDOG / DECIDED / REJECTED / ROLLBACK', testRunLogEvents],
  ]
  for (const [name, fn] of tests) {
    try {
      await fn()
      results.push({ name, ok: true })
      console.log(`PASS  ${name}`)
    } catch (error) {
      results.push({ name, ok: false, error: String(error?.message ?? error) })
      console.log(`FAIL  ${name} :: ${String(error?.stack ?? error)}`)
    }
  }
  if (results.some(r => !r.ok)) process.exitCode = 1
}
main()
