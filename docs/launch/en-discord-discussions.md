# 英文社区：DSH Discord + GitHub Discussions

> **发布方式：由用户用自己的账号手动发布**（不代发、不 @ 人、不刷屏）。
> 先发 Discord，再发 Discussions（同日或次日）；同一天内不要重复贴同一段文字。
> 事实口径见 [README.md](README.md)。

---

## 1. Discord（DSH 官方服务器）

- 服务器邀请：https://discord.gg/4MrtZUhpxg
- 目标频道：`#showcase`；没有的话用 `#plugins` 或 `#general`，发前先读频道说明。
- 长度：正文 **约 180 词**（要求 120–200 词）。
- 配图：`docs/screenshots/dashboard-running.png`（只发 1 张，别刷屏）。
- UTM：`?utm_source=discord&utm_medium=post`

### 正文（直接复制）

```text
Hi everyone — I built a DSH plugin called dsh-task-suite, and I want to know where it breaks.

I got tired of babysitting one agent at a time. Now the main session only plans and reviews. Each task goes to a background subagent with a fresh context.

Three things it does differently:

1. The task pool is plain Markdown under .dsh/tasks/. You can read, edit, and diff it.
2. "Done" is mechanical. Each dispatch gets a one-time nonce. Commits must carry the task ID. Failed tests are re-run at the start baseline. Weakened tests are audited. A worker saying "done" is not enough.
3. git is optional. In a plain folder it uses file snapshots and runs the same checks.

Install: dsh plugin --profile desktop add dsh-task-suite (use --profile web for the web build). The read-only dashboard needs dsh-better-sidebar and one restart.

Repo: https://github.com/qiqll/dsh-task-suite
Landing: https://qiqll.github.io/dsh-task-suite/?utm_source=discord&utm_medium=post

It is new: 1 star, and I'm the main user. It is listed in the DSH Go market too.

Question: if you left a loop running overnight, what should the acceptance gate check that it does not check today?
```

### 发布备注

- 钩子句：`I got tired of babysitting one agent at a time.`
- 三条差异：Markdown 任务池 / 机器验收四道关 / git 可选走快照。
- 评论区引导：只问上面那一个问题；有人回复就先答问题，不贴第二段广告。
- 不要在服务器里 @ 维护者或 `@everyone`。

---

## 2. GitHub Discussions（DSH 官方反馈区首发帖）

- 入口：https://github.com/deepseek-ai/deepseek-harness/discussions（选 **Show and tell**，没有就选 **General**）
- 标题：`Show and tell: dsh-task-suite — a Markdown task pool where the machine checks the worker`
- 长度：正文 **约 185 词**（要求 120–200 词）。
- 首图：`docs/screenshots/dashboard-overview.png`（上传到帖子里，别只贴本地路径）。
- UTM：`?utm_source=github-discussions&utm_medium=post`

### 正文（直接复制）

```text
I built dsh-task-suite, a DeepSeek Harness plugin for working through a backlog while you do something else.

The main session stays a dispatcher: it adds tasks, picks the next one, sends it to a fresh subagent, and accepts the result. Three differences:

1. State is files. Tasks live in .dsh/tasks/*.md, so you can read and edit the queue without a database.
2. Acceptance is machine-run: a one-time nonce, commit ownership, a baseline re-run, and a weakened-test audit. Passing all four is what "done" means. The final state is still "to verify" until a person confirms.
3. No git needed. Without a repo, it snapshots the folder at claim time and runs the same checks.

Install: dsh plugin --profile desktop add dsh-task-suite (use --profile web for the web build). The dashboard needs dsh-better-sidebar; restart DSH once after install.

Repo: https://github.com/qiqll/dsh-task-suite
Landing: https://qiqll.github.io/dsh-task-suite/?utm_source=github-discussions&utm_medium=post

The project has 1 star, so read this as a request for early feedback, not a recommendation. It is also listed in the DSH Go market.

Question: which part would make you trust an overnight run — the test audit, the decision queue, or rollback?
```

### 发布备注

- 钩子句：`working through a backlog while you do something else`。
- 三条差异：纯文件状态 / 机器验收四道关 / 无 git 也能用。
- 提问引导：三选一，降低回复成本；有人答就追问一句他现在的做法。
- 别在帖子里承诺 roadmap；1 star 的冷启动状态要保留，不要删掉这句。

---

## 事实与措辞检查（发前逐条打勾）

- [ ] 版本写的是 `1.1.1`，不是 `latest`。
- [ ] 安装命令就是 `dsh plugin --profile desktop add dsh-task-suite`（Web 版 `--profile web`）。
- [ ] 写了「面板依赖 dsh-better-sidebar，装完要完整重启一次」。
- [ ] 写了「git 可选，普通目录走文件快照」。
- [ ] 四道关的顺序没写错：nonce → 提交归属 → 基线比对 → 改弱审计。
- [ ] 没有 `best` / `first` / `fastest` / `revolutionary` 这类词。
- [ ] 没有 @ 任何人，没有 `@everyone` / `@here`。
- [ ] 两个链接都带 UTM，且能打开（发前点一次）。
- [ ] 图片里没有 API Key、token、`/Users/<name>` 路径。
