# 发布工具包（Launch kit）

本目录只有一件事：把 `dsh-task-suite` 1.2.0 的对外文案定稿与投稿操作单，让**用户用自己的账号**在正确的地方发一次。

- **不代发**：所有帖子、issue 都由用户账号发布，Agent 不登录、不点发布按钮。
- **不 @ 人**：不 @ 维护者、不 `@everyone` / `@here`、不在别人帖下贴链接。
- **不刷屏**：同一渠道同一版本只发一次；同一天最多两个渠道。
- **1 star 冷启动**：文案里保留「刚发布 / 1 star」的诚实说明，不编造用户量、下载量、运行数字。

---

## 事实口径（统一，版本 1.2.0）

| 项 | 值 |
|---|---|
| 名称 | `dsh-task-suite`（中文名：DSH 任务流水线） |
| 版本 / 许可 | `1.2.0` / MIT |
| npm | https://www.npmjs.com/package/dsh-task-suite |
| 仓库 | https://github.com/qiqll/dsh-task-suite |
| 介绍页 | https://qiqll.github.io/dsh-task-suite/ |
| 插件市场 | https://awesome-dsh-plugin.com（分类 `workflow`）· https://go.dshtui.com/p/dsh-task-suite（DSH Go，2026-11-27 收录） |
| 安装 | `dsh plugin --profile desktop add dsh-task-suite`（Web 版 `--profile web`） |
| 面板 | 只读；依赖 `dsh-better-sidebar`；首次装完需**完整退出并重开 DSH** |
| 基线 | git 可选；无仓库时用文件快照，验收口径不变 |
| 机器验收四道关 | ① 一次性 nonce ② 提交归属（commit 带任务 ID / 快照差异归属） ③ 开工基线重跑失败用例 ④ 测试改弱审计 |
| 完成态 | 「待验证」→ 人确认后才归档（不是自动上线） |
| 运行方式 | 同一时刻只跑一个 worker（串行），不宣传并行团队 |
| 社区 | Discord https://discord.gg/4MrtZUhpxg · 反馈入口 https://github.com/deepseek-ai/deepseek-harness/discussions |
| 冷启动 | GitHub star = 1（发帖当天自行核对一次，别引用旧数） |

> 文案里凡是出现「四道关」，顺序固定为 **nonce → 提交归属 → 基线比对 → 改弱审计**。
> 凡是出现安装命令，写全 `--profile desktop`，不要缩写成 `dsh plugin add`。

---

## 文件索引

| 文件 | 渠道 | 语言 | 长度（正文） | 状态 |
|---|---|---|---|---|
| [en-discord-discussions.md](en-discord-discussions.md) | DSH Discord `#showcase` | 英文 | 183 words | 待发 |
| 同上 §2 | GitHub Discussions（Show and tell） | 英文 | 185 words | 待发 |
| [zh-v2ex-jike.md](zh-v2ex-jike.md) | V2EX 分享创造 | 中文 | 333 字 | 待发 |
| 同上 §2 | 即刻短帖 | 中文 | 232 字 | 待发 |
| [newsletters.md](newsletters.md) | 阮一峰《科技爱好者周刊》 | 中文 | 96 字（介绍段） | 待投 |
| 同上 §2 | HelloGitHub 月刊 | 中文 | 81 字（描述段） | 待投 |
| [submit-markets.md](submit-markets.md) | 四个市场/目录的投稿操作单 | 中文 | — | 待投 |

长度口径：英文按单词数；中文按**汉字数**统计，链接、安装命令、英文标识符不计入。发帖平台的字数限制都不在这个量级，不需要为了凑数扩写。文案与清单里的图片路径都相对**仓库根目录**（例如 `docs/screenshots/dashboard-running.png`）。

> 旧稿（1.1.0，仅存档）：[`zh.md`](zh.md) · [`en.md`](en.md) · [`channels.md`](channels.md) · [`checklist.md`](checklist.md) · [`social.md`](social.md) · [`positioning.md`](positioning.md)。

---

## 发布顺序

### P0 — 素材与链路（发任何帖子之前）

