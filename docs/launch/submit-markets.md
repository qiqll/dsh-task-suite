# 市场投稿操作单（1.2.0）

> 面向作者本人执行：每条只写「打开哪个页面、粘什么、提交后看什么」。
> 详细论证、校验器用法和风险分析见 [`docs/marketplace-submissions.md`](../marketplace-submissions.md)；本页是执行顺序。

## 事实基线（2026-11-26）

| 项 | 值 |
|---|---|
| npm | `dsh-task-suite@1.2.0`（latest） |
| tag / commit | `v1.2.0` → `433fcba07cefcd3aae71a6b1ab9d178295412b2e` |
| Release | https://github.com/qiqll/dsh-task-suite/releases/tag/v1.2.0 |
| License / topic | MIT / `dsh-plugin` |
| dshWorkshop | 已包含在 1.2.0 的 `package.json`（OMDSH 前置） |

两个可直接粘贴的载荷已经生成并通过官方校验器：

- [`omdsh-submission.json`](../submissions/omdsh-submission.json) —— `intake.mjs validate` 通过，id = `dsh-task-suite@1.2.0`
- [`dsh-go-plugin.json`](../submissions/dsh-go-plugin.json) —— `check.mjs`：`passed: true`，risk `medium`（shell / network / filesystem 启发式）

---

## 1. OMDSH Hub（唯一需要人工审核 + 签名 registry 的市场）

**打开**：https://github.com/omdsh-dev/dsh-hub-workshop/issues/new?template=extension-submission.yml

1. 标题填：`[Submission] dsh-task-suite 1.2.0`
2. 唯一的必填 textarea「Author Studio manifest」：把 [`omdsh-submission.json`](../submissions/omdsh-submission.json) **全文**粘进去（不要包代码块、不要改字段）
3. 勾选表单底部的确认项，提交

**提交后看什么**：

- 机器人会只读核验公开仓库、固定 commit 和 `packageManifest`，然后在独立分支写 `pending-review` 记录并开审核 PR
- 关注 PR 里是否出现 `intake/records/dsh-task-suite@1.2.0.json`
- 状态查询：

```sh
curl -s https://raw.githubusercontent.com/omdsh-dev/dsh-hub-workshop/main/intake-queue.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print([r["id"] for r in d["records"] if "dsh-task-suite" in r["id"]])'
```

**预期**：进入 `pending-review`，不是立刻 `admitted`。原因写在该文档 §1.8：Workshop 基线是 `@deepseek-ai/dsh@0.1.0-rc.6`，我们只在 `0.2.1-rc.5` 验证过，`evidence` 全为 `null`。这是如实声明，不要为了过审伪造证据。

---

## 2. DSH Go 市场（一条 JSON 的 PR）

**步骤**：

1. Fork https://github.com/ccch1mneyyy/dsh-go-market
2. 新增 `plugins/dsh-task-suite.json`，内容 = [`dsh-go-plugin.json`](../submissions/dsh-go-plugin.json)
3. 向 `main` 提 PR

**PR 标题**：`Add dsh-task-suite 1.2.0`

**PR 正文**（可直接用）：

```markdown
## 插件

- 名称：`dsh-task-suite`（DSH 任务流水线 / Task Pipeline）
- 仓库：https://github.com/qiqll/dsh-task-suite
- npm：https://www.npmjs.com/package/dsh-task-suite（精确版本 `1.2.0`）
- License：MIT

## 用途

把单个 DSH Agent 变成一支工程团队：Markdown 任务池、主 Agent 只调度、后台 worker 在独立上下文交付、机器验收（重跑测试 / 基线比对 / 测试改弱审计），附只读 Web 面板。git 可选，普通目录自动降级为文件快照。

## 权限说明

扫描器会标记 `shell` / `network` / `filesystem`，这是插件的工作方式决定的，不是隐蔽行为：

- `shell`：`task_verify` 要在基线 worktree 里重跑项目的测试命令；
- `filesystem`：读写 `.dsh/tasks/*.md` 任务池与非 git 模式的快照；
- `network`：只读 npm / GitHub 上的公开版本信息，不发起外部写操作。

## 检查清单

- [x] 使用 npm 上已发布的精确版本 `1.2.0`（非 `^` / `latest`）
- [x] MIT 许可，公开仓库
- [x] `dsh.bundle.patch` → `cordis.patch.yml` 已在 npm tarball 内
- [x] 本地跑过 `node scripts/check.mjs`：`passed: true`
- [x] 截图直链指向 `v1.2.0` 固定 tag
```

**本地复核**（可选，已验证过一次）：

```sh
cd /tmp && rm -rf dsh-go-market-main
curl -sSL https://codeload.github.com/ccch1mneyyy/dsh-go-market/tar.gz/refs/heads/main | tar xz
cd dsh-go-market-main && npm ci --ignore-scripts
mkdir -p /tmp/dsh-go-candidate && cp /path/to/dsh-go-plugin.json /tmp/dsh-go-candidate/dsh-task-suite.json
node scripts/check.mjs /tmp/dsh-go-candidate
```

**合并后验证**：`curl -s -o /dev/null -w '%{http_code}\n' https://go.dshtui.com/p/dsh-task-suite` 应从 404 变 200。

---

## 3. hrhgit 目录（请求重扫）

**打开**：https://github.com/hrhgit/deepseek-harness-plugin-manager/issues/new

**标题**：`Add qiqll/dsh-task-suite (npm 1.2.0) and fix stale sitemap URLs returning 404`

**正文**：直接复制 [`issue-hrhgit.md`](../submissions/issue-hrhgit.md) 里的整段（标题、正文都在里面；论证细节见 [`marketplace-submissions.md`](../marketplace-submissions.md) §3）。核心三点：

1. 仓库已打 `dsh-plugin` topic，npm 有 1.2.0、MIT、公开仓库——但 catalog 的 `generatedAt` 停在 2026-08-14；
2. 该目录只扫 topic 下最新 1000 个仓库，我们被窗口截断；
3. 请求 full reconcile，并给出重扫后的校验命令。

---

## 4. DSH Get（补录 + 修 sitemap）

**打开**：https://github.com/bobby-sheng/dshget-data/issues/new

**正文**：直接复制 [`issue-dshget.md`](../submissions/issue-dshget.md) 里的整段（论证细节见同文档 §4）。要说明的是：sitemap 里有 EN/ZH 两个 URL 但都 404，公开快照 `catalog.json` 2460 条里没有我们——属于抓取/快照问题，不是条目不合格。

---

## 不建议再投的（已自动覆盖）

| 市场/目录 | 原因 |
|---|---|
| dshmarket、dsh-plugin-catalog、bradeGithub、AwesomeHou、DSH Get 的聚合 | 读 awesome / topic / npm，1.2.0 发布后自动更新，无需投稿 |
| dsh-plugin.org、dsh-hub.cc | 已有详情页，只需要争取推荐位（找作者聊，不是投条目） |
| DSH 0.2.1 内置 Discover | 读 format-1 index，自动可见 |

## 发完怎么统一验证

```sh
# npm
npm view dsh-task-suite version            # 1.2.0

# OMDSH 队列
curl -s https://raw.githubusercontent.com/omdsh-dev/dsh-hub-workshop/main/intake-queue.json \
  | python3 -c 'import sys,json; print([r["id"] for r in json.load(sys.stdin)["records"] if "dsh-task-suite" in r["id"]])'

# DSH Go 条目
curl -s -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/ccch1mneyyy/dsh-go-market/main/plugins/dsh-task-suite.json
```
