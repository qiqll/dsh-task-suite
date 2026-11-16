# English launch copy

## Title options

1. Your coding agent shouldn't grade its own homework
2. I ported a task pipeline for coding agents to DeepSeek Harness
3. DSH Task Suite: main agent schedules, subagents deliver, machines verify

## Long post

The most uncomfortable moment in AI-assisted coding is not a wrong line of code. It is this sentence:

> Done. Tests pass.

Then you open the diff: the tests were never run, or they were weakened; the change touched files outside the task; “done” was the agent's own judgment.

I ported the task workflow I use in Claude to DeepSeek Harness and packaged it as **DSH Task Suite** (`dsh-task-suite`).

It is not another todo list. It makes “who does the work and how it gets accepted” part of the process.

### 1. The main agent schedules; it does not grind

You talk to the main agent. It splits work, prioritizes, dispatches, and accepts. It does not burn its context on implementation.

### 2. Every task is delivered by a fresh subagent

A worker gets one task in a clean context: orient, judge risk, implement, run tests, commit or snapshot, then return a structured report. Long tasks no longer pollute the main conversation.

### 3. Machines verify; worker self-reports are not trusted

Before a task is considered done:

- Rerun the project tests
- Compare against the start-of-work baseline worktree
- Audit whether tests were weakened
- Check commit attribution, out-of-scope files, and dirty leftovers
- Flag risky paths separately

Only then does it move to “pending verification”; a human confirms before archival.

### 4. The task pool is Markdown on disk

`.dsh/tasks/backlog.md`, `dev-plan.md`, `dev-progress.md` — readable and editable by humans. **Git is optional**: git repos use commit/worktree acceptance; plain directories automatically fall back to file snapshots.

### 5. A read-only dashboard

Open “Task Pipeline” from the sidebar or the bottom-right launcher: tasks, agents, metrics, and an event stream on one screen. The dashboard is read-only, so you cannot accidentally change state.

## 60-second start

```text
task_init
task_add items=[{title: "Add rate limiting to the login endpoint", module: "backend", priority: "P1", acceptance: "pytest tests/test_auth.py passes"}]
task_loop action=start max=3 hours=2
task_loop action=tick        # hand the returned worker_prompt to a subagent
# after delivery: task_accept report="<report block>" → task_confirm
```

## Install

```sh
dsh plugin --profile desktop add dsh-task-suite
```

From GitHub source:

```sh
dsh plugin --profile desktop add qiqll/dsh-task-suite
```

After the first install, **fully quit and reopen DSH**. Refreshing the page does not load the client-side panel.

## Who it is for

- Independent developers juggling multiple delivery tasks
- Anyone who has been burned by an agent claiming “done”
- Small teams that want an auditable, reversible task trail
- People who do not want their tasks locked in a SaaS database

## Who it is not for

- Someone who only wants a simple todo list
- Personal scripts that need no tests or acceptance
- People expecting a hosted, zero-setup task manager

## Links

Repo: https://github.com/qiqll/dsh-task-suite

npm: https://www.npmjs.com/package/dsh-task-suite

If you use DeepSeek Harness, install it and run one real task through the full loop. The most useful feedback is not a star; it is: **which step felt unnecessary, and which step actually caught a bad delivery?**

## Short post (X / LinkedIn)

Your coding agent shouldn't grade its own homework.

I ported a task pipeline for coding agents to DeepSeek Harness:

- Main agent schedules; fresh subagents do the work
- Machines rerun tests, check change attribution, audit weakened tests
- Markdown task pool on disk; git optional
- Read-only dashboard for tasks, agents, metrics, and events

Not a todo list. An acceptance loop for agent delivery.

`dsh plugin --profile desktop add dsh-task-suite`

https://github.com/qiqll/dsh-task-suite
