# dsh-task-suite 1.1.1

1.1.1 是一个补丁版本，重点是让新用户从任务流水线面板真正看到自己工作区的任务，并把公开发布素材统一到“Agent 团队”叙事。

## 修复

- **任务面板工作目录回退**：面板没有会话 `cwd`（例如从全局入口打开）时，不再错误读取 profile 目录；依次回退到活跃 Agent、请求目录、工作区注册表和默认目录。
- **npm 包与源码一致**：1.1.1 包含上述面板修复；1.1.0 的 npm 包没有。

## 文档与发布素材

- README 首屏重写为“助理 → 团队、对话 → 任务、同步 → 异步、黑盒 → 驾驶舱”，并补充“自述 → 证据”的机器验收底线。
- 新增中文介绍页：https://qiqll.github.io/dsh-task-suite/
- 新增 1200×630 社交分享卡和可编辑 HTML 源文件。
- 新增中英文首发文案与市场条目规范。
- 使用真实 T-009 运行中面板截图替换旧示意图。

## 安装

```sh
dsh plugin --profile desktop add dsh-task-suite
```

首次安装后完整退出并重新打开 DSH。

## 验证

```sh
npm view dsh-task-suite version
# 1.1.1

npm test
# selftest 8/8
```
