import { join, dirname } from 'node:path'
import { readFile, readdir, rename, mkdir, access, writeFile, appendFile } from 'node:fs/promises'
import { exists, isDir, readText, writeText, appendText, listDir, move, now, epoch, month } from './util.js'
import { BACKLOG_TEMPLATE, PROGRESS_TEMPLATE, parseBacklog, renderBacklog, completedIds, renderPlan, appendProgress, STATUS } from './markdown.js'

export class TaskError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TaskError'
    this.code = code
  }
}

export function normalizeConfig(config = {}) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    stateDir: typeof c.stateDir === 'string' && c.stateDir.trim() ? c.stateDir.trim() : '.dsh/tasks',
    testTimeoutSec: Number.isFinite(Number(c.testTimeoutSec)) && Number(c.testTimeoutSec) > 0 ? Number(c.testTimeoutSec) : 900,
    defaultMaxTasks: Number.isFinite(Number(c.defaultMaxTasks)) && Number(c.defaultMaxTasks) > 0 ? Number(c.defaultMaxTasks) : 10,
    defaultMaxHours: Number.isFinite(Number(c.defaultMaxHours)) && Number(c.defaultMaxHours) > 0 ? Number(c.defaultMaxHours) : 8,
    maxNoprog: Number.isFinite(Number(c.maxNoprog)) && Number(c.maxNoprog) > 0 ? Number(c.maxNoprog) : 3,
    maxDerivedPerParent: Number.isFinite(Number(c.maxDerivedPerParent)) && Number(c.maxDerivedPerParent) > 0 ? Number(c.maxDerivedPerParent) : 3,
    maxDerivedDepth: Number.isFinite(Number(c.maxDerivedDepth)) && Number(c.maxDerivedDepth) >= 0 ? Number(c.maxDerivedDepth) : 2,
    mode: ['auto', 'git', 'file'].includes(c.mode) ? c.mode : 'auto',
    snapshotMaxBytes: Number.isFinite(Number(c.snapshotMaxBytes)) && Number(c.snapshotMaxBytes) > 0 ? Number(c.snapshotMaxBytes) : 512 * 1024 * 1024,
    snapshotMaxFiles: Number.isFinite(Number(c.snapshotMaxFiles)) && Number(c.snapshotMaxFiles) > 0 ? Number(c.snapshotMaxFiles) : 20000,
    snapshotKeep: Number.isFinite(Number(c.snapshotKeep)) && Number(c.snapshotKeep) >= 0 ? Number(c.snapshotKeep) : 10,
    snapshotIgnore: Array.isArray(c.snapshotIgnore) ? c.snapshotIgnore.filter(x => typeof x === 'string') : [],
  }
}

export class TaskStore {
  constructor(root, config) {
    this.root = root
    this.config = normalizeConfig(config)
    this.dir = this.config.stateDir.startsWith('/') ? this.config.stateDir : join(root, this.config.stateDir)
    this.backlogPath = join(this.dir, 'backlog.md')
    this.planPath = join(this.dir, 'dev-plan.md')
    this.progressPath = join(this.dir, 'dev-progress.md')
    this.inboxDir = join(this.dir, 'inbox')
    this.mergedDir = join(this.dir, 'inbox', '.merged')
    this.autoDir = join(this.dir, 'auto')
    this.currentPath = join(this.autoDir, 'current.json')
    this.sessionPath = join(this.autoDir, 'session.json')
    this.runLogPath = join(this.autoDir, 'run.log')
    this.stopPath = join(this.autoDir, 'STOP')
    this.snapshotsDir = join(this.autoDir, 'snapshots')
  }

  rel(path) {
    return path.startsWith(this.root) ? path.slice(this.root.length + 1) : path
  }

  async initialized() {
    return exists(this.backlogPath)
  }

  async ensureInitialized() {
    if (!(await this.initialized())) {
      throw new TaskError('NO_TASK_POOL', `任务池未初始化：${this.rel(this.backlogPath)} 不存在。请先调用 task_init。`)
    }
  }

  async init() {
    const created = []
    const skipped = []
    await mkdir(this.inboxDir, { recursive: true })
    await mkdir(this.autoDir, { recursive: true })
    await mkdir(this.snapshotsDir, { recursive: true })
    for (const [path, template] of [
      [this.backlogPath, BACKLOG_TEMPLATE],
      [this.progressPath, PROGRESS_TEMPLATE.replace('YYYY-MM', month())],
    ]) {
      if (await exists(path)) skipped.push(this.rel(path))
      else { await writeText(path, template); created.push(this.rel(path)) }
    }
    if (!(await exists(this.planPath))) {
      await writeText(this.planPath, renderPlan({ batches: [], current: null, todoCounts: {}, date: new Date().toISOString().slice(0, 10) }))
      created.push(this.rel(this.planPath))
    } else skipped.push(this.rel(this.planPath))

    // Runtime state is not committed by default. Only touch .gitignore when
    // the project actually has git metadata; a plain directory needs no git file.
    if (await exists(join(this.root, '.git'))) {
      const gitignore = join(this.root, '.gitignore')
      const line = `${this.config.stateDir.replace(/\/+$/, '')}/`
      try {
        const current = (await exists(gitignore)) ? await readText(gitignore) : ''
        if (!current.split(/\r?\n/).includes(line)) {
          const prefix = current && !current.endsWith('\n') ? '\n' : ''
          await writeText(gitignore, `${current}${prefix}# DSH task suite runtime state\n${line}\n`)
        }
      } catch {}
    }

    return { dir: this.rel(this.dir), created, skipped }
  }