- [ ] `dsh plugin --profile desktop add dsh-task-suite` 在**干净 profile** 里装一次，确认 1.2.0 可安装、`task_init` 可用、三个 skill 注册。
- [ ] 装完**完整退出并重开 DSH**，确认右下角「任务流水线」入口出现；没装 `dsh-better-sidebar` 时任务工具仍可用，只是没有面板。
- [ ] 面板截图就位：`docs/screenshots/dashboard-overview.png`、`dashboard-running.png`、`dashboard-verify.png`、`pipeline-overview.png`；GIF 没有也能发，但不要放破图占位。
- [ ] 截图里没有 API Key、token、`/Users/<name>` 等本地路径。
- [ ] 介绍页 https://qiqll.github.io/dsh-task-suite/ 能打开；仓库 README 的安装命令与文案一致。
- [ ] 两个链接各点一次，确认 UTM 参数没把页面打挂（GitHub Pages 会保留 query）。

### 英文社区（D0）

1. **Discord**：先发。轻量、反馈快，先把「哪里会坏」的问题抛出去。
2. **GitHub Discussions**：同日或次日发首发帖。选对分类，标题用 `en-discord-discussions.md` 里给的。

### 中文社区（D1）

3. **V2EX**：工作日 10:00–11:30 发，节点「分享创造」。图先上图床。
4. **即刻**：V2EX 当天晚上发，配 3–4 张图，正文精简版。

### 周刊 / 月刊（D3–D7）

5. **阮一峰周刊**：周二到周四投 issue，一期只投一次。
6. **HelloGitHub**：随时投 issue，按月刊排期。

> 顺序按「先英文、后中文、最后周刊」排，是因为英文社区反馈最快、周刊编辑周期最长。
> 如果更在意周刊的排期，可以在 D1 就投周刊，但**不要**把周刊提到英文社区之前发。

---

## 每个渠道「发之前」检查清单

### Discord

- [ ] 频道是 `#showcase`（没有就用 `#plugins`），已读频道置顶规则。
- [ ] 只发 1 张图（`dashboard-running.png`），不连发多条。
- [ ] 正文里的链接带 `utm_source=discord&utm_medium=post`。
- [ ] 没有 @ 任何人；没有 `@everyone` / `@here`。
- [ ] 保留 1 star 那句，不删。
- [ ] 发完 24 小时内回一次评论；有人问安装失败，先要 `dsh --version` 和 profile 名。

### GitHub Discussions

- [ ] 分类选 `Show and tell`（没有就 `General`），不发在 bug / feature 分类。
- [ ] 标题没有全大写、没有 emoji 堆叠。
- [ ] 首图上传到帖子（拖拽），不用本地路径。
- [ ] 链接带 `utm_source=github-discussions&utm_medium=post`。
- [ ] 提问只留一个（测试审计 / 决策队列 / 回滚 三选一），别再追加第二问。
- [ ] 不承诺 roadmap、不给日期。

### V2EX

- [ ] 节点「分享创造」，标题以 `[开源]` 开头。
- [ ] 正文是纯文本可读：命令单独一行，链接不要藏在 Markdown 语法里。
- [ ] 两张图 + GIF 已上图床，正文贴直链；GIF 控制在 8 MB 内。
- [ ] 正文里 1 star 与「刚发 1.2.0」保留。
- [ ] 结尾只问一个问题；不写「求 star / 求支持」。
- [ ] 发完不自己顶帖；有人问才回。

### 即刻

- [ ] 图 3–4 张，第一张是面板截图，不是 Logo。
- [ ] 代码命令单独一行（即刻不渲染代码块）。
- [ ] 话题 3 个以内，不堆标签。
- [ ] 链接带 `utm_source=jike&utm_medium=post`。
- [ ] 同一天不发第二条同主题内容。

### 阮一峰周刊

- [ ] 走 GitHub issue（`ruanyf/weekly`），选「开源项目自荐」模板。
- [ ] 周二到周四提交；一期只投一次；没选上不重投。
- [ ] 正文只讲机制，不写「求 star」，不超过 150 字。
- [ ] 链接带 `utm_source=ruanyf-weekly&utm_medium=issue`。
- [ ] issue 里最多 1 张图，别刷 5 张。

### HelloGitHub

- [ ] 走 GitHub issue（`521xueweihan/HelloGitHub`），选自荐 / 推荐模板。
- [ ] 字段齐全：项目地址、类别、标题、描述、亮点、截图。
- [ ] 截图用 raw 直链，发前点一次确认 200。
- [ ] 描述 80–150 字，不堆形容词。
- [ ] 链接带 `utm_source=hellogithub&utm_medium=issue`。
- [ ] 不 @ 编辑、不催审。

---

