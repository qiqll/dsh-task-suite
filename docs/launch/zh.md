# 中文首发文案

## 标题备选

1. 我把 Claude 的任务流水线搬进了 DeepSeek Harness：主 Agent 只调度，后台 Agent 干活
2. AI 说“做完了”，这次终于有人验收了
3. 别再让 coding agent 自己给自己打分：一套可验收的任务流水线

## 长文版

AI 编程最让人心里没底的时刻，不是它写错代码，而是它说：

> 已完成，测试通过。

你打开 diff 才发现：测试根本没跑，或者被改弱了；改动范围超出了任务；所谓“完成”只是它自己的判断。

我把平时在 Claude 里用的一套任务工作流，搬到了 DeepSeek Harness，做成了 **DSH 任务流水线**（`dsh-task-suite`）。

它不是又一个 todo list。它把“谁来做、怎么验收”写进了流程：

### 1. 主 Agent 只调度，不埋头写代码

需求方和主 Agent 对话。主 Agent 负责拆任务、排优先级、派活、验收，不把上下文耗在具体实现上。

### 2. 每个任务由独立的后台 subagent 交付

worker 在全新上下文里拿到一个任务：定向、判断风险、实施、跑测试、提交或存快照，最后输出结构化报告。长任务不会污染主会话。

### 3. 机器验收，不采信 worker 自述

交付后不是直接算完成，而是：

- 重跑项目测试
- 在开工基线 worktree 上比对失败用例
- 审计测试有没有被改弱
- 检查改动归属、越界文件、遗留脏文件
- 高风险路径单独审计

通过后进入「待验证」，需求方确认后才归档。

### 4. 任务池就是磁盘上的 Markdown

`.dsh/tasks/backlog.md`、`dev-plan.md`、`dev-progress.md`，人可以直接看、直接改。**git 是可选的**：git 仓库走 commit/worktree 验收；普通目录自动降级为文件快照模式。

### 5. 有一个只读面板

右侧栏 / 右下角入口打开「任务流水线」：任务、Agent、指标、事件流一屏看完。面板只读，不会误触改状态。

## 60 秒上手

```text
task_init
task_add items=[{title: "给登录接口加限流", module: "backend", priority: "P1", acceptance: "pytest tests/test_auth.py 通过"}]
task_loop action=start max=3 hours=2
task_loop action=tick        # 把返回的 worker_prompt 交给 subagent
# subagent 交付后：task_accept report="<报告块>" → task_confirm
```

## 安装

```sh
dsh plugin --profile desktop add dsh-task-suite
```

GitHub 源码安装：

```sh
dsh plugin --profile desktop add qiqll/dsh-task-suite
```

首次安装后需要**完整退出并重新打开 DSH**，只刷新页面不会加载客户端面板。

## 适合谁

- 手上有多任务、需要连续交付的独立开发者
- 已经被 agent“假完成”坑过的人
- 想让任务过程可审计、可回滚的小团队
- 不想把任务锁进某个 SaaS 数据库的人

## 不适合谁

- 只想要一个简单 todo 列表的人
- 完全不需要测试和验收的个人脚本
- 期待开箱即用的云端任务管理的人

## 结尾

仓库：https://github.com/qiqll/dsh-task-suite

npm：https://www.npmjs.com/package/dsh-task-suite

如果你也在用 DeepSeek Harness，欢迎装一次，拿一个真实的小任务跑完整流程。最有价值的反馈不是“star 了”，而是：**哪一步让你觉得多余，哪一步真的挡住了错误交付。**

## 短版（即刻 / 朋友圈）

AI 说“做完了”，你敢信吗？

我把 Claude 的任务流水线搬进了 DeepSeek Harness：

- 主 Agent 只调度，不自己写
- 每个任务由独立后台 subagent 交付
- 交付后机器重跑测试、查改动归属、审计测试是否被改弱
- 任务池就是磁盘上的 Markdown，git 可选
- 还有一个只读面板，任务 / Agent / 指标 / 事件流一屏看完

不是 todo list，是“可验收的 Agent 交付流程”。

`dsh plugin --profile desktop add dsh-task-suite`

https://github.com/qiqll/dsh-task-suite