  async readBacklog() {
    if (!(await exists(this.backlogPath))) throw new TaskError('NO_TASK_POOL', `任务池未初始化：${this.rel(this.backlogPath)} 不存在。请先调用 task_init。`)
    const text = await readText(this.backlogPath)
    const parsed = parseBacklog(text)
    parsed.text = text
    return parsed
  }

  async saveBacklog(parsed) {
    const text = renderBacklog(parsed)
    await writeText(this.backlogPath, text)
    return text
  }

  async readPlan() {
    return (await exists(this.planPath)) ? await readText(this.planPath) : ''
  }

  async writePlan(text) {
    await writeText(this.planPath, text)
  }

  async readProgress() {
    return (await exists(this.progressPath)) ? await readText(this.progressPath) : ''
  }

  async writeProgress(text) {
    await writeText(this.progressPath, text)
  }

  async archivedIds() {
    return completedIds(await this.readProgress())
  }

  async readCurrent() {
    if (!(await exists(this.currentPath))) return null
    try { return JSON.parse(await readText(this.currentPath)) } catch { return null }
  }

  async writeCurrent(current) {
    await writeText(this.currentPath, `${JSON.stringify(current, null, 2)}\n`)
  }

  async clearCurrent() {
    try { await rename(this.currentPath, join(this.autoDir, `current-${epoch()}.json.done`)) } catch {}
  }

  async readSession() {
    if (!(await exists(this.sessionPath))) return null
    try { return JSON.parse(await readText(this.sessionPath)) } catch { return null }
  }

  async writeSession(session) {
    await writeText(this.sessionPath, `${JSON.stringify(session, null, 2)}\n`)
  }

  async log(line) {
    await appendText(this.runLogPath, `${new Date().toISOString()} | ${line}\n`)
  }

  async logTail(count = 8) {
    if (!(await exists(this.runLogPath))) return []
    return (await readText(this.runLogPath)).trim().split(/\r?\n/).slice(-count)
  }

  async stopRequested() {
    return exists(this.stopPath)
  }

  async requestStop(reason = 'user') {
    await writeText(this.stopPath, `${new Date().toISOString()} ${reason}\n`)
  }

  async clearStop() {
    try { await deleteFile(this.stopPath) } catch {}
  }

  async readInbox() {
    const entries = []
    for (const entry of await listDir(this.inboxDir)) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue
      if (!entry.name.endsWith('.md')) continue
      const path = join(this.inboxDir, entry.name)
      const text = await readText(path)
      const meta = {}
      let body = text
      if (text.startsWith('---')) {
        const end = text.indexOf('\n---', 3)
        if (end >= 0) {
          for (const line of text.slice(3, end).split(/\r?\n/)) {
            const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim())
            if (m) meta[m[1]] = m[2].trim()
          }
          body = text.slice(end + 4).replace(/^\r?\n/, '')
        }
      }
      entries.push({
        file: entry.name,
        path,
        type: meta.type || 'task',
        ref: meta.ref || undefined,
        priority: meta.priority || undefined,
        module: meta.module || undefined,
        acceptance: meta.acceptance || undefined,
        title: meta.title || undefined,
        body: body.trim(),
      })
    }
    entries.sort((a, b) => a.file.localeCompare(b.file))
    return entries
  }

  async writeInbox({ type = 'task', ref, priority, module, acceptance, title, body }) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
    const rand = Math.random().toString(16).slice(2, 6)
    const name = `${stamp}-${rand}-${type}.md`
    const meta = ['---', `type: ${type}`, ...(ref ? [`ref: ${ref}`] : []), ...(priority ? [`priority: ${priority}`] : []), ...(module ? [`module: ${module}`] : []), ...(acceptance ? [`acceptance: ${acceptance}`] : []), ...(title ? [`title: ${title}`] : []), '---', ''].join('\n')
    const path = join(this.inboxDir, name)
    await writeText(path, `${meta}${body}\n`)
    return { path, file: name }
  }

  async archiveInbox(entry) {
    await mkdir(this.mergedDir, { recursive: true })
    const target = join(this.mergedDir, entry.file)
    try { await move(entry.path, target) } catch {}
  }

  async load() {
    const backlog = await this.readBacklog()
    const [progress, plan, current, session] = await Promise.all([
      this.readProgress(), this.readPlan(), this.readCurrent(), this.readSession(),
    ])
    const archived = completedIds(progress)
    const counts = { P0: 0, P1: 0, P2: 0, P3: 0, verify: 0, blocked: 0, decision: 0, doing: 0 }
    for (const t of backlog.tasks) {
      counts[t.priority] = (counts[t.priority] || 0) + 1
      if (t.status === STATUS.VERIFY) counts.verify++
      else if (t.status === STATUS.BLOCKED) counts.blocked++
      else if (t.status === STATUS.DECISION) counts.decision++
      else if (t.status === STATUS.DOING) counts.doing++
    }
    return { backlog, progress, plan, current, session, archived, counts }
  }
}

async function deleteFile(path) {
  const { unlink } = await import('node:fs/promises')
  await unlink(path)
}

export function progressEntry({ task, date, priority, module, conclusion, commits, gate, leftover, derived }) {
  return `### ${task} ${conclusion.title}

**完成：** ${date} · **优先级：** ${priority} · **模块：** ${module}
**结论：** ${conclusion.text}
**Commits：** ${commits}
**门禁：** ${gate}
**遗留：** ${leftover || '无'}${derived ? `\n**衍生：** ${derived}` : ''}`
}

export { appendProgress }
