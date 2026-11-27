# 中文社区：V2EX 分享创造 + 即刻短帖

> **发布方式：由用户用自己的账号手动发布**（不代发、不 @ 人、不刷屏）。
> 事实口径见 [README.md](README.md)。
> 两篇都按「四个变化 + 一条底线」的结构写；底线即「四道关，换一个完成」。

---

## 1. V2EX（节点：分享创造）

- 节点：`分享创造`（可同时勾 `程序员`；不要再发到 `酷工作` 或 `问与答`）。
- 标题（二选一，推荐第一个）：

  ```text
  [开源] 把需求丢进 Markdown 任务池，DSH 后台 Agent 交付，机器验收四道关才叫完成
  ```

  ```text
  [开源] 主 Agent 只派活，后台 Agent 写代码，验收由机器跑四道关
  ```

- 长度：正文 **约 330 字**（要求 200–400 字，不含链接与命令）。
- 配图 / GIF：
  - `[截图占位：docs/screenshots/dashboard-running.png —— 面板显示当前任务、worker、指标、事件流]`
  - `[截图占位：docs/screenshots/pipeline-overview.png —— 主 Agent → 后台 worker → 机器验收]`
  - `[GIF 可选：docs/screenshots/dashboard.gif 尚未录制；不发也能发帖，别放破图占位]`
  - V2EX 插图要先传到图床（sm.ms / 自建），正文里贴图床直链；本地路径贴上去别人看不到。
- UTM：`?utm_source=v2ex&utm_medium=post`

### 正文（直接复制；V2EX 里代码命令单独一行）

```text
用 Agent 写代码，累的往往不是写，是陪：它做一件，我等一件；想到新需求，还得等它忙完才能说。

所以我写了 dsh-task-suite，一个 DeepSeek Harness 插件（MIT）。四个变化：

1. 任务池就是仓库里的 Markdown：.dsh/tasks/backlog.md，能看、能改、能 diff，不用开数据库。
2. 主 Agent 只调度：拆任务、排期、派活、验收。写代码的是全新上下文的后台 subagent，不会被上一个任务带偏。
3. 需求可以异步投：会话里说一句，或 task_inbox 投一条，正在跑的任务不被打断。
4. 右侧栏有只读面板，看当前任务、待验证、待决策和流水（依赖 dsh-better-sidebar，装完要完整重启一次）。

底线只有一条：四道关，换一个「完成」。每次派活发一次性 nonce，报告对不上直接丢；commit 必须带任务 ID；失败用例回开工基线重跑，只有基线也挂的才算既有失败；删用例、加 skip、断言变少会被单独审计。四道关过了是「待验证」，你确认了才归档。

git 不是必需：普通目录自动走文件快照，四道关一样跑。不 push，不碰 main。

已收录进 DSH Go 市场（go.dshtui.com/p/dsh-task-suite）和 awesome-dsh-plugin。
安装：
dsh plugin --profile desktop add dsh-task-suite

介绍页：https://qiqll.github.io/dsh-task-suite/?utm_source=v2ex&utm_medium=post
仓库：https://github.com/qiqll/dsh-task-suite

刚发 1.1.1，star 还是 0，算是冷启动。想先问一句：你更在意「测试有没有被改弱」，还是「改动有没有越界」？评论区聊聊，下个版本优先做哪个。
```

### 发布备注

- 钩子句：`累的往往不是写，是陪`。
- 四个变化：Markdown 池 / 主 Agent 只调度 / 异步投递 / 只读面板。
- 底线：四道关（nonce、提交归属、基线比对、改弱审计）→ 待验证 → 人确认。
- 结尾只问一个二选一，别一次问三个；不承诺版本号和日期。
- 发完 24 小时内把「已回复」标在本目录 README 的发布记录里；没人回也不要顶帖。

---

## 2. 即刻（短帖）

- 长度：**约 220 字**（要求 200–400 字）。
- GIF 占位：`docs/screenshots/dashboard.gif`（待录；没有就只发 3 张图）。
- 配图：3–4 张，顺序 `dashboard-overview.png` → `dashboard-running.png` → `pipeline-overview.png`；有 GIF 就放第 1 位。
- UTM：`?utm_source=jike&utm_medium=post`
- 话题：`#AI编程` `#开源` `#效率工具`（不要堆标签）。

### 正文（直接复制）

```text
做了个 DeepSeek Harness 插件 dsh-task-suite：需求丢进仓库里的 Markdown 任务池，主 Agent 只派活和验收，写代码的是全新上下文的后台 subagent。

最想解决的是「敢不敢放手」。每次派活发一次性 nonce，报告对不上直接丢；commit 必须带任务 ID；测试失败要回开工基线重跑，只有基线也挂的才算既有失败；删用例、加 skip、断言变少会被审计出来。四道关全过才是「待验证」，你点确认才归档。所以可以下班前丢几条需求进去，第二天早上只看「待验证」和「待决策」两个列表。

git 不是必需，普通目录走文件快照。不 push，不碰 main。右侧栏有只读面板，装完要完整重启一次（依赖 dsh-better-sidebar）。

这个插件自己的开发任务也是这么排的：9 个任务已经归档，打回 0 次。

刚发 1.1.1，star 还是 0。冷启动期，欢迎拍砖。

已收录进 DSH Go 市场（go.dshtui.com/p/dsh-task-suite）和 awesome-dsh-plugin。
安装：
dsh plugin --profile desktop add dsh-task-suite

https://qiqll.github.io/dsh-task-suite/?utm_source=jike&utm_medium=post
```

### 发布备注

- 即刻正文不支持 Markdown 代码块，`dsh plugin ...` 单独占一行即可。
- 第一张图用面板截图，别用 Logo；图里不要出现本地路径和密钥。
- 同一天只发这一条，不要连发多条同主题内容。

---

## 事实与措辞检查（发前逐条打勾）

- [ ] 版本 `1.1.1`、许可 MIT。
- [ ] 安装命令完整：`dsh plugin --profile desktop add dsh-task-suite`。
- [ ] 写了面板依赖 `dsh-better-sidebar` 且要完整重启。
- [ ] 写了 git 可选、普通目录走快照、不 push、不碰 main。
- [ ] 四道关顺序正确：nonce → 提交归属 → 基线比对 → 改弱审计。
- [ ] 完成态写的是「待验证」，不是「已完成 / 自动上线」。
- [ ] 没有「最强」「第一」「唯一」「彻底解决」这类词。
- [ ] 1 star 的冷启动事实保留，没有编造用户数、下载量、运行数字。
- [ ] 截图 / GIF 已上传图床（或已确认 V2EX 支持直传），正文里没有本地绝对路径。
- [ ] 两个链接带 UTM 且可打开。
