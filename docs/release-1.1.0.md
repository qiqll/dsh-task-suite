# dsh-task-suite 1.1.0

**2026-11-12**

## 一句话

把 Claude 的 task 体系搬进 DeepSeek Harness：Markdown 任务池、主 Agent 调度、后台 subagent 交付、机器验收，外加一个只读的可视化任务流水线面板。

## 这版新增

- 右侧 Better Sidebar 的 **任务流水线** tab，以及 `+` 菜单和底部悬浮入口。
- 任务池、当前 worker、Agent 树、完成率/一次通过率/7 日吞吐/中位周期/WIP/验收次数。
- Host 只读接口 `GET /dsh-task-suite/state`，按会话和工作目录取数。
- 无 Better Sidebar 时仍可正常启动，任务工具不受影响。

## 这版修复

- 冷启动时 `webServer` 还未就绪导致 `/dsh-task-suite/state` 404、前端报 JSON 解析错误。
- 未注入 `agents` / `subagents` 时面板整页崩溃。
- 接口空响应时错误信息不可读。
- 首次安装后只刷新页面、客户端插件表不更新的问题（文档明确要求完整重启一次）。

## 安装

```sh
dsh plugin add qiqll/dsh-task-suite
```

首次安装后**完整退出并重新打开 DSH**；之后进入任意会话，从右侧栏 `+` 菜单或右下角 **任务流水线** 打开。

## 升级

从 1.0.0 升级后同样建议完整重启一次。任务池文件格式未变，`.dsh/tasks/` 不需要迁移。

## 已知限制

- 面板是只读的；任务操作仍通过 `task_*` 工具完成。
- 没有 Better Sidebar 时没有面板，但 Host 工具、API 和任务池正常。
- 非 git 目录使用文件快照验收；快照会在确认后清理。
