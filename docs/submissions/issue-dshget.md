# Issue：bobby-sheng / dshget-data

**新建地址**：https://github.com/bobby-sheng/dshget-data/issues/new

**标题**（复制这一行）：

```text
Add qiqll/dsh-task-suite (npm 1.2.0) and fix stale sitemap URLs returning 404
```

**正文**（复制下面整块，不含最外层的围栏）：

````markdown
## Summary

`qiqll/dsh-task-suite` is a public MIT DSH bundle (`dsh-task-suite@1.2.0` on npm). It is **not** in the snapshot `catalog.json`, while the live sitemap already advertises two detail URLs that currently return **404**. Please add the plugin and regenerate the sitemap from the actual catalog.

## What I checked (2026-11-26)

### Live sitemap

Both URLs are present in `https://dshget.com/sitemap.xml` with `lastmod 2026-11-03T14:50:22.000Z`:

- `https://dshget.com/plugins/qiqll/dsh-task-suite`
- `https://dshget.com/zh/plugins/qiqll/dsh-task-suite`

Both currently return HTTP 404.

### Snapshot repository

`catalog.json` in this repository:

- `count: 2460`
- `updated: "2026-08-16"`
- `syncedAt: "2026-08-16T14:41:10.955Z"`
- zero occurrences of `dsh-task-suite` or `qiqll`

The live site header says 14,498 extensions, so the snapshot is also well behind the live site.

### Source facts

- Repository: https://github.com/qiqll/dsh-task-suite (public, MIT)
- npm: `dsh-task-suite@1.2.0`, published `2026-11-26T12:40:50.066Z`
- GitHub topic: `dsh-plugin`
- `package.json` declares `dsh.bundle.patch = "./cordis.patch.yml"`; the file is in the npm tarball
- Install: `dsh plugin --profile web add dsh-task-suite` (desktop users can use `--profile desktop`)
- Homepage: https://qiqll.github.io/dsh-task-suite/

## Reproduction

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://dshget.com/plugins/qiqll/dsh-task-suite
# 404

curl -s -o /dev/null -w '%{http_code}\n' https://dshget.com/zh/plugins/qiqll/dsh-task-suite
# 404

curl -s https://raw.githubusercontent.com/bobby-sheng/dshget-data/main/catalog.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["count"], d["updated"], sum(1 for p in d["plugins"] if p["name"]=="dsh-task-suite"))'
# 2460 2026-08-16 0
```

For comparison, a known entry in the same snapshot resolves in the Chinese locale:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://dshget.com/zh/plugins/omdsh-dev/7d7d
# 200
```

The English detail URL for that same known entry returned 404 during this check, so please also verify the English locale routing while regenerating.

## Expected entry

```json
{
  "name": "dsh-task-suite",
  "owner": "qiqll",
  "url": "https://github.com/qiqll/dsh-task-suite",
  "page": "https://github.com/qiqll/dsh-task-suite",
  "category": "workflow",
  "description": {
    "en": "Turn one DSH agent into a small engineering team: a Markdown task pool, a lead agent that dispatches isolated background workers, machine-verified acceptance (test rerun, baseline diff, test-weakening audit), async intake, and a read-only Web dashboard. Git optional.",
    "zh": "把单个 DSH Agent 变成一支工程团队：Markdown 任务池、主 Agent 调度、后台 worker 交付、机器验收（重跑测试、基线比对、测试改弱审计），需求可异步投递，附只读 Web 面板；git 可选。"
  },
  "npm": "dsh-task-suite",
  "stars": 0,
  "install": "dsh plugin --profile web add dsh-task-suite",
  "added": "2026-11-26",
  "sources": ["github-topic", "awesome-dsh-plugin"],
  "verification": null,
  "installable": true,
  "license": "MIT",
  "version": "1.2.0",
  "featured": false,
  "tags": ["dsh-plugin", "task-management", "orchestration", "subagent", "workflow", "automation", "dashboard"]
}
```

## Ask

1. Add the entry to the next snapshot (npm + GitHub topic are the source of truth).
2. Regenerate the sitemap from pages that actually exist, or remove the two stale URLs until the detail page is generated.
3. If English detail pages are currently broken for all entries, please track that separately; the Chinese route works for known entries.

Thank you!
````

> 正文中的版本号、commit、日期已按 1.2.0 对齐；提交前可再核对一次 `npm view dsh-task-suite version`。
