import { mkdtemp, writeFile, mkdir, readFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'
import { access } from 'node:fs/promises'
import { runProcess, gitText } from './lib/util.js'
import { TaskStore } from './lib/store.js'
import { addTasks, nextTask, claimTask, buildStatusReport, confirmTask } from './lib/tasks.js'
import { acceptReport } from './lib/accept.js'
import { verifyTests, checkTestWeakening } from './lib/verify.js'
import { mergeInbox, startLoop, loopTick, stopLoop, haltLoop, resumeHalted, requeueHalted } from './lib/loop.js'
import { currentWork } from './lib/tasks.js'

async function pathExists(p) { try { await access(p); return true } catch { return false } }

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

async function main() {
  const tests = [
    ['backlog store + add + parse', testBacklogStore],
    ['verify tests + weakening audit', testVerifyAndWeakening],
    ['loop start / inbox merge / decision report', testDecisionAndInbox],
    ['claim + accept happy path + nonce gate', testClaimAcceptHappy],
    ['file mode: claim + accept happy path', testFileModeHappy],
    ['file mode: FAIL_NEW baseline', testFileModeFailNew],
    ['file mode: weakening + rollback', testFileModeWeakeningAndRollback],
    ['halt / resume / requeue', testHaltResumeRequeue],
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
