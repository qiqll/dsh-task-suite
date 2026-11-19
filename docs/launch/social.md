# 首发社媒文案

配套素材：`docs/promo/promo-01.png`（自评 vs 机器验收）、`docs/promo/promo-02.png`（一条任务四道关）、`docs/landing/og.png`（1200×630 链接卡片）。

发布顺序建议：先发介绍页链接 + 一张对比图；评论区补安装命令；第二帖讲“为什么不是多 Agent”。

## 短版 · 小红书 / 微博 / 即刻

我把 Agent 从“助理”改成了“工程团队”。

以前：我追着它问进度，它说完成了，我还得自己验。
现在：主 Agent 只调度，后台 Agent 交付，机器重跑测试、比对基线，过了才到我面前。

需求可以一次扔进任务池，不用等它做完一件再提下一件；任务、状态、结果全在面板里。

开源插件 `dsh-task-suite`，DSH 用户一条命令：

`dsh plugin --profile desktop add dsh-task-suite`

安装后完整重启 DSH，右侧栏打开「任务流水线」。

介绍页 👉 https://qiqll.github.io/dsh-task-suite/
GitHub 👉 https://github.com/qiqll/dsh-task-suite

#DeepSeekHarness #AIAgent #开源 #效率工具 #任务管理

## 中版 · 朋友圈 / 公众号转发

**别管 Agent 了，带团队。**

一个 Agent 是助理，一支 Agent 团队才是产能。

DSH 任务流水线做了四个转变：

1. 助理 → 团队：主 Agent 只负责对话、拆解、调度、验收，具体工作交给独立上下文的 subagent。
2. 对话 → 任务：每个需求都有 ID、优先级、验收标准、状态和依赖，按工程标准交付。
3. 同步 → 异步：需求可以一次投递多条，进入任务池按序消化，不用守着对话等。
4. 黑盒 → 驾驶舱：任务、Agent、指标、事件流一屏可见。

底线只有一条：**worker 说“完成”不算完成。** 机器重跑测试、比对基线、审计测试改弱，人确认后才归档。

开源、文件任务池、git 可选，DSH 插件市场可装。

介绍页：https://qiqll.github.io/dsh-task-suite/
GitHub：https://github.com/qiqll/dsh-task-suite

## 长版 · V2EX / 技术社区

**多 Agent 是手段，不是产品。**

现在很多“多 Agent”方案，本质是把一个 prompt 拆给几个模型跑一遍：没有任务契约，没有验收门禁，没有状态机，也没有可见性。结果只是把混乱并行化。

DSH 任务流水线把“带一个小工程团队”的最小闭环做进了插件：

- **任务池**：`.dsh/tasks/*.md`，P0–P3、依赖、验收标准、状态机；人可以直接读改，git 可选。
- **调度**：主 Agent 只对话、拆解、派活、验收；每个任务在全新上下文里交给后台 subagent。
- **异步**：需求先入池，按序消化；你可以连续投递，不必等一条结束。
- **机器验收**：在开工基线 worktree 上重跑测试，检查新增失败、越界文件和测试改弱，不采信 worker 自述。
- **人的最后一道关**：机器通过 → 待验证 → 人确认 → 归档；不通过可打回或回滚。
- **可视化**：任务、Agent、指标、事件流，5 秒刷新。

它不承诺“无人值守自动上线”。它解决的是更现实的问题：**AI 交付的过程，能不能像工程团队一样被管理、被审计、被看见。**

安装：

```sh
dsh plugin --profile desktop add dsh-task-suite
```

完整退出并重开 DSH，右侧栏打开「任务流水线」。

介绍页：https://qiqll.github.io/dsh-task-suite/
源码：https://github.com/qiqll/dsh-task-suite
npm：https://www.npmjs.com/package/dsh-task-suite

## X / Twitter（English）

Your coding agent is a brilliant assistant and a terrible employee.

It waits for instructions. It works on one thing. It says “done” and you still have to verify.

DSH Task Suite turns one agent into a small engineering team:

→ lead agent only schedules
→ background workers deliver in isolated contexts
→ machines re-run tests before anything counts as done
→ tasks, agents and evidence in one live dashboard

Async intake. Markdown task pool. Git optional.

Open source DSH plugin:

`dsh plugin --profile desktop add dsh-task-suite`

Landing: https://qiqll.github.io/dsh-task-suite/
GitHub: https://github.com/qiqll/dsh-task-suite

## LinkedIn（English）

Most “multi-agent” setups are still assistants with more prompts.

We built DSH Task Suite around a different unit: the task.

- A lead agent talks to you, decomposes work, dispatches, and accepts.
- Each task runs in an isolated background worker.
- A machine gate re-runs tests against the start baseline, audits test weakening and out-of-scope changes.
- A human confirms before anything is archived.
- A live dashboard shows tasks, agents, metrics and events.

The result: you stop operating an assistant and start leading a small team.

Open source, file-based, git optional:
https://github.com/qiqll/dsh-task-suite

## 发布小贴士

- 首图用 `promo-01.png`：左边“它说完成了”，右边“机器验收”，对比最强。
- 第二张用 `promo-02.png` 讲四道关；不要一次发四张，信息过载。
- 链接预览用 `og.png`；如果平台不支持，直接发竖版海报。
- 评论区置顶安装命令和“首次安装需完整重启”，能减少一半安装问题。
- 不要写“全自动 / 无人值守 / 无限并行”；我们的差异是可控、可验收，不是无人化。
