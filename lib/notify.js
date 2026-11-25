/**
 * 主动通知（对齐 claude-task 0.3.9 的 skills/loop/notify.sh）。
 *
 * 任务进入「待决策 / 待验证 / 阻塞」以及循环停止时，各发一次系统通知。
 * - 默认静默：只有显式开启才发（`TASK_NOTIFY=on|1`；`off|0` 关闭；也给 config.notify）。
 * - 渠道：`TASK_NOTIFY_CMD`（任意命令，`sh -c` 执行，默认 10 秒超时，标题/文案作为 $1/$2）
 *   → macOS `osascript -e 'display notification …'` → Linux `notify-send` → 其他平台 no-op。
 * - 同一事件 + 任务 ID 去重（默认 600 秒，`TASK_NOTIFY_DEDUPE_SEC` / config 可调）。
 * - 文案 ≤100 字，附 `dsh-task -d <ID> "…"` 回复命令（停机用 `dsh-task --status`）。
 * - 失败只写 run.log 一行 WARN，绝不影响主流程。
 */
import { basename, join } from 'node:path'
import { epoch, readText, truncate, writeText, runProcess } from './util.js'

export const NOTIFY_LABELS = {
  decision: '待决策',
  verify: '待验证',
  blocked: '阻塞',
  stop: '循环停止',
}

const ON = new Set(['on', '1', 'true', 'yes'])
const OFF = new Set(['off', '0', 'false', 'no'])
const MAX_CHARS = 100
const DEDUPE_KEEP = 200
const DEDUPE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const chars = text => [...String(text ?? '')]
const charLen = text => chars(text).length
const sliceChars = (text, n) => chars(text).slice(0, Math.max(0, n)).join('')

function positive(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 环境变量优先于 config；未显式开启时保持静默。 */
export function notifySettings(config = {}, env = process.env) {
  const raw = String(env.TASK_NOTIFY ?? '').trim().toLowerCase()
  let enabled
  if (OFF.has(raw)) enabled = false
  else if (ON.has(raw)) enabled = true
  else enabled = config.notify === true || ON.has(String(config.notify ?? '').trim().toLowerCase())
  const cmd = String(env.TASK_NOTIFY_CMD ?? '').trim() || String(config.notifyCmd ?? '').trim()
  return {
    enabled,
    cmd,
    dedupeSec: positive(env.TASK_NOTIFY_DEDUPE_SEC, positive(config.notifyDedupeSec, 600)),
    timeoutMs: positive(env.TASK_NOTIFY_TIMEOUT_MS, positive(config.notifyTimeoutMs, 10000)),
    maxChars: MAX_CHARS,
  }
}

function cleanDetail(detail) {
  return String(detail ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[：:；;，,、\s]+/, '')
    .trim()
}

/** 文案 ≤100 字（按码点计），结尾总是回复命令。 */
export function composeNotifyMessage({ event, taskId, detail, maxChars = MAX_CHARS } = {}) {
  const label = NOTIFY_LABELS[event] || String(event ?? '事件')
  const reply = taskId ? `回复：dsh-task -d ${taskId} "…"` : '回复：dsh-task --status'
  const head = `${label}${taskId ? ` ${taskId}` : ''}：${cleanDetail(detail) || '需要你处理'}`
  const budget = Math.max(8, maxChars - charLen(reply) - 1)
  const body = charLen(head) > budget ? `${sliceChars(head, budget - 1)}…` : head
  return `${body}｜${reply}`
}

/** 渠道选择：自定义命令 > macOS > Linux > no-op。 */
export function pickChannel(settings = {}, platform = process.platform) {
  if (settings.cmd) return 'cmd'
  if (platform === 'darwin') return 'osascript'
  if (platform === 'linux') return 'notify-send'
  return 'none'
}

function commandFor(channel, cmd, title, message) {
  if (channel === 'cmd') return { command: 'sh', args: ['-c', `${cmd} "$@"`, 'task-notify', title, message] }
  if (channel === 'osascript') {
    return {
      command: 'osascript',
      args: [
        '-e', 'on run argv',
        '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
        '-e', 'end run',
        title, message,
      ],
    }
  }
  return { command: 'notify-send', args: ['--', title, message] }
}

async function send(channel, settings, title, message, env) {
  const { command, args } = commandFor(channel, settings.cmd, title, message)
  let res
  try {
    res = await runProcess(command, args, { timeoutMs: settings.timeoutMs, env: { ...process.env, ...env } })
  } catch (error) {
    return { ok: false, channel, reason: String(error?.message ?? error) }
  }
  if (res.spawnError) return { ok: false, channel, reason: `spawn ${command}: ${String(res.stderr || res.error || '').trim() || '失败'}` }
  if (res.timedOut) return { ok: false, channel, reason: `timeout ${settings.timeoutMs}ms`, timedOut: true }
  if (res.code !== 0) return { ok: false, channel, reason: `exit ${res.code}${res.stderr ? `: ${truncate(res.stderr.trim(), 120)}` : ''}` }
  return { ok: true, channel }
}

function notifiedPath(store) {
  return join(store.autoDir, 'notified.json')
}

async function readNotified(store) {
  try {
    const parsed = JSON.parse(await readText(notifiedPath(store)))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {}
  return {}
}

async function writeNotified(store, seen, nowMs) {
  const cutoff = nowMs - DEDUPE_MAX_AGE_MS
  const entries = Object.entries(seen)
    .filter(([, at]) => Number.isFinite(Number(at)) && Number(at) >= cutoff)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, DEDUPE_KEEP)
  const text = `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
  try { await writeText(notifiedPath(store), text) } catch {}
}

/**
 * 发一条通知。永不抛异常（主流程不受影响）。
 * @returns {Promise<{ok:boolean, skipped?:string, channel?:string, message?:string, key?:string, reason?:string}>}
 */
export async function notifyTask({
  store, config = store?.config || {}, event, taskId, detail, key, env = process.env, nowMs = epoch(),
} = {}) {
  const settings = notifySettings(config, env)
  if (!settings.enabled) return { ok: false, skipped: 'disabled', event, taskId }
  const dedupeKey = key || `${event}:${taskId || '-'}`
  try {
    const seen = await readNotified(store)
    const last = Number(seen[dedupeKey])
    if (Number.isFinite(last) && last > 0 && nowMs - last < settings.dedupeSec * 1000) {
      return { ok: false, skipped: 'duplicate', key: dedupeKey }
    }
    const channel = pickChannel(settings)
    if (channel === 'none') return { ok: false, skipped: 'no-channel', key: dedupeKey }
    const title = `task · ${basename(store.root)}`
    const message = composeNotifyMessage({ event, taskId, detail, maxChars: settings.maxChars })
    const sent = await send(channel, settings, title, message, env)
    if (!sent.ok) {
      try { await store.log(`${taskId || 'LOOP'} | NOTIFY | WARN | ${sent.reason} | ${truncate(message, 80)}`) } catch {}
      return { ok: false, skipped: 'failed', channel, reason: sent.reason, timedOut: !!sent.timedOut, key: dedupeKey, message }
    }
    seen[dedupeKey] = nowMs
    await writeNotified(store, seen, nowMs)
    return { ok: true, channel, message, key: dedupeKey }
  } catch (error) {
    try { await store.log(`${taskId || 'LOOP'} | NOTIFY | WARN | ${String(error?.message ?? error)}`) } catch {}
    return { ok: false, skipped: 'error', reason: String(error?.message ?? error), key: dedupeKey }
  }
}
