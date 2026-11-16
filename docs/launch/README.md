# 首发素材包

面向 1.1.0 的首发文案与发布节奏。目标是让读者在 30 秒内理解「它和普通 todo / 普通 coding agent 有什么不同」，然后愿意装一次。

## 文件

| 文件 | 用途 |
|---|---|
| [`zh.md`](zh.md) | 中文长文、短帖、朋友圈文案 |
| [`en.md`](en.md) | English launch post and short variants |
| [`channels.md`](channels.md) | V2EX / 即刻 / X / HN / Reddit / 微信的分渠道版本 |
| [`checklist.md`](checklist.md) | 发布前检查、发布顺序、发布后 48 小时动作 |
| [`../demo.md`](../demo.md) | 60 秒演示脚本与镜头清单 |
| [`../screenshots/README.md`](../screenshots/README.md) | 面板截图规范与文件命名 |

## 一句话定位

> 主 Agent 只调度，后台 subagent 干活，交付前机器重跑测试。

## 三条核心差异

1. **不采信自述**：worker 说完成不算完成，机器重跑测试、比对基线、审计测试是否被改弱。
2. **文件即任务池**：`.dsh/tasks/*.md`，人可以直接读改；git 可选，普通目录自动走文件快照。
3. **主会话不被长任务拖死**：每个任务在全新上下文的 worker 里完成，主 Agent 只负责对话、排期、验收。

## 发布顺序建议

1. GitHub Release + npm 包先可用（已完成）。
2. 市场 PR 合并（#15404）。
3. 补 3 张真实面板截图 + 1 条 60 秒 GIF。
4. 中文长文发一处（V2EX 或公众号），英文发一处（X 或 HN）。
5. 观察反馈后，再发第二波短帖，不群刷。

## 链接

- 仓库：https://github.com/qiqll/dsh-task-suite
- npm：https://www.npmjs.com/package/dsh-task-suite
- Release：https://github.com/qiqll/dsh-task-suite/releases/tag/v1.1.0
- 市场 PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/15404
