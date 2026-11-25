# 周刊 / 月刊自荐：阮一峰科技周刊 + HelloGitHub

> **提交方式：由用户用自己的账号提交**（不代发、不 @ 人、不刷屏）。
> 两个入口都是 **GitHub issue**，不是邮件、不是表单、不是私信。
> 事实口径见 [README.md](README.md)。

---

## 1. 阮一峰《科技爱好者周刊》

- 提交入口：https://github.com/ruanyf/weekly/issues/new → 选「开源项目自荐」模板（没有模板就按下面的字段手写）。
- 提交时间：**周二到周四**；一期只投一次，**没选上不要重投**。
- 自荐正文长度：**约 100 字**（要求 80–150 字，不含标题与链接）。
- UTM：`?utm_source=ruanyf-weekly&utm_medium=issue`

### 标题

```text
dsh-task-suite：给 DeepSeek Harness 的任务池插件
```

### 正文（直接复制）

```text
链接：https://github.com/qiqll/dsh-task-suite
介绍页：https://qiqll.github.io/dsh-task-suite/?utm_source=ruanyf-weekly&utm_medium=issue

介绍：一个 DeepSeek Harness 插件。需求写进仓库里的 Markdown 任务池，主 Agent 只派活，后台 subagent 在全新上下文里逐条实现；交付前要过四道机器验收：一次性 nonce、commit 归属、开工基线重跑、测试改弱审计，通过后进「待验证」，人确认才归档。git 可选，普通目录用文件快照；右侧栏有只读面板（作者自荐）。
```

### 提交备注

- 周刊偏好「项目本身有意思」，正文只讲机制，不要写「求 star」。
- 如果编辑回复要图，再补 `docs/screenshots/dashboard-running.png`；issue 里不要一次贴 5 张。
- 周刊会改写介绍，被选上后不用再纠错别字；没被选上就等下一个项目，不要重复投。

---

## 2. HelloGitHub 月刊

- 提交入口：https://github.com/521xueweihan/HelloGitHub/issues/new → 选「自荐项目 / 推荐项目」模板（没有模板就按下面的字段手写）。
- 提交时间：随时可投，按月刊排期收录；一期只投一次。
- 自荐正文长度：**约 82 字**（要求 80–150 字，不含字段名与链接）。
- UTM：`?utm_source=hellogithub&utm_medium=issue`

### 标题

```text
【自荐】dsh-task-suite：DeepSeek Harness 的任务流水线插件
```

### 正文（直接复制）

```text
项目地址：https://github.com/qiqll/dsh-task-suite
介绍页：https://qiqll.github.io/dsh-task-suite/?utm_source=hellogithub&utm_medium=issue
类别：其它（AI / 效率工具）
项目标题：给 DeepSeek Harness 加一条任务流水线

项目描述：需求进 .dsh/tasks 的 Markdown 池，主 Agent 只调度，后台 subagent 逐条交付；验收由机器跑四道关，分别管一次性口令、提交归属、基线比对、测试改动审计，全部过了才是「待验证」，人确认才归档。git 可选，普通目录用文件快照；右侧栏有只读面板（需 dsh-better-sidebar）。MIT。

亮点：任务池是纯文本，可读可改；非 git 目录也能用；面板只读，不写任务池。

截图：https://raw.githubusercontent.com/qiqll/dsh-task-suite/main/docs/screenshots/dashboard-running.png
```

### 提交备注

- `类别` 按 HelloGitHub 当期模板的选项填；没有「AI / 效率工具」就选最接近的「其它」。
- 截图用 GitHub raw 直链，**发前点一次确认能打开**；不要用本地路径或临时图床。
- HelloGitHub 编辑会自己压缩介绍，字段里的「亮点」尽量短，一行一条。

---

## 事实与措辞检查（提交前逐条打勾）

- [ ] 版本 `1.1.1`、许可 MIT、npm 包名 `dsh-task-suite`。
- [ ] 介绍里四道关顺序正确：nonce → 提交归属 → 基线比对 → 改弱审计。
- [ ] 写了「完成态是待验证，人确认才归档」，没有写「全自动」。
- [ ] 写了 git 可选（普通目录走文件快照），没有暗示必须有 git。
- [ ] 面板依赖 `dsh-better-sidebar` 的说法保留（如果当期字数超了，可删面板句，不要删四道关）。
- [ ] 没有「最强」「第一」「唯一」「革命性」这类词。
- [ ] 0 star 的冷启动事实：周刊/月刊正文里不写 star 数，但也不编造用户量。
- [ ] 介绍页链接带 UTM；GitHub 仓库链接保持干净，不加参数。
- [ ] 用自己账号提交，issue 里不 @ 编辑，不催审。
