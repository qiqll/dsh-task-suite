window.__ModuleLoader__.load({
  id: 'dsh-task-suite',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useState } = React

    const STATUS_TONE = {
      '待开始': 'idle',
      '进行中': 'run',
      '待验证': 'warn',
      '阻塞': 'error',
      '待决策': 'warn',
      '打回': 'error',
      '已完成': 'ok',
      '已取消': 'idle',
    }
    const LOOP_TEXT = {
      running: '运行中',
      stopped: '已停止',
      halted: '已叫停',
      idle: '空闲',
      uninitialized: '未初始化',
    }
    const LOOP_TONE = {
      running: 'run',
      stopped: 'idle',
      halted: 'error',
      idle: 'idle',
      uninitialized: 'warn',
    }
    const PRIORITY_TONE = { P0: 'error', P1: 'warn', P2: 'idle', P3: 'idle' }

    function toneColor(tone) {
      if (tone === 'run') return 'var(--dsw-alias-brand-primary)'
      if (tone === 'ok') return 'var(--dsw-alias-state-success-primary)'
      if (tone === 'warn') return 'var(--dsw-alias-state-warn-primary)'
      if (tone === 'error') return 'var(--dsw-alias-state-error-primary)'
      return 'var(--dsw-alias-label-secondary)'
    }

    function duration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '—'
      const sec = Math.floor(ms / 1000)
      if (sec < 60) return `${sec}s`
      const min = Math.floor(sec / 60)
      if (min < 60) return `${min}m ${sec % 60}s`
      const hour = Math.floor(min / 60)
      if (hour < 24) return `${hour}h ${min % 60}m`
      return `${Math.floor(hour / 24)}d ${hour % 24}h`
    }

    function clock(iso) {
      const time = Date.parse(iso || '')
      if (!Number.isFinite(time)) return '—'
      return new Date(time).toLocaleTimeString('zh-CN', { hour12: false })
    }

    function timeAgo(iso) {
      const time = Date.parse(iso || '')
      if (!Number.isFinite(time)) return '—'
      return duration(Date.now() - time)
    }

    function since(value) {
      const time = typeof value === 'number' ? value : Date.parse(value || '')
      return Number.isFinite(time) ? duration(Date.now() - time) : '—'
    }

    function Pill({ tone = 'idle', children, title }) {
      return h('span', {
        className: 'dts-pill',
        title,
        style: {
          color: toneColor(tone),
          borderColor: `color-mix(in srgb, ${toneColor(tone)} 40%, transparent)`,
          background: `color-mix(in srgb, ${toneColor(tone)} 12%, transparent)`,
        },
      }, h('span', { className: 'dts-dot', style: { background: toneColor(tone) } }), children)
    }

    function Stat({ label, value, tone = 'idle', hint }) {
      return h('div', { className: 'dts-stat', title: hint || label },
        h('div', { className: 'dts-stat-value', style: { color: toneColor(tone) } }, value),
        h('div', { className: 'dts-stat-label' }, label))
    }

    function TaskRow({ task }) {
      const [open, setOpen] = useState(false)
      return h('div', {
        className: `dts-task ${task.current ? 'dts-task-current' : ''}`,
        onClick: () => setOpen(v => !v),
        role: 'button',
        tabIndex: 0,
        onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v) } },
      },
        h('div', { className: 'dts-task-line' },
          h('span', { className: 'dts-priority', style: { color: toneColor(PRIORITY_TONE[task.priority] || 'idle') } }, task.priority || '—'),
          h('span', { className: 'dts-task-id' }, task.id),
          h('span', { className: 'dts-task-title' }, task.title),
          h(Pill, { tone: STATUS_TONE[task.status] || 'idle' }, task.status)),
        h('div', { className: 'dts-task-meta' },
          h('span', null, task.module || '—'),
          task.current ? h('span', { className: 'dts-current-label' }, '当前') : null,
          task.derivedFrom ? h('span', null, `衍生自 ${task.derivedFrom}`) : null,
          task.acceptance ? h('span', { className: 'dts-acceptance' }, `验收 ${task.acceptance}`) : null),
        open ? h('div', { className: 'dts-task-detail' },
          task.note || '无备注',
          task.deps && task.deps !== '—' ? h('div', { className: 'dts-kv' }, h('span', null, '依赖'), h('span', null, task.deps)) : null,
        ) : null)
    }

    function AgentRow({ agent }) {
      const active = agent.activity === 'running' || agent.activity === 'live'
      return h('div', { className: 'dts-agent', style: { paddingLeft: `${8 + Math.min(Number(agent.depth) || 0, 3) * 12}px` } },
        h('span', { className: 'dts-dot', style: { background: active ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)' } }),
        h('span', { className: 'dts-agent-label', title: agent.id }, agent.label || String(agent.id).slice(0, 8)),
        h('span', { className: 'dts-agent-meta' }, agent.kind === 'main' ? '主 agent' : (agent.mode || 'subagent'), ' · ', active ? '运行中' : '待命'))
    }

    function TaskSection({ tasks, filter, setFilter, counts }) {
      const filters = [
        ['active', `在办 ${Number(counts.todo || 0) + Number(counts.doing || 0) + Number(counts.verify || 0) + Number(counts.blocked || 0) + Number(counts.decision || 0) + Number(counts.rework || 0)}`],
        ['todo', `待开始 ${counts.todo || 0}`],
        ['doing', `进行中 ${counts.doing || 0}`],
        ['verify', `待验证 ${counts.verify || 0}`],
        ['blocked', `阻塞 ${counts.blocked || 0}`],
        ['decision', `待决策 ${counts.decision || 0}`],
      ]
      const shown = useMemo(() => {
        if (filter === 'active') return tasks.filter(t => t.active)
        return tasks.filter(t => ({ todo: '待开始', doing: '进行中', verify: '待验证', blocked: '阻塞', decision: '待决策' }[filter] || '') === t.status)
      }, [tasks, filter])
      return h('section', { className: 'dts-section' },
        h('div', { className: 'dts-section-head' },
          h('span', null, '任务清单'),
          h('span', { className: 'dts-count' }, `${shown.length} 条`)),
        h('div', { className: 'dts-filters' },
          filters.map(([key, label]) => h('button', {
            key,
            className: `dts-filter ${filter === key ? 'dts-filter-active' : ''}`,
            onClick: () => setFilter(key),
          }, label))),
        shown.length ? h('div', { className: 'dts-list' }, shown.map(task => h(TaskRow, { key: task.id, task })))
          : h('div', { className: 'dts-empty' }, '这个筛选下没有任务。'))
    }

    function Dashboard({ scope, visible }) {
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [filter, setFilter] = useState('active')
      const [refresh, setRefresh] = useState(0)
      const [loading, setLoading] = useState(true)
      const sessionId = scope?.sessionId || ''
      const cwd = scope?.cwd || ''

      useEffect(() => {
        if (!visible) return
        let alive = true
        const load = async () => {
          try {
            const url = `/dsh-task-suite/state?sessionId=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}`
            const response = await fetch(url, { cache: 'no-store' })
            const body = await response.json()
            if (!alive) return
            if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`)
            setState(body)
            setError(null)
          } catch (err) {
            if (alive) setError(String(err?.message ?? err))
          } finally {
            if (alive) setLoading(false)
          }
        }
        load()
        const timer = setInterval(load, 5000)
        return () => { alive = false; clearInterval(timer) }
      }, [visible, sessionId, cwd, refresh])

      const tasks = state?.tasks || []
      const counts = state?.counts || {}
      const metrics = state?.metrics || {}
      const loop = state?.loop || {}
      const current = loop.current
      const agents = state?.agents || []
      const events = state?.events || []
      const completion = Number.isFinite(metrics.completionRate) ? `${Math.round(metrics.completionRate * 100)}%` : '—'
      const firstPass = Number.isFinite(metrics.firstPassRate) ? `${Math.round(metrics.firstPassRate * 100)}%` : '—'

      return h('div', { className: 'dts-root' },
        h('style', null, `
          .dts-root { height: 100%; overflow: auto; padding: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          .dts-top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:10px; }
          .dts-title { font-size:15px; font-weight:650; letter-spacing:.1px; }
          .dts-sub { color:var(--dsw-alias-label-secondary); font-size:11px; margin-top:2px; }
          .dts-refresh { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px; }
          .dts-refresh:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-border-l2); }
          .dts-pill { display:inline-flex; align-items:center; gap:4px; border:1px solid; border-radius:999px; padding:1px 7px; font-size:10px; white-space:nowrap; }
          .dts-dot { width:6px; height:6px; border-radius:50%; display:inline-block; flex:none; }
          .dts-section { margin-top:12px; }
          .dts-section-head { display:flex; justify-content:space-between; align-items:center; color:var(--dsw-alias-label-secondary); font-size:11px; text-transform:uppercase; letter-spacing:.4px; margin-bottom:6px; }
          .dts-count { text-transform:none; letter-spacing:0; }
          .dts-current { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); border-radius:8px; padding:10px; }
          .dts-current-head { display:flex; align-items:center; gap:6px; min-width:0; }
          .dts-current-title { font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .dts-current-meta { color:var(--dsw-alias-label-secondary); margin-top:6px; display:flex; flex-wrap:wrap; gap:4px 10px; }
          .dts-current-meta b { color:var(--dsw-alias-label-primary); font-weight:550; }
          .dts-stats { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px; margin-top:10px; }
          .dts-stat { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); border-radius:7px; padding:7px 8px; min-width:0; }
          .dts-stat-value { font-size:16px; font-weight:650; line-height:1.2; }
          .dts-stat-label { color:var(--dsw-alias-label-secondary); font-size:10px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .dts-filters { display:flex; gap:4px; overflow-x:auto; padding-bottom:4px; margin-bottom:4px; scrollbar-width:none; }
          .dts-filters::-webkit-scrollbar { display:none; }
          .dts-filter { border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-secondary); border-radius:999px; padding:2px 7px; font-size:10px; white-space:nowrap; cursor:pointer; }
          .dts-filter-active { color:var(--dsw-alias-brand-primary); border-color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
          .dts-list { display:flex; flex-direction:column; gap:4px; }
          .dts-task { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); border-radius:6px; padding:6px 7px; cursor:pointer; }
          .dts-task:hover { border-color:var(--dsw-alias-border-l2); }
          .dts-task-current { border-color:var(--dsw-alias-brand-primary); }
          .dts-task-line { display:flex; align-items:center; gap:5px; min-width:0; }
          .dts-priority { font-weight:700; font-size:10px; flex:none; width:18px; }
          .dts-task-id { color:var(--dsw-alias-label-secondary); font-size:10px; flex:none; font-variant-numeric:tabular-nums; }
          .dts-task-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .dts-task-meta { color:var(--dsw-alias-label-secondary); font-size:10px; margin-top:3px; display:flex; gap:8px; min-width:0; }
          .dts-task-meta span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .dts-acceptance { flex:1; min-width:0; }
          .dts-current-label { color:var(--dsw-alias-brand-primary); flex:none; }
          .dts-task-detail { border-top:1px dashed var(--dsw-alias-border-l1); margin-top:6px; padding-top:5px; color:var(--dsw-alias-label-secondary); font-size:10.5px; white-space:pre-wrap; word-break:break-word; }
          .dts-kv { display:flex; gap:8px; margin-top:3px; }
          .dts-agent { display:flex; align-items:center; gap:5px; padding:3px 0; min-width:0; }
          .dts-agent-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .dts-agent-meta { color:var(--dsw-alias-label-secondary); font-size:10px; margin-left:auto; flex:none; }
          .dts-event { display:flex; gap:5px; padding:3px 0; border-bottom:1px dashed var(--dsw-alias-border-l1); font-size:10.5px; min-width:0; }
          .dts-event:last-child { border-bottom:0; }
          .dts-event-time { color:var(--dsw-alias-label-secondary); flex:none; font-variant-numeric:tabular-nums; }
          .dts-event-task { color:var(--dsw-alias-brand-primary); flex:none; }
          .dts-event-text { color:var(--dsw-alias-label-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .dts-empty { color:var(--dsw-alias-label-secondary); border:1px dashed var(--dsw-alias-border-l1); border-radius:6px; padding:10px; text-align:center; font-size:11px; }
          .dts-error { color:var(--dsw-alias-state-error-primary); border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); border-radius:6px; padding:7px; margin-bottom:8px; font-size:11px; white-space:pre-wrap; }
          .dts-muted { color:var(--dsw-alias-label-secondary); }
          .dts-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background:var(--dsw-alias-bg-layer-2); border-radius:4px; padding:1px 4px; }
        `),
        h('div', { className: 'dts-top' },
          h('div', null,
            h('div', { className: 'dts-title' }, '任务流水线'),
            h('div', { className: 'dts-sub' }, 'Task Suite · 只读仪表盘')),
          h('button', { className: 'dts-refresh', onClick: () => { setLoading(true); setRefresh(v => v + 1) } }, loading ? '…' : '刷新')),
        error ? h('div', { className: 'dts-error' }, error) : null,
        state && !state.initialized
          ? h('div', null,
              h('div', { className: 'dts-empty' }, '当前工作区还没有任务池。'),
              h('div', { className: 'dts-muted', style: { marginTop: 8, fontSize: 11 } },
                '在对话里说“初始化任务池”，或运行 ', h('span', { className: 'dts-code' }, 'task_init'), '。'))
          : null,
        state && state.initialized
          ? h('div', null,
              h('div', { className: 'dts-section', style: { marginTop: 0 } },
                h('div', { className: 'dts-current' },
                  h('div', { className: 'dts-current-head' },
                    h(Pill, { tone: LOOP_TONE[loop.status] || 'idle' }, LOOP_TEXT[loop.status] || loop.status || '未知'),
                    h('span', { className: 'dts-current-title' }, current ? `${current.task} ${current.title}` : '当前没有执行中的任务')),
                  h('div', { className: 'dts-current-meta' },
                    h('span', null, '阶段 ', h('b', null, current?.phase || '—')),
                    h('span', null, 'worker ', h('b', null, current?.worker || '—')),
                    h('span', null, '已运行 ', h('b', null, current?.started ? since(current.started) : '—')),
                    h('span', null, '基线 ', h('b', null, current?.mode === 'file' ? `快照 ${current.snapshotCount} 文件` : (current?.mode || '—'))),
                    h('span', null, 'inbox ', h('b', null, loop.inbox ?? 0))),
                  current?.gateNote ? h('div', { className: 'dts-muted', style: { marginTop: 6, fontSize: 10.5 } }, '门禁备注：', current.gateNote) : null)),
              h('div', { className: 'dts-stats' },
                h(Stat, { label: '完成率', value: completion, tone: 'ok', hint: `${metrics.completed || 0}/${metrics.total || 0} 已归档` }),
                h(Stat, { label: '一次通过率', value: firstPass, tone: firstPass === '—' ? 'idle' : 'ok', hint: `确认 ${metrics.confirms || 0} / 打回 ${metrics.rejects || 0}` }),
                h(Stat, { label: '7 日吞吐', value: `${metrics.throughput7d || 0}`, tone: 'run', hint: '近 7 天确认完成数' }),
                h(Stat, { label: '中位周期', value: metrics.medianCycleMs ? duration(metrics.medianCycleMs) : '—', tone: 'idle', hint: 'CLAIM → CONFIRM' }),
                h(Stat, { label: 'WIP', value: `${counts.doing || 0}`, tone: (counts.doing || 0) > 1 ? 'error' : 'ok', hint: '同一时刻应 ≤ 1' }),
                h(Stat, { label: '待验证', value: `${counts.verify || 0}`, tone: (counts.verify || 0) > 0 ? 'warn' : 'idle', hint: '等你确认' })),
              h(TaskSection, { tasks, filter, setFilter, counts }),
              h('section', { className: 'dts-section' },
                h('div', { className: 'dts-section-head' }, h('span', null, 'Agent'), h('span', { className: 'dts-count' }, `${agents.length} 个`)),
                agents.length ? h('div', null, agents.map(agent => h(AgentRow, { key: agent.id, agent })))
                  : h('div', { className: 'dts-empty' }, '暂无子 agent。自动循环派发 worker 后会出现在这里。')),
              h('section', { className: 'dts-section' },
                h('div', { className: 'dts-section-head' }, h('span', null, '最近流水'), h('span', { className: 'dts-count' }, `${events.length} 条`)),
                events.length ? h('div', null, events.slice(-12).reverse().map((event, index) => h('div', { className: 'dts-event', key: `${event.time}-${index}` },
                  h('span', { className: 'dts-event-time' }, clock(event.time)),
                  h('span', { className: 'dts-event-task' }, event.task),
                  h('span', { className: 'dts-event-text', title: event.detail }, `${event.event} ${event.detail}`)))) : h('div', { className: 'dts-empty' }, '还没有运行记录。')),
              h('div', { className: 'dts-muted', style: { fontSize: 10, marginTop: 10 } },
                `workspace: ${state.cwd || '—'}`, h('br'), `更新于 ${clock(state.generatedAt)}，每 5s 自动刷新`))
          : null,
        loading && !state ? h('div', { className: 'dts-empty' }, '加载任务池…') : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.inject(['betterSidebar'], (injected) => {
          const betterSidebar = injected.get?.('betterSidebar')
          if (!betterSidebar?.registerTab) return
          const tabDisposer = betterSidebar.registerTab({
            id: 'dsh-task-suite:dashboard',
            title: () => '任务流水线',
            description: () => '任务池、worker、门禁与运行指标',
            icon: size => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
              h('path', { d: 'M4 6h6M14 6h6M4 12h16M4 18h6M14 18h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
              h('circle', { cx: 11, cy: 6, r: 1.5, fill: 'currentColor' }),
              h('circle', { cx: 13, cy: 18, r: 1.5, fill: 'currentColor' })),
            order: 40,
            single: true,
            component: Dashboard,
          })

          const Launcher = () => h('button', {
            type: 'button',
            title: '打开任务流水线',
            onClick: () => {
              try { betterSidebar.openTab({ type: 'dsh-task-suite:dashboard' }) } catch {}
            },
            style: {
              position: 'fixed',
              right: 14,
              bottom: 14,
              zIndex: 70,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 999,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              boxShadow: '0 2px 10px rgba(0,0,0,.12)',
              cursor: 'pointer',
              font: '12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              pointerEvents: 'auto',
            },
          },
            h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
              h('path', { d: 'M4 6h6M14 6h6M4 12h16M4 18h6M14 18h6', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
              h('circle', { cx: 11, cy: 6, r: 1.5, fill: 'currentColor' }),
              h('circle', { cx: 13, cy: 18, r: 1.5, fill: 'currentColor' })),
            '任务流水线')

          const launcherDisposer = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-task-suite:launcher',
            order: 60,
          }, Launcher))

          return () => {
            try { launcherDisposer?.() } catch {}
            try { tabDisposer?.() } catch {}
          }
        }), 'dsh-task-suite: dashboard surface')
      },
    }
  },
})
