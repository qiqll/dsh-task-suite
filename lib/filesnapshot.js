import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { git, now } from './util.js'

/**
 * Non-git task projects: a claim snapshots the working tree, and acceptance
 * diffs the current tree against that snapshot. The snapshot doubles as the
 * baseline used to re-run failing tests and as the rollback source.
 */

export const DEFAULT_IGNORE = new Set([
  '.git', '.hg', '.svn',
  'node_modules', '.venv', 'venv', 'env', '.tox',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache',
  'dist', 'build', '.next', '.nuxt', '.turbo', 'coverage', 'htmlcov',
  'target', '.DS_Store',
])

const DEP_LINKS = ['node_modules', 'frontend/node_modules', '.venv', 'venv', 'backend/venv', 'backend/.venv']

function norm(rel) {
  return String(rel ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isIgnored(rel, stateRel, extra = []) {
  const path = norm(rel)
  if (!path || path === '.') return false
  const state = norm(stateRel).replace(/\/+$/, '')
  if (state && (path === state || path.startsWith(`${state}/`))) return true
  const parts = path.split('/')
  if (parts.some(p => DEFAULT_IGNORE.has(p))) return true
  for (const pattern of extra) {
    if (typeof pattern !== 'string' || !pattern.trim()) continue
    const p = norm(pattern).replace(/\/+$/, '')
    if (p.includes('*')) {
      const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
      if (re.test(path)) return true
    } else if (path === p || path.startsWith(`${p}/`)) return true
  }
  return false
}

async function pathExists(path) {
  try { await access(path); return true } catch { return false }
}

function hashFile(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolveHash(hash.digest('hex')))
      .on('error', reject)
  })
}

async function readManifest(snapshotDir) {
  const path = join(snapshotDir, 'manifest.json')
  const text = await readFile(path, 'utf8')
  return JSON.parse(text)
}

async function writeManifest(snapshotDir, manifest) {
  await writeFile(join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

export async function detectMode(root, configured = 'auto') {
  if (configured === 'file') return 'file'
  if (configured === 'git') return 'git'
  const head = await git(root, ['rev-parse', '--verify', 'HEAD'])
  return head.ok ? 'git' : 'file'
}

/**
 * Copy the project (minus ignored dependency/build/state dirs) into
 * `<dest>/files` and record a hash manifest next to it.
 */
export async function snapshotProject({ root, dest, stateRel, ignore = [], maxBytes = 512 * 1024 * 1024, maxFiles = 20000 }) {
  const filesDir = join(dest, 'files')
  await mkdir(filesDir, { recursive: true })
  const manifest = { version: 1, created: now(), root, bytes: 0, count: 0, files: {} }

  const walk = async (dir, relBase) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name
      if (isIgnored(rel, stateRel, ignore)) continue
      const source = join(dir, entry.name)
      const target = join(filesDir, rel)
      if (entry.isDirectory()) {
        await mkdir(target, { recursive: true })
        await walk(source, rel)
      } else if (entry.isSymbolicLink()) {
        const link = await readlink(source)
        await mkdir(dirname(target), { recursive: true })
        await symlink(link, target).catch(() => {})
        manifest.files[rel] = { type: 'symlink', target: link }
        manifest.count += 1
      } else if (entry.isFile()) {
        const info = await lstat(source)
        manifest.bytes += info.size
        manifest.count += 1
        if (manifest.count > maxFiles) throw new Error(`项目文件数超过快照上限 ${maxFiles}（可通过 snapshotMaxFiles 调大，或把大目录加入 snapshotIgnore）`)
        if (manifest.bytes > maxBytes) throw new Error(`项目体积超过快照上限 ${Math.round(maxBytes / 1024 / 1024)}MB（可通过 snapshotMaxBytes 调大，或把大目录加入 snapshotIgnore）`)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(source, target)
        await chmod(target, info.mode).catch(() => {})
        manifest.files[rel] = { type: 'file', size: info.size, mode: info.mode, hash: await hashFile(target) }
      }
    }
  }

  try {
    await walk(root, '')
  } catch (error) {
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  await writeManifest(dest, manifest)
  return { dir: dest, filesDir, manifest }
}

async function walkCurrent(root, stateRel, ignore, visit) {
  const walk = async (dir, relBase) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name
      if (isIgnored(rel, stateRel, ignore)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, rel)
      else if (entry.isSymbolicLink()) await visit(rel, full, 'symlink')
      else if (entry.isFile()) await visit(rel, full, 'file')
    }
  }
  await walk(root, '')
}

