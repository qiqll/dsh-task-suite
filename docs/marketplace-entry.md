# Plugin marketplace entry — 1.1.0

用于更新 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的收录条目。先改本文件并评审，确认后再向市场仓库提 PR。

## 当前市场条目

```markdown
- [qiqll/dsh-task-suite](https://github.com/qiqll/dsh-task-suite) - File-based task pool and dispatcher for DeepSeek Harness: keeps a P0-P3 backlog as Markdown, hands one task at a time to a background subagent, gates delivery by rerunning the project test command, and accepts the result against a git commit or a file snapshot; git and non-git directories both work.
```

问题：只讲 1.0.0 的文件任务池，没有提 1.1.0 的可视化面板，也没有“主 Agent 只调度”的差异。

## 新版英文条目

```markdown
- [qiqll/dsh-task-suite](https://github.com/qiqll/dsh-task-suite) - Claude-style task pipeline for DeepSeek Harness: a Markdown P0-P3 task pool, a main agent that dispatches one task at a time to a background subagent, machine re-verification before acceptance (re-run tests, baseline comparison, test-weakening audit), git or file-snapshot baselines, and a read-only Web dashboard for tasks, agents, metrics and the live event stream.
```

## 新版中文条目

```markdown
- [qiqll/dsh-task-suite](https://github.com/qiqll/dsh-task-suite) - 把 Claude 的 task 体系搬进 DSH：Markdown 任务池、主 Agent 调度、后台 subagent 交付、机器重跑测试验收；git 和非 git 目录都能用，并带一个只读的可视化任务流水线面板。
```

## 市场卡片信息

| 字段 | 值 |
|---|---|
| 名称 | `dsh-task-suite` / **DSH 任务流水线** |
| 版本 | `1.1.0` |
| 安装 | `dsh plugin add qiqll/dsh-task-suite` |
| 分类 | task management / orchestration / subagent |
| 平台 | Host + Web（Web 面板需 Better Sidebar） |
| 关键词 | `dsh-plugin`, `deepseek-harness`, `task-management`, `task-queue`, `subagent`, `workflow`, `automation`, `orchestration` |
| 仓库 | <https://github.com/qiqll/dsh-task-suite> |

## 截图清单

发布前补到 `docs/screenshots/`，建议 1440×900、浅色主题、去掉个人信息和 token：

1. `dashboard-empty.png` — 空任务池，显示“当前没有执行中的任务 / 0 条任务”。
2. `dashboard-running.png` — 一条任务进行中，显示当前任务、worker 和 Agent。
3. `dashboard-verify.png` — 任务进入待验证，指标和事件流有数据。
4. `sidebar-entry.png` — 右侧栏 `+` 菜单里的“任务流水线”入口。

每张图在 PR 描述里配一句 alt 文本；不要把 `.dsh/tasks` 的私有路径或会话 ID 截进去。

## PR 步骤

1. 等 GitHub 上 `v1.1.0` 和 npm 包就绪；市场条目会按 `package.json` 版本展示。
2. Fork `awesome-dsh-plugin/awesome-dsh-plugin`，在 `README.md` 中找到 `qiqll/dsh-task-suite` 那一行。
3. 用上面的“新版英文条目”整行替换旧行；中文版可作为 PR 描述，不必同时放进 README。
4. 提交信息：`docs: update dsh-task-suite entry for 1.1.0`。
5. 提 PR，标题：`Update dsh-task-suite entry for 1.1.0`；描述里附 1–2 张截图和 release 链接。
6. PR 合并后，回到 DSH 插件市场刷新缓存/重启客户端，确认条目描述和版本。

## 发布前检查

- [ ] GitHub 仓库 `main` 已是 1.1.0，且打了 `v1.1.0` tag
- [ ] `npm view dsh-task-suite version` 返回 `1.1.0`
- [ ] Release Notes 链接可访问
- [ ] 市场条目描述不再只讲文件任务池
- [ ] 至少有一张真实面板截图
