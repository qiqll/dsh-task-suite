# 分渠道文案

同一篇长文不要原样群发。下面按渠道改写，保留核心差异点即可。

## V2EX（分享创造）

**标题：** 把 Claude 的任务流水线搬进 DeepSeek Harness：主 Agent 调度，后台 Agent 交付，机器验收

**正文：**

最近一年用 coding agent，最难受的不是它写错，而是它说“已完成，测试通过”，你打开 diff 发现测试没跑、或者被改弱了。

所以我把平时在 Claude 里用的一套任务工作流，移植成了 DeepSeek Harness 插件：`dsh-task-suite`。

核心不是 todo，而是验收：

- 主 Agent 只负责拆任务、排期、派活、验收，不自己埋头写
- 每个任务由全新上下文的后台 subagent 交付
- 交付后机器重跑测试、在开工基线 worktree 上比对失败用例、审计测试是否被改弱、检查越界文件
- 任务池就是 `.dsh/tasks/*.md`，人可以直接读改；git 可选，普通目录走文件快照
- 带一个只读面板，任务 / Agent / 指标 / 事件流

已经发 npm：`dsh-task-suite@1.1.0`，也支持从 GitHub 装。

```
dsh plugin --profile desktop add dsh-task-suite
```

仓库：https://github.com/qiqll/dsh-task-suite

想听两类反馈：一是流程里哪一步多余；二是机器验收有没有真的挡住过一次错误交付。

## 即刻

AI 说“做完了”，你敢信吗？

我把 Claude 的任务流水线搬进了 DeepSeek Harness：

- 主 Agent 只调度，不自己写
- 每个任务由独立后台 subagent 交付
- 机器重跑测试、查改动归属、审计测试是否被改弱
- 任务池是磁盘上的 Markdown，git 可选
- 只读面板：任务 / Agent / 指标 / 事件流

不是 todo list，是“可验收的 Agent 交付流程”。

`dsh plugin --profile desktop add dsh-task-suite`

https://github.com/qiqll/dsh-task-suite

## X / Twitter thread

**1/4**

Your coding agent shouldn't grade its own homework.

I ported the task workflow I use in Claude to DeepSeek Harness: main agent schedules, fresh subagents deliver, machines verify.

`dsh-task-suite` — open source, 1.1.0 on npm.

**2/4**

The loop:

- You talk to the main agent
- It splits tasks, prioritizes, dispatches
- A fresh worker implements one task and reports back
- A machine gate reruns tests, compares the baseline, audits weakened tests and out-of-scope files
- Only then: pending verification → human confirm

**3/4**

The task pool is Markdown on disk (`.dsh/tasks/*.md`). Readable, editable, no database.

Git is optional. Git repos use commit/worktree acceptance; plain directories fall back to file snapshots.

Plus a read-only dashboard for tasks, agents, metrics, and events.

**4/4**

Install:

`dsh plugin --profile desktop add dsh-task-suite`

Repo: https://github.com/qiqll/dsh-task-suite

If you try it: which step felt unnecessary, and which step actually caught a bad delivery?

## Hacker News（Show HN）

**Title:** Show HN: DSH Task Suite – a task pipeline for coding agents, with machine acceptance

**Body:**

I kept running into the same failure mode with coding agents: the agent says “done, tests pass”, but the tests were never run, were weakened, or the change went outside the task scope.

So I ported the task workflow I use in Claude to DeepSeek Harness and packaged it as an open-source plugin.

How it works:

- A main agent talks to the user and schedules; it does not implement.
- Each task is handed to a fresh subagent worker with a clean context.
- The worker implements, runs tests, commits or snapshots, and returns a structured report.
- A machine gate reruns the project tests against the start-of-work baseline, checks commit attribution and out-of-scope files, audits whether tests were weakened, and flags risky paths.
- Passing tasks go to “pending verification”; a human confirms before archival.
- The task pool is Markdown on disk, and git is optional (plain directories use file snapshots).
- A read-only web dashboard shows tasks, agents, metrics, and an event log.

It is not a todo app; the interesting part is the acceptance gate. The worker's self-report is treated as a claim, not evidence.

Install: `dsh plugin --profile desktop add dsh-task-suite`

Repo: https://github.com/qiqll/dsh-task-suite

Happy to answer questions about the acceptance model, the non-git snapshot mode, or why the main agent stays out of implementation.

## Reddit

只发一个相关社区，不要多版群发。建议 `r/DeepSeek` 或 `r/LLMDevs`，先读版规。

**Title:** I built a machine-verified task pipeline for coding agents (DeepSeek Harness plugin)

**Body:** 用英文长文的 1–4 节，结尾附 repo 和安装命令；不要放“求 star”。

## 微信公众号 / 掘金

用中文长文版，开头用真实场景，结尾给安装命令和仓库。标题用：

> AI 说“做完了”，这次终于有人验收了

文内不要放过多外链，仓库和 npm 各一次即可。

## GitHub Release / 市场条目

短描述：

> 主 Agent 调度、后台 subagent 交付、机器验收的 DSH 任务流水线。Markdown 任务池，git 可选，带只读面板。

英文：

> A task pipeline for DeepSeek Harness: main agent schedules, fresh subagents deliver, and machines verify before human confirmation. Markdown task pool, optional git, read-only dashboard.