/** Compute added/modified/deleted files between the claim snapshot and now. */
export async function diffAgainstSnapshot({ root, snapshot, stateRel, ignore = [] }) {
  const manifest = await readManifest(snapshot)
  const current = new Map()
  await walkCurrent(root, stateRel, ignore, async (rel, full, type) => {
    if (type === 'symlink') current.set(rel, { type, target: await readlink(full) })
    else {
      const info = await lstat(full)
      current.set(rel, { type, size: info.size, hash: await hashFile(full) })
    }
  })
  const added = []
  const modified = []
  const deleted = []
  for (const [rel, entry] of current) {
    const old = manifest.files[rel]
    if (!old) { added.push(rel); continue }
    if (entry.type !== old.type) { modified.push(rel); continue }
    if (entry.type === 'symlink') { if (entry.target !== old.target) modified.push(rel) }
    else if (entry.hash !== old.hash) modified.push(rel)
  }
  for (const rel of Object.keys(manifest.files)) {
    if (!current.has(rel)) deleted.push(rel)
  }
  added.sort(); modified.sort(); deleted.sort()
  return {
    added, modified, deleted,
    changed: [...added, ...modified, ...deleted].sort(),
    count: added.length + modified.length + deleted.length,
    snapshotTotal: Object.keys(manifest.files).length,
    bytes: manifest.bytes,
  }
}

async function copyTree(source, target) {
  await mkdir(target, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) await copyTree(from, to)
    else if (entry.isSymbolicLink()) await symlink(await readlink(from), to).catch(() => {})
    else if (entry.isFile()) {
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to)
      const info = await lstat(from)
      await chmod(to, info.mode).catch(() => {})
    }
  }
}

/** Materialize the snapshot in a temp dir and link dependencies from the real root. */
export async function makeBaselineCopy({ root, snapshot }) {
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-ts-file-base-'))
  try {
    await copyTree(join(snapshot, 'files'), tmp)
    for (const dir of DEP_LINKS) {
      if (await pathExists(join(root, dir)) && !(await pathExists(join(tmp, dir)))) {
        try { await symlink(resolve(root, dir), join(tmp, dir), 'dir') } catch {}
      }
    }
  } catch (error) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  return tmp
}

/**
 * Restore the snapshot. Current files that do not exist in the snapshot are
 * deleted, so callers must treat this as an explicit, destructive action.
 * A backup of the current tree is made first.
 */
export async function restoreSnapshot({ root, snapshot, stateRel, ignore = [], backupRoot }) {
  const manifest = await readManifest(snapshot)
  const backup = join(backupRoot, `rollback-${Date.now()}`, 'files')
  const current = []
  await walkCurrent(root, stateRel, ignore, async rel => { current.push(rel) })
  for (const rel of current) {
    const source = join(root, rel)
    const target = join(backup, rel)
    await mkdir(dirname(target), { recursive: true })
    try {
      const info = await lstat(source)
      if (info.isSymbolicLink()) await symlink(await readlink(source), target).catch(() => {})
      else if (info.isFile()) await copyFile(source, target)
    } catch {}
  }
  let restored = 0
  let deleted = 0
  for (const rel of current) {
    if (!manifest.files[rel]) {
      await rm(join(root, rel), { force: true }).catch(() => {})
      deleted += 1
    }
  }
  for (const [rel, entry] of Object.entries(manifest.files)) {
    const target = join(root, rel)
    await mkdir(dirname(target), { recursive: true })
    if (entry.type === 'symlink') {
      await rm(target, { force: true }).catch(() => {})
      await symlink(entry.target, target).catch(() => {})
    } else {
      await copyFile(join(snapshot, 'files', rel), target)
      await chmod(target, entry.mode ?? 0o644).catch(() => {})
    }
    restored += 1
  }
  return { restored, deleted, backup }
}

export async function pruneSnapshots({ snapshotsDir, keep = 10 }) {
  let entries
  try { entries = await readdir(snapshotsDir, { withFileTypes: true }) } catch { return 0 }
  const dirs = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(snapshotsDir, entry.name)
    try {
      const info = await lstat(full)
      dirs.push({ full, time: info.mtimeMs })
    } catch {}
  }
  dirs.sort((a, b) => b.time - a.time)
  let removed = 0
  for (const dir of dirs.slice(Math.max(0, keep))) {
    await rm(dir.full, { recursive: true, force: true }).catch(() => {})
    removed += 1
  }
  return removed
}

export async function removeSnapshot(snapshot, snapshotsDir) {
  if (!snapshot) return
  if (snapshotsDir) {
    const target = resolve(snapshot)
    const base = resolve(snapshotsDir)
    if (!target.startsWith(`${base}${sep}`)) return
  }
  await rm(snapshot, { recursive: true, force: true }).catch(() => {})
}

export async function snapshotInfo(snapshot) {
  try {
    const manifest = await readManifest(snapshot)
    return { count: manifest.count, bytes: manifest.bytes }
  } catch { return null }
}

export function snapshotRel(root, snapshot) {
  return relative(root, snapshot).replace(/\\/g, '/')
}
