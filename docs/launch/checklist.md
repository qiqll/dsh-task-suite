# 发布检查清单

## 发布前

- [x] GitHub `main` 推送，tag `v1.1.0`，Release 可访问
- [x] npm `dsh-task-suite@1.1.0` 可安装，`latest` 正确
- [x] README 安装命令带 `--profile`
- [x] Release Notes 安装命令带 `--profile`
- [x] 市场 PR #15404 已提交
- [ ] 市场 PR 已合并
- [x] `dashboard-overview.png` 真实面板截图（已裁掉本地路径）
- [ ] `dashboard-running.png` / `dashboard-verify.png`
- [ ] 60 秒 GIF 或短视频
- [ ] 截图中无 API Key、token、私人路径、真实项目名
- [ ] 演示任务数据是虚构的，且不包含公司/客户信息
- [ ] 所有链接在未登录浏览器里可打开
- [ ] npm 安装命令在干净 profile 里复跑一次
- [ ] 首发文案中的数字与实际仓库一致（版本、测试数、命令）

## 建议发布顺序

| 时间 | 动作 |
|---|---|
| T-0 | 市场 PR 合并；README 截图/GIF 补齐 |
| T-0 | 中文长文发 V2EX / 即刻（二选一先发） |
| T-1 | 英文发 X thread；视情况发 HN Show |
| T+2 | 收集反馈，修安装/文档问题，再发第二渠道 |
| T+7 | 汇总反馈，决定是否做 1.1.1 |

不要同一天在所有社区发同一篇；先发一个能收到高质量反馈的渠道。

## 发布后 48 小时

- 每条评论都回复，尤其是“装不上”“看不懂”“和 X 有什么区别”
- 把重复出现的问题记进 backlog，不要现场承诺日期
- 不删负评；把具体技术质疑转成 issue
- 记录每个渠道的点击、安装咨询、真实试用反馈，而不只是 star 数

## 成功标准

首发不是“曝光量”，而是：

1. 至少 3 个非熟人真实安装
2. 至少 1 个完整跑通 `task_add → task_loop → task_accept → task_confirm` 的反馈
3. 至少 1 个安装/文档问题被真实用户发现并修掉
