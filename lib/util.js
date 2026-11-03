import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, readdir, rename, appendFile, rm, stat, symlink, access } from 'node:fs/promises'
import { constants as FS } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { randomBytes } from 'node:crypto'

export const now = () => new Date().toISOString()
export const day = () => new Date().toISOString().slice(0, 10)
export const month = () => new Date().toISOString().slice(0, 7)
export const epoch = () => Date.now()
export const nonce = () => randomBytes(4).toString('hex')

export async function exists(path) {
  try { await access(path, FS.F_OK); return true } catch { return false }
}
export async function isDir(path) {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

export async function readText(path) {
  return readFile(path, 'utf8')
}

export async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, 'utf8')
}

export async function appendText(path, text) {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, text, 'utf8')
}

export async function listDir(path) {
  try { return await readdir(path, { withFileTypes: true }) } catch { return [] }
}

export async function move(from, to) {
  await mkdir(dirname(to), { recursive: true })
  await rename(from, to)
}

export { rm, mkdir, symlink }

/** Split a markdown table row into trimmed cells, honouring escaped pipes. */
export function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  cells.push(cur.trim())
  return cells
}

export function cell(value) {
  return String(value ?? '—').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—'
}

export function isSeparatorRow(cells) {
  return cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))
}

export function isPlaceholderRow(cells) {
  return cells.length <= 2 && (cells[0] === '—' || cells[0] === '-' || cells[0] === '')
}

/** Run a process, capturing stdout+stderr, with a hard timeout and process-group kill. */
export function runProcess(command, args, opts = {}) {
  const {
    cwd = process.cwd(),
    timeoutMs = 120000,
    env = process.env,
    shell = false,
    maxBytes = 24 * 1024 * 1024,
  } = opts
  return new Promise(resolvePromise => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolvePromise({ code: -1, stdout: '', stderr: String(error?.message ?? error), timedOut: false, spawnError: true })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let truncated = false
    const push = (chunk, which) => {
      const text = chunk.toString()
      if (which === 'out') {
        if (stdout.length + text.length > maxBytes) { truncated = true } else { stdout += text }
      } else {
        if (stderr.length + text.length > maxBytes) { truncated = true } else { stderr += text }
      }
    }
    child.stdout.on('data', c => push(c, 'out'))
    child.stderr.on('data', c => push(c, 'err'))
    const killTree = signal => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch { try { child.kill(signal) } catch {} }
    }
    const timer = setTimeout(() => { timedOut = true; killTree('SIGTERM'); setTimeout(() => killTree('SIGKILL'), 3000).unref?.() }, Math.max(1, timeoutMs))
    timer.unref?.()
    const done = (code, signal, error) => {
      clearTimeout(timer)
      resolvePromise({ code, signal, stdout, stderr, timedOut, truncated, spawnError: !!error, error: error ? String(error.message ?? error) : undefined })
    }
    child.on('error', error => done(-1, null, error))
    child.on('close', (code, signal) => done(code ?? -1, signal, null))
  })
}

export async function git(cwd, args, opts = {}) {
  const res = await runProcess('git', args, { cwd, timeoutMs: 60000, ...opts })
  return { ...res, ok: res.code === 0, text: (res.stdout || '').trim() }
}

export async function gitText(cwd, args) {
  const res = await git(cwd, args)
  return res.code === 0 ? res.text : ''
}

export function relPath(root, path) {
  const rel = relative(root, resolve(root, path))
  return rel === '' ? '.' : rel
}

export function resolveInside(root, maybeRelative) {
  return isAbsolute(maybeRelative) ? maybeRelative : join(root, maybeRelative)
}

export function dedupeLines(lines) {
  return [...new Set(lines.filter(Boolean))]
}

export function truncate(text, max = 12000) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}\n…（已截断，共 ${s.length} 字符）` : s
}

export function tailLines(text, count = 20) {
  return String(text ?? '').split(/\r?\n/).slice(-count).join('\n')
}

export function normalizeTitle(title) {
  return String(title ?? '')
    .replace(/[`*_#>\[\]()]|（[^）]*）|\([^)]*\)/g, '')
    .replace(/[，,。；;：:、\s]+/g, '')
    .toLowerCase()
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$|(^|\/)conftest\.py$/
export const CFG_PATH_RE = /(^|\/)(pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|\.coveragerc|Makefile|package\.json|(vitest|vite|jest|playwright|karma)\.config\.[a-z]+)$/