## UTM 规则

统一格式：

```text
https://qiqll.github.io/dsh-task-suite/?utm_source=<channel>&utm_medium=<medium>&utm_campaign=launch-1.2.0
```

帖子正文里为了可读性只写了 `utm_source` + `utm_medium`；正式发布时补上 `utm_campaign=launch-1.2.0` 即可（三段都在，统计才分得开版本）。

| 渠道 | `utm_source` | `utm_medium` |
|---|---|---|
| Discord | `discord` | `post` |
| GitHub Discussions | `github-discussions` | `post` |
| V2EX | `v2ex` | `post` |
| 即刻 | `jike` | `post` |
| 阮一峰周刊 | `ruanyf-weekly` | `issue` |
| HelloGitHub | `hellogithub` | `issue` |
| 评论区二次回复 | 同上 | `comment` |

约定：

- 只给**介绍页**加 UTM；GitHub 仓库链接保持干净，不要加参数（GitHub 自己会记 referrer，加了反而显得脏）。
- 安装命令永远不带参数。
- 全部小写、用连字符，不要中文、空格、大写。
- 同一渠道发第二轮时，把 `utm_campaign` 改成 `launch-1.2.0-r2`，不要覆盖第一轮数据。
- 周报 / 月刊如果编辑改写了链接，以编辑的版本为准，在自己的发布记录里注明「链接被改写」。

---

## 来源与改写说明

- 口径基线：本仓库 [`README.md`](../../README.md)（版本、安装、四道关、两种基线模式）+ 已归档的 `docs/screenshots/README.md`。
- 结构与语气参考：`/tmp/claude-task/docs/promo/messaging.md`（四个卖点 + 一个护城河、「诚实边界」）与 `/tmp/claude-task/docs/promo/posts.md`（V2EX / 即刻 / 周刊 / HelloGitHub 的段落骨架）。
- **改写而非搬运**：参考素材是另一个项目（claude-task）的文案，渠道格式和叙事顺序借用，事实、命令、链接、产品行为全部换成 `dsh-task-suite` 的。没有保留 claude-task 的 `/plugin install` 命令、`refs/auto-failed/*` 路径、`.claude/` 目录等细节。
- 同目录的 `channels.md` / `zh.md` / `en.md` / `checklist.md` / `social.md` / `positioning.md` 是 1.1.0 时的旧稿，本次不改写、也不删除，仅作背景参考；以本文件索引的 1.2.0 版本为准。
- 四道关的表述来自 `README.md` 的「验收与防作弊」一节，并保持 `lib/accept.js` 的实际顺序。
- 「这个插件自己的开发任务也是这么排的：9 个任务已归档，打回 0 次」来自 `.dsh/tasks/dev-progress.md` 的统计行（2026-11 时点）。**发帖前请重新核对**；数字变了就删掉这句，不要改写成更大的数。

---

## 需要用户补充的素材 / 账号

| 项 | 用途 | 说明 |
|---|---|---|
| `docs/screenshots/dashboard.gif` | V2EX / 即刻 / Discord 动态演示 | 45–60 秒、≤8 MB、12–15 fps；录制方法见 `docs/screenshots/README.md` |
| `docs/screenshots/dashboard-verify.png` | 「待验证」状态图 | 目前缺；没有就用 `dashboard-running.png` 顶上 |
| 图床账号（sm.ms 等） | V2EX 正文插图 | V2EX 不能直传本地图；也可用 GitHub raw 直链 |
| V2EX 账号 | 发分享创造 | 新号可能被限制发帖，先养号或换老号 |
| 即刻账号 | 发短帖 | 需绑定手机号 |
| GitHub 账号 | Discussions + 两个周刊 issue | 就是仓库 owner 账号；Discussions 需要仓库/组织开启 |
| Discord 账号 | DSH 官方服务器 | 先加入服务器，读频道规则 |
| 真实运行数字（可选） | 加强说服力 | 跑一晚后从 `.dsh/tasks/auto/run.log` 取真实结果；没有就不写 |

---

## 发布记录（发完填）

| 日期 | 渠道 | 链接 | UTM campaign | 24h 反馈 | 是否已回 |
|---|---|---|---|---|---|
| — | — | — | `launch-1.2.0` | — | — |

复盘只看两件事：介绍页来源（UTM）、issue/帖子里被问得最多的问题。第二个问题写进 1.2.0 的 backlog，不要在现场承诺。
