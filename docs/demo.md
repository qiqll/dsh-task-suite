# 60 秒演示脚本

目标：让第一次看到插件的人，在 60 秒内理解「主 Agent 只调度、后台 subagent 干活、机器验收」和「有可视化面板」。

录制前准备一个干净的演示工作区（例如 `~/dsh-demo`），里面只有一个小测试文件；不要在真实项目里录，避免私有路径和密钥入镜。

## 分镜

| 时间 | 画面 | 旁白/字幕 |
|---|---|---|
| 0–5s | 标题卡：DSH 任务流水线 | 主 Agent 只调度，后台 subagent 干活 |
| 5–15s | 空面板：任务池为空 | 任务池是磁盘上的 Markdown，git 可有可无 |
| 15–25s | 终端录入 2–3 条任务 | 需求直接进 P0–P3 池，自动拆验收标准 |
| 25–40s | 启动循环，subagent 在后台跑测试 | 每个任务在全新上下文里交付，主会话不被长对话污染 |
| 40–50s | 面板出现「待验证」+ 指标变化 | 交付不是自述：机器重跑测试、比对基线、审计测试改弱 |
| 50–58s | 确认归档，任务进入已完成 | 需求方确认后才归档，全过程可追溯 |
| 58–60s | 安装命令 + 仓库地址 | `dsh plugin add qiqll/dsh-task-suite` |

## 演示命令

```text
task_init
task_add items=[{title: "给 /health 增加超时检查", module: "demo", priority: "P1", acceptance: "pytest tests/test_health.py -q 通过"}]
task_add items=[{title: "补一个失败用例并修复", module: "demo", priority: "P2", acceptance: "pytest tests/test_health.py -q 全绿"}]
task_loop action=start max=2 hours=1
task_loop action=tick
# 把 worker_prompt 交给 subagent，等它输出报告块
task_accept report="<报告块>"
task_confirm task_id=T-001 conclusion="健康检查已加超时，测试通过"
```

## 三个必录状态

1. **空池**：面板显示“当前没有执行中的任务 / 0 条任务”，证明不是 demo 数据造假。
2. **执行中**：当前任务有 `T-xxx`、阶段 `running`、worker 名称、已运行时间。
3. **待验证**：任务从「进行中」进入「待验证」，指标区完成率/一次通过率/WIP 有变化。

截图统一 1440×900，浅色主题，隐藏左侧会话列表里的私人项目名；终端只保留演示目录。

## 录制检查表

- [ ] 浏览器缩放 100%，无系统通知弹窗
- [ ] 面板每 5 秒刷新，录制时不要手动狂点
- [ ] 终端字号 ≥ 16px，命令不换行
- [ ] 不出现 API key、token、`.env`、真实仓库路径
- [ ] 字幕只保留一行，避免遮挡面板
- [ ] 结尾停留 2 秒，给安装命令阅读时间
- [ ] 导出 GIF ≤ 8MB；视频 1080p/30fps
- [ ] 文件名：`dsh-task-suite-60s.gif` / `dsh-task-suite-60s.mp4`

## 素材存放

- `docs/screenshots/dashboard-empty.png`
- `docs/screenshots/dashboard-running.png`
- `docs/screenshots/dashboard-verify.png`
- `docs/screenshots/sidebar-entry.png`
- `docs/demo/dsh-task-suite-60s.gif`（录制后）

发布前把真实截图替换 README 里的占位说明，并把 GIF 放到 README 首屏。
