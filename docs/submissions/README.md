# 投稿载荷（可直接粘贴）

这两个文件是给市场投稿用的**成品**，字段已按 `1.2.0` 填好，不含占位符、密钥或本地路径。

| 文件 | 用于 | 对应文档 |
|---|---|---|
| `omdsh-submission.json` | OMDSH Hub 的「Author Studio manifest」 textarea | [submit-markets.md §1](../launch/submit-markets.md#1-omdsh-hub唯一需要人工审核--签名-registry-的市场) |
| `dsh-go-plugin.json` | DSH Go 市场的 `plugins/dsh-task-suite.json` | [submit-markets.md §2](../launch/submit-markets.md#2-dsh-go-市场一条-json-的-pr) |
| `pr-dsh-go.md` / `pr-dsh-go-body.md` | DSH Go 的 PR 标题+正文（后者是纯正文，供 `gh --body-file`） | [submit-markets.md §2](../launch/submit-markets.md#2-dsh-go-市场一条-json-的-pr) |
| `issue-hrhgit.md` | hrhgit 目录的 issue 标题 + 正文 | [submit-markets.md §3](../launch/submit-markets.md#3-hrhgit-目录请求重扫) |
| `issue-dshget.md` | DSH Get 的 issue 标题 + 正文 | [submit-markets.md §4](../launch/submit-markets.md#4-dsh-get补录--修-sitemap) |

## 已通过的校验（2026-11-26）

```text
node scripts/intake.mjs validate omdsh-submission.json
→ submission accepted for pending review; no repository code was executed
→ prepare: id = dsh-task-suite@1.2.0

node scripts/check.mjs <dir with dsh-task-suite.json>
→ passed: true, warnings: shell/network/filesystem/not-adapted, risk: medium
```

## 发新版本时怎么重新生成

1. 改 `omdsh-submission.json` 里的 `release.version`、`release.ref`（`git rev-parse vX.Y.Z`）、`release.updatedAt`、`release.changelog`；
2. `dsh-go-plugin.json` 里的 `version` 与三条截图直链的 tag；
3. 重新跑上面两条校验命令，必须仍然通过；
4. 同步 `docs/marketplace-submissions.md` 的事实基线表。

> `packageManifest` 必须与 tag 内 `package.json#dshWorkshop` **逐值相等**（Issue 自动化用 `deepStrictEqual` 比对）。改了 `package.json` 的 `dshWorkshop` 就要同步这里，否则会被判 `needs-fix`。
