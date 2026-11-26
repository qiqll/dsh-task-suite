# Issue：hrhgit / deepseek-harness-plugin-manager

**新建地址**：https://github.com/hrhgit/deepseek-harness-plugin-manager/issues/new

**标题**（复制这一行）：

```text
[catalog] qiqll/dsh-task-suite missing from catalog/v2 (npm 1.2.0, dsh-plugin topic set)
```

**正文**（复制下面整块，不含最外层的围栏）：

````markdown
## Summary

`qiqll/dsh-task-suite` is a public MIT DeepSeek Harness bundle published to npm as `dsh-task-suite@1.2.0`. The repository has the `dsh-plugin` topic and its `package.json` declares `dsh.bundle.patch`, but `catalog/v2/catalog.json` contains no entry for the package or the repository.

## Verifiable facts

- Repository: https://github.com/qiqll/dsh-task-suite (public, default branch `main`, license MIT)
- GitHub topic: `["dsh-plugin"]`
- npm: `dsh-task-suite@1.2.0`, published `2026-11-26T12:40:50.066Z`, license MIT
- npm `repository.url`: `git+https://github.com/qiqll/dsh-task-suite.git` (matches the repository owner/name)
- `package.json` at tag `v1.2.0` (commit `433fcba07cefcd3aae71a6b1ab9d178295412b2e`):
  - `dsh.bundle.patch = "./cordis.patch.yml"`
  - `cordis.patch.yml` is present in the npm tarball
- npm tarball: 23 files, 242,071 bytes unpacked, integrity `sha512-gLiQHqOf+nev9C0i8ebgDBKk5+Ccjt1/dfDSY4WSYqCqKOWdZoAFfy4uZurghL6qy+w56ASH+TYADgDigNHZAg==`

## What the published catalog currently contains

At `main` commit `d2b71ebfc390f66e6f19ee22cf27a56a3f23559b` (`2026-11-25T08:46:40Z`):

- `catalog/v2/catalog.json` reports `generatedAt: 2026-08-14T12:56:57.210Z`
- 1,001 entries
- warning: `GitHub reports 1846 topic repositories; this catalog scan inspected the newest 1000.`
- zero matches for `qiqll/dsh-task-suite` or `dsh-task-suite`

The checkpoint (`catalog/v2/scan-state.json`) advances on every scheduled run, but the published catalog still reports the August timestamp and does not include this repository. This looks like either the incremental scan is not picking up the repository or the document is not being rewritten for entry changes.

## Request

1. Run the manual full reconciliation (`workflow_dispatch` with `full_reconcile: true`) and add `qiqll/dsh-task-suite` if it is eligible.
2. If the 1000-result cap is the cause, please window the GitHub search by `updated` ranges (or otherwise partition it) so repositories beyond the newest 1000 can still be reconciled. The collector currently limits discovery to 1,000 repositories / 10 pages, and GitHub search itself caps at 1,000 results.
3. If the entry is intentionally excluded, please state the exact exclusion code so the author can fix it.

## Local verification commands

```sh
npm view dsh-task-suite version license repository.url

curl -s https://registry.npmjs.org/dsh-task-suite/1.2.0 | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d["version"], d["license"], d["repository"]["url"])
print(d["dsh"]["bundle"])
'

curl -s https://api.github.com/repos/qiqll/dsh-task-suite | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d["private"], d["license"]["spdx_id"], d["topics"])
'

curl -s https://raw.githubusercontent.com/qiqll/dsh-task-suite/v1.2.0/package.json | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d["version"], d["dsh"]["bundle"])
'

curl -s https://raw.githubusercontent.com/hrhgit/deepseek-harness-plugin-manager/main/catalog/v2/catalog.json | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d["generatedAt"], len(d["entries"]), d["warnings"])
print([e["id"] for e in d["entries"] if "dsh-task-suite" in e["id"]])
'
```

## Post-merge verification

- The catalog should contain an entry with `repositoryFullName = "qiqll/dsh-task-suite"` and `version = "1.2.0"`.
- In DSH, install/refresh `@ruihuahe/dsh-plugin-marketplace@0.1.0` and search for `dsh-task-suite`; the marketplace should show it as installable with an exact npm version.

Thanks!
````

> 正文中的版本号、commit、日期已按 1.2.0 对齐；提交前可再核对一次 `npm view dsh-task-suite version`。
