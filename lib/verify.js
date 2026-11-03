import { mkdtemp, rm, symlink, access, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute, relative, resolve, basename } from 'node:path'
import { runProcess, git, gitText, TEST_PATH_RE, CFG_PATH_RE, tailLines, truncate } from './util.js'
import { diffAgainstSnapshot, makeBaselineCopy } from './filesnapshot.js'

const BANNED = [' -k', '--deselect', '--ignore', '--lf', '--last-failed', '--co', '--collect-only', '-p no:', '--exitfirst=0', '--testNamePattern', ' -t ', '--passWithNoTests', 'exit ', ' true', 'echo ']

export function parseTestCommand(cmd) {
  const raw = String(cmd ?? '').trim()
  if (!raw) return { ok: false, reason: 'TEST_CMD 为空' }
  const m = /^cd\s+([^\s;|&]+)\s*&&\s*(.*)$/.exec(raw)
  const cddir = m ? m[1] : '.'
  const body = m ? m[2] : raw
  if (/[;|&`]|\$\(|>|</.test(body)) return { ok: false, reason: '只允许单条测试命令（可带 cd X && 前缀），不得含 ; | & ` $( 重定向', cddir, body }
  const cleaned = body.replace(/-p no:cacheprovider/g, '')
  for (const bad of BANNED) {
    if (` ${cleaned} `.includes(bad)) return { ok: false, reason: `含禁止参数「${bad.trim()}」（不得缩小范围或伪造成功）`, cddir, body }
  }
  return { ok: true, cddir, body, raw }
}

async function pathExists(path) {
  try { await access(path); return true } catch { return false }
}

export async function checkCoverage({ root, cddir, body, startSha, changed }) {
  const args = []
  for (const token of body.split(/\s+/)) {
    if (token.startsWith('-')) continue
    const p = token.split('::')[0]
    const full = resolve(root, cddir, p)
    if (await pathExists(full)) args.push(relative(root, full) || '.')
  }
  let scopes = args
  if (!scopes.length) scopes = [relative(root, resolve(root, cddir))]
  const files = changed ?? (await gitText(root, ['diff', '--name-only', '--diff-filter=AMR', `${startSha}`, 'HEAD'])).split(/\r?\n/).filter(Boolean)
  const uncovered = []
  for (const file of files) {
    if (!TEST_PATH_RE.test(file)) continue
    if (cddir !== '.' && !file.startsWith(`${cddir.replace(/^\.\//, '')}/`)) continue
    const ok = scopes.some(scope => scope === '.' || file === scope || file.startsWith(`${scope}/`))
    if (!ok) uncovered.push(file)
  }
  return uncovered
}

export function failedTestIds(output) {
  const ids = []
  for (const line of String(output ?? '').split(/\r?\n/)) {
    let m = /^(FAILED|ERROR) ([^ ]+)/.exec(line)
    if (m) { ids.push(m[2].replace(/ - .*$/, '')); continue }
    m = /^\s*(FAIL|×|✗) (.+)$/.exec(line)
    if (m && !/failing tests/.test(m[2])) { ids.push(m[2].replace(/ - .*$/, '').replace(/ \([0-9.]+ms\)$/, '').trim()); continue }
    m = /^\s*--- FAIL: ([^ ]+)/.exec(line)
    if (m) { ids.push(`go:${m[1]}`); continue }
    m = /^FAIL\s+([^\s]+)\s/.exec(line)
    if (m) { ids.push(`gopkg:${m[1]}`); continue }
    m = /^\s*✖ (.+)$/.exec(line)
    if (m) ids.push(m[1].replace(/ \([0-9.]+ms\)$/, '').trim())
  }
  return [...new Set(ids.filter(Boolean))].sort()
}

function failureSignature(output) {
  const lines = String(output ?? '').split(/\r?\n/).filter(l => /(Error|assert)/.test(l) && !/^\s+at /.test(l))
  const last = lines.at(-1)
  return last ? `SIG: ${last.trim()}` : ''
}

async function runIn(root, cddir, body, timeoutMs) {
  const cwd = resolve(root, cddir)
  if (!(await pathExists(cwd))) return { missing: true, code: -1, output: `目录不存在: ${cwd}` }
  const res = await runProcess('bash', ['-c', body], { cwd, timeoutMs })
  const output = `${res.stdout}${res.stderr}`
  return { ...res, output, cwd }
}

async function baselineBody(root, wt, cddir, body) {
  const tokens = []
  for (const token of body.split(/\s+/)) {
    if (token.startsWith('-')) { tokens.push(token); continue }
    const rel = token.split('::')[0]
    if (rel.includes('/') && (await pathExists(resolve(root, cddir, rel))) && !(await pathExists(resolve(wt, cddir, rel)))) continue
    tokens.push(token)
  }
  return tokens.join(' ')
}

export async function verifyTests({ root, startSha, testCmd, timeoutSec = 900, signal, mode = 'git', snapshot, stateRel, ignore = [] }) {
  const parsed = parseTestCommand(testCmd)
  if (!parsed.ok) return { verdict: 'REJECT_CMD', reason: parsed.reason, failures: [], preexisting: [], output: '' }
  let changedFiles
  if (mode === 'file') {
    if (!snapshot || !(await pathExists(join(snapshot, 'manifest.json')))) {
      return { verdict: 'REJECT_CMD', reason: '基线快照不存在，无法做非 git 验收（请重新认领任务）', failures: [], preexisting: [], output: '' }
    }
    const diff = await diffAgainstSnapshot({ root, snapshot, stateRel, ignore })
    changedFiles = diff.changed
  } else {
    const valid = await git(root, ['cat-file', '-e', `${startSha}^{commit}`])
    if (!valid.ok) return { verdict: 'REJECT_CMD', reason: `start_sha 无效或不存在: ${startSha}`, failures: [], preexisting: [], output: '' }
  }
  const cddirExists = await pathExists(resolve(root, parsed.cddir))
  if (!cddirExists) return { verdict: 'REJECT_CMD', reason: `cd 目录不存在: ${parsed.cddir}`, failures: [], preexisting: [], output: '' }
  const uncovered = await checkCoverage({ root, cddir: parsed.cddir, body: parsed.body, startSha, changed: changedFiles })
  if (uncovered.length) return { verdict: 'REJECT_CMD', reason: `改动的测试文件不在命令范围内: ${uncovered.join(', ')}`, failures: [], preexisting: [], output: '' }

  const run = await runIn(root, parsed.cddir, parsed.body, Math.max(1, timeoutSec) * 1000)
  if (run.timedOut) return { verdict: 'FAIL_TIMEOUT', failures: [], preexisting: [], output: truncate(run.output), missing: run.missing }
  if (run.missing) return { verdict: 'FAIL_UNPARSED', reason: run.output, failures: [], preexisting: [], output: run.output }
  if (run.code === 0) return { verdict: 'PASS', failures: [], preexisting: [], output: truncate(run.output), tail: tailLines(run.output, 15) }

  let failures = failedTestIds(run.output)
  const signature = failures.length ? '' : failureSignature(run.output)
  if (!failures.length && !signature) return { verdict: 'FAIL_UNPARSED', failures: [], preexisting: [], output: truncate(run.output) }
  if (!failures.length && signature) failures = [signature]

  // Compare against the baseline: git worktree, or a copy of the file snapshot.
  let wt
  let isWorktree = false
  try {
    if (mode === 'file') {
      wt = await makeBaselineCopy({ root, snapshot })
    } else {
      wt = await mkdtemp(join(tmpdir(), 'dsh-ts-base-'))
      const added = await git(root, ['worktree', 'add', '-q', '--detach', wt, startSha], { timeoutMs: 120000 })
      if (!added.ok) return { verdict: 'FAIL_UNPARSED', reason: `无法建基线 worktree: ${added.text}`, failures, preexisting: [], output: truncate(run.output) }
      isWorktree = true
      for (const dir of ['venv', '.venv', 'backend/venv', 'backend/.venv', 'node_modules', 'frontend/node_modules']) {
        if (await pathExists(join(root, dir)) && !(await pathExists(join(wt, dir)))) {
          try { await symlink(join(root, dir), join(wt, dir), 'dir') } catch {}
        }
      }
    }
    const baselineCmd = await baselineBody(root, wt, parsed.cddir, parsed.body)
    const base = await runIn(wt, parsed.cddir, baselineCmd, Math.max(1, timeoutSec) * 1000)
    let baseFailures = failedTestIds(base.output)
    if (failures.some(f => f.startsWith('SIG:'))) baseFailures = [failureSignature(base.output)]
    if (base.timedOut) return { verdict: 'FAIL_TIMEOUT', reason: '基线超时，无法比对', failures, preexisting: [], output: truncate(run.output) }
    const preexisting = failures.filter(f => baseFailures.includes(f))
    const fresh = failures.filter(f => !baseFailures.includes(f))
    if (fresh.length) return { verdict: 'FAIL_NEW', failures: fresh, preexisting, output: truncate(run.output), tail: tailLines(run.output, 15) }
    return { verdict: 'PASS_PREEXISTING', failures: preexisting, preexisting, output: truncate(run.output), tail: tailLines(run.output, 15) }
  } finally {
    if (wt) {
      if (isWorktree) await git(root, ['worktree', 'remove', '--force', wt], { timeoutMs: 120000 })
      await rm(wt, { recursive: true, force: true }).catch(() => {})
    }
  }
}

const NAME_RE = /def (test_[A-Za-z0-9_]+)|(it|test|describe)(\.[a-z]+)?\((['"`])([^'"`]+)/g
const ASSERT_RE = /\bassert\b|expect\(|assert[A-Z][A-Za-z]*\(|pytest\.raises|self\.fail\(/
const SKIP_RE = /pytest\.mark\.(skip|skipif|xfail)|pytest\.(skip|xfail)\(|unittest\.skip|\.(skip|only|todo)\(|\b(xit|xdescribe|xtest|fit|fdescribe)\(/

function testNames(text) {
  const out = new Set()
  for (const line of text.split(/\r?\n/)) {
    const re = new RegExp(NAME_RE.source, 'g')
    let m
    while ((m = re.exec(line)) !== null) out.add(m[1] || m[5])
  }
  return out
}

function diffLines(root, base, head) {
  return git(root, ['diff', '-U0', base, head], { timeoutMs: 60000 })
}

function analyzeTestTexts(oldText, newText, file, warnings) {
  const minus = String(oldText ?? '').split(/\r?\n/)
  const plus = String(newText ?? '').split(/\r?\n/)
  const nonComment = lines => lines.filter(l => !/^\s*(#|\/\/|\*|\/\*)/.test(l))
  const gone = [...testNames(nonComment(minus).join('\n'))].filter(n => !testNames(nonComment(plus).join('\n')).has(n))
  if (gone.length) warnings.push(`${file} 消失的用例: ${gone.join(', ')}`)
  const oldLines = new Set(nonComment(minus).map(l => l.trim()))
  const commented = plus.filter(l => /^\s*(#|\/\/)/.test(l) && (ASSERT_RE.test(l) || testNames(l).size) && !oldLines.has(l.trim())).length
  if (commented) warnings.push(`${file} 有 ${commented} 行用例/断言被注释掉`)
  const oldSkips = new Set(nonComment(minus).filter(l => SKIP_RE.test(l)).map(l => l.trim()))
  const skips = nonComment(plus).filter(l => SKIP_RE.test(l) && !oldSkips.has(l.trim())).length
  if (skips) warnings.push(`${file} 新增 ${skips} 处 skip/xfail/only 标记`)
  const removedAssert = nonComment(minus).filter(l => ASSERT_RE.test(l)).length
  const addedAssert = nonComment(plus).filter(l => ASSERT_RE.test(l)).length
  if (removedAssert > addedAssert) warnings.push(`${file} 断言净减少（-${removedAssert} +${addedAssert}）`)
}

async function checkTestWeakeningFiles({ root, snapshot, stateRel, ignore = [] }) {
  const warnings = []
  const diff = await diffAgainstSnapshot({ root, snapshot, stateRel, ignore })
  const readOld = async rel => {
    try { return await readFile(join(snapshot, 'files', rel), 'utf8') } catch { return null }
  }
  const readNew = async rel => {
    try { return await readFile(join(root, rel), 'utf8') } catch { return null }
  }
  const pairs = []
  const deletedTests = diff.deleted.filter(p => TEST_PATH_RE.test(p))
  const addedTests = diff.added.filter(p => TEST_PATH_RE.test(p))
  const addedOthers = diff.added.filter(p => !TEST_PATH_RE.test(p))
  for (const oldPath of deletedTests) {
    const renamed = addedTests.find(p => basename(p) === basename(oldPath))
    if (renamed) { pairs.push([oldPath, renamed]); continue }
    const moved = addedOthers.find(p => basename(p) === basename(oldPath))
    if (moved) warnings.push(`测试文件被移出测试路径 ${oldPath} → ${moved}`)
    else warnings.push(`删除了测试文件 ${oldPath}`)
  }
  for (const file of diff.modified.filter(p => TEST_PATH_RE.test(p))) pairs.push([file, file])
  for (const [oldPath, newPath] of pairs) {
    const oldText = await readOld(oldPath)
    const newText = await readNew(newPath)
    if (oldText === null || newText === null) continue
    analyzeTestTexts(oldText, newText, newPath, warnings)
  }
  for (const file of diff.changed) {
    if (!(CFG_PATH_RE.test(file) || /(^|\/)conftest\.py$/.test(file))) continue
    const oldText = await readOld(file)
    const newText = await readNew(file)
    if (newText === null) continue
    const oldLines = new Set(String(oldText ?? '').split(/\r?\n/))
    const hits = newText.split(/\r?\n/).filter(l => !oldLines.has(l) && /--deselect|--ignore|-k |collect_ignore|addopts|exclude|testPathIgnorePatterns|testIgnore|skip|xfail/.test(l))
    if (hits.length) warnings.push(`${file} 新增测试忽略/筛选配置: ${hits.slice(0, 3).map(l => l.trim()).join(' ')}`)
  }
  return { warnings: [...new Set(warnings)], verdict: warnings.length ? 'WARN' : 'OK' }
}

export async function checkTestWeakening({ root, startSha, head = 'HEAD', mode = 'git', snapshot, stateRel, ignore = [] }) {
  if (mode === 'file') return checkTestWeakeningFiles({ root, snapshot, stateRel, ignore })
  const warnings = []
  const status = await git(root, ['diff', '--name-status', '-M', startSha, head])
  if (!status.ok) return { warnings: [`无法读取 diff: ${status.text}`], verdict: 'ERROR' }
  const pairs = []
  for (const line of status.text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    const st = parts[0]
    const a = parts[1]
    const b = parts[2]
    if (st === 'D' && TEST_PATH_RE.test(a)) warnings.push(`删除了测试文件 ${a}`)
    else if (st.startsWith('R') && TEST_PATH_RE.test(a)) {
      if (TEST_PATH_RE.test(b)) pairs.push([a, b])
      else warnings.push(`测试文件被移出测试路径 ${a} → ${b}`)
    } else if (st === 'M' && TEST_PATH_RE.test(a)) pairs.push([a, a])
  }
  for (const [oldPath, newPath] of pairs) {
    const d = await diffLines(root, `${startSha}:${oldPath}`, `HEAD:${newPath}`)
    if (!d.ok) continue
    const minus = []
    const plus = []
    for (const line of d.text.split(/\r?\n/)) {
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('-') && !line.startsWith('--')) minus.push(line.slice(1))
      else if (line.startsWith('+') && !line.startsWith('++')) plus.push(line.slice(1))
    }
    const nonComment = lines => lines.filter(l => !/^\s*(#|\/\/|\*|\/\*)/.test(l))
    const gone = [...testNames(nonComment(minus).join('\n'))].filter(n => !testNames(nonComment(plus).join('\n')).has(n))
    if (gone.length) warnings.push(`${newPath} 消失的用例: ${gone.join(', ')}`)
    const commented = plus.filter(l => /^\s*(#|\/\/)/.test(l) && (ASSERT_RE.test(l) || testNames(l).size)).length
    if (commented) warnings.push(`${newPath} 有 ${commented} 行用例/断言被注释掉`)
    const skips = nonComment(plus).filter(l => SKIP_RE.test(l)).length
    if (skips) warnings.push(`${newPath} 新增 ${skips} 处 skip/xfail/only 标记`)
    const removedAssert = nonComment(minus).filter(l => ASSERT_RE.test(l)).length
    const addedAssert = nonComment(plus).filter(l => ASSERT_RE.test(l)).length
    if (removedAssert > addedAssert) warnings.push(`${newPath} 断言净减少（-${removedAssert} +${addedAssert}）`)
  }
  // Test config that newly ignores or deselects cases.
  const changed = (await gitText(root, ['diff', '--name-only', startSha, head])).split(/\r?\n/).filter(Boolean)
  for (const file of changed) {
    if (!(CFG_PATH_RE.test(file) || /(^|\/)conftest\.py$/.test(file))) continue
    const d = await git(root, ['diff', '-U0', startSha, head, '--', file], { timeoutMs: 60000 })
    const hits = []
    for (const line of d.text.split(/\r?\n/)) {
      if (!line.startsWith('+') || line.startsWith('++')) continue
      if (/--deselect|--ignore|-k |collect_ignore|addopts|exclude|testPathIgnorePatterns|testIgnore|skip|xfail/.test(line)) hits.push(line.slice(1).trim())
    }
    if (hits.length) warnings.push(`${file} 新增测试忽略/筛选配置: ${hits.slice(0, 3).join(' ')}`)
  }
  return { warnings: [...new Set(warnings)], verdict: warnings.length ? 'WARN' : 'OK' }
}

const RISKY_RE = /migration|alembic|\/models\/|auth|security|crypto|secret|billing|quota|pricing|Dockerfile|docker-compose|nginx|\.github\/|requirements.*\.txt/i

export function riskyPaths(paths) {
  return paths.filter(p => RISKY_RE.test(p))
}

export async function changedPaths(root, startSha, head = 'HEAD') {
  return (await gitText(root, ['diff', '--name-only', `${startSha}`, head])).split(/\r?\n/).filter(Boolean)
}

export async function commitsInRange(root, startSha, head = 'HEAD') {
  const out = await gitText(root, ['log', '--format=%H%x09%s', `${startSha}..${head}`])
  return out.split(/\r?\n/).filter(Boolean).map(line => {
    const [sha, ...rest] = line.split('\t')
    return { sha, subject: rest.join('\t') }
  })
}

export async function dirtyPaths(root) {
  const out = await gitText(root, ['status', '--porcelain'])
  return out.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim()).filter(Boolean)
}

export async function diffNameOnly(root, startSha, head = 'HEAD') {
  return (await gitText(root, ['diff', '--name-only', startSha, head])).split(/\r?\n/).filter(Boolean)
}
