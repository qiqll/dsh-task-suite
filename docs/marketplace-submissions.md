# 独立插件市场提交材料（T-013）

> 基线：`dsh-task-suite@1.1.1`（npm latest，2026-11-23T11:46:53Z 发布）+ GitHub tag `v1.1.1`（commit `c0c8e427f5ad79e6998842778e21e0148c69a047`）。
> 核对日期：2026-11-25。文中链接、版本和命令均已直接读取公开接口或本地实跑；本文只准备材料，**没有提交任何 PR/Issue，也没有执行 git add/commit/push**。
> 中文为主；目标仓库以英文为主的正文已写成英文，可直接复制。

---

## 0. 事实基线（提交前先核对）

| 事实 | 值 | 出处 / 核对方式 |
|---|---|---|
| npm 包名 | `dsh-task-suite`（非 scoped） | `https://registry.npmjs.org/dsh-task-suite` |
| npm latest | `1.1.1` | `dist-tags.latest` |
| npm 发布时间 | `2026-11-23T11:46:53.551Z` | packument `time["1.1.1"]` |
| npm license | `MIT` | packument `versions["1.1.1"].license` |
| npm repository | `git+https://github.com/qiqll/dsh-task-suite.git` | packument `versions["1.1.1"].repository.url` |
| npm tarball | `https://registry.npmjs.org/dsh-task-suite/-/dsh-task-suite-1.1.1.tgz` | packument `dist.tarball` |
| npm integrity | `sha512-gLiQHqOf+nev9C0i8ebgDBKk5+Ccjt1/dfDSY4WSYqCqKOWdZoAFfy4uZurghL6qy+w56ASH+TYADgDigNHZAg==` | packument `dist.integrity` |
| npm shasum | `b90cb46062f0750ff4a6017cf84787711011718b` | packument `dist.shasum` |
| npm 包内容 | 23 个文件，解包 242,071 bytes；含 `package/LICENSE`、`package/cordis.patch.yml` | 下载 tarball 后 `tar -tzf` |
| GitHub 仓库 | `https://github.com/qiqll/dsh-task-suite`（public，默认分支 `main`） | GitHub API `/repos/qiqll/dsh-task-suite` |
| GitHub license | `MIT`（SPDX） | GitHub API `license.spdx_id` |
| GitHub topic | `["dsh-plugin"]`（仅此一个） | GitHub API `topics` |
| 发布 tag | `v1.1.1` → commit `c0c8e427f5ad79e6998842778e21e0148c69a047` | GitHub API `git/ref/tags/v1.1.1` + `/commits/v1.1.1` |
| GitHub Release | `https://github.com/qiqll/dsh-task-suite/releases/tag/v1.1.1`（2026-11-23T11:45:25Z） | GitHub API `/releases` |
| `dsh` 字段 | `dsh.bundle.patch = "./cordis.patch.yml"`；`dsh.client.platform = "web"`；`dsh.manifestVersion = 1` | tag 内 `package.json` / npm packument |
| `dshWorkshop` 字段 | npm `1.1.1` **缺失**；本地 `1.1.2` 已补（见 §1.2，尚未发布） | tag `v1.1.1` 内 `package.json` + 本地 `1.1.2` |
| 插件关键词 | `dsh-plugin`, `deepseek-harness`, `task-management`, `task-queue`, `subagent`, `workflow`, `automation`, `orchestration` | tag 内 `package.json` |
| 本机 DSH 版本 | `0.2.1-rc.5` | `dsh --version` |
| npm 上 `@deepseek-ai/dsh` latest | `0.2.2-rc.5` | npm registry `dist-tags` |
| OMDSH 当前官方基线 | `@deepseek-ai/dsh@0.1.0-rc.6` | `omdsh-dev/dsh-hub-workshop` 的 `official-baseline.json` / `intake-queue.json` |

### 0.1 一条命令核对（复制到终端）

```sh
set -e

# 1) npm 版本 / 许可 / 仓库归属 / dsh 字段
curl -s https://registry.npmjs.org/dsh-task-suite/1.1.1 | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("version   :", d["version"])
print("license   :", d["license"])
print("repository:", d["repository"]["url"])
print("dsh.bundle:", d["dsh"]["bundle"])
print("integrity :", d["dist"]["integrity"])
'

# 2) GitHub topic / license / 是否为公开仓库
curl -s https://api.github.com/repos/qiqll/dsh-task-suite | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("private:", d["private"])
print("license:", d["license"]["spdx_id"])
print("topics :", d["topics"])
print("branch :", d["default_branch"])
'

# 3) 固定 tag 的 package.json（确认 dsh.bundle 与 LICENSE 是否进包）
curl -s https://raw.githubusercontent.com/qiqll/dsh-task-suite/v1.1.1/package.json | python3 -c '
import sys, json
d = json.load(sys.stdin)
print("version:", d["version"])
print("dshWorkshop present:", "dshWorkshop" in d)
print("dsh.bundle:", d["dsh"]["bundle"])
'

# 4) 本机运行时版本
dsh --version
```

> 若 `npm view` 报 `~/.npm` 权限错误（本沙箱出现过），改用上面的 `curl`；或临时指定缓存：`npm_config_cache=/tmp/npm-cache npm view dsh-task-suite version`。

### 0.2 四个目标一览

| 市场 / 目录 | 目标入口 | 提交方式 | 当前状态 | 材料 |
|---|---|---|---|---|
| OMDSH Hub | `omdsh-dev/dsh-hub-workshop` | GitHub Issue 表单 `extension-submission.yml`，自动化生成待审核 PR | **未收录**；v2 还差 `package.json#dshWorkshop` | §1 |
| DSH Go 市场 | `ccch1mneyyy/dsh-go-market` | Fork 后加一个 `plugins/*.json`，向 `main` 提 PR | **未收录**；已用官方 checker 预检通过 | §2 |
| hrhgit 插件目录 | `hrhgit/deepseek-harness-plugin-manager` | GitHub Issue 请求重扫 / 纳入（catalog 自动生成，不收手写条目） | **未收录**；catalog 仍停在 2026-08-14 的 1001 条 | §3 |
| DSH Get | `bobby-sheng/dshget-data` | GitHub Issue（缺失条目 / 元数据修正） | **快照缺失**；sitemap 有条目但详情页 404 | §4 |

---

## 1. OMDSH Hub（hub.omdsh.dev）

### 1.1 结论：1.1.2 已就绪，按此投稿 v2

OMDSH 的规则以 `omdsh-dev/dsh-hub-workshop` 的 [`INTAKE.md`](https://github.com/omdsh-dev/dsh-hub-workshop/blob/main/INTAKE.md) 为准：

- 新投稿绑定固定 commit 里的 `package.json#dshWorkshop`（`omdsh-workshop-package/v1`）；旧的 `dsh.bundle` 只做“兼容映射”，安装、失败隔离、热重载能力在补 manifest 前都保持未知。
- v2 的 `packageManifest` 必须与固定 commit 的 `package.json#dshWorkshop` **逐值相等**；Issue 自动化会读仓库、读 commit、读声明路径，然后生成 `pending-review` 记录与审核 PR，**不会执行投稿仓库的脚本**。
- [官方作者指令](https://hub.omdsh.dev/agent-submission-prompt.zh.md)明确要求：如果 `dshWorkshop` 缺失，先生成建议片段并**停止**，等作者审阅、提交、推送新的固定 commit 后再申请。

`1.1.1` 的 `package.json` 只有 `dsh.bundle`，没有 `dshWorkshop`，这是之前的阻塞。**本地 `1.1.2` 已补齐**：`package.json` 顶层已写入 §1.2 的 `dshWorkshop` 对象，`version` 已改为 `1.1.2`，`node selftest.mjs`、`node bin/dsh-task --selftest` 与 `npm pack --dry-run` 均已通过。剩下的只是**手动发布**（§1.2 的命令）和**投稿**（§1.3 的 JSON），不需要再改代码：

| 路径 | 状态 | 说明 |
|---|---|---|
| 本地补 `dshWorkshop`（1.1.2）→ 发 npm → 投 v2 | ✅ 已就绪 | 本仓库已完成；按 §1.2 发布、按 §1.3 投稿即可，后续审核/验证都按 v2 走 |
| 只加 manifest 到 `1.1.1`、不重发 npm、用新 commit 投 | ⚠️ 技术上能过 preflight | npm 1.1.1 tarball 与仓库声明不一致，审核可能打回；不推荐 |
| 投 v1 旧格式绕过 | ⚠️ 解析器仍接受 | `INTAKE.md` 只把旧 `dsh.bundle` 当兼容映射，能力/生命周期均为未知，人工审核大概率要求补 v2；不推荐 |

**下面按“已补 manifest → 发 1.1.2 → 投 v2”写。**

### 1.2 发布前置：`dshWorkshop` 已就位，按此发布 1.1.2

`package.json` 顶层已有 `"dshWorkshop"` 键（与 `dsh` 同级），值就是下面这个完整对象；`packageManifest` 必须与它完全一致。**本片段已写入 1.1.2 的 `package.json`**，此处保留作为投稿前的核对基线（`package.json#dshWorkshop` 与 §1.3 的 `packageManifest` 应当逐值相等）：

```json
{
  "schema": "omdsh-workshop-package/v1",
  "type": "plugin",
  "integration": {
    "protocol": "harness-profile",
    "artifact": "cordis.patch.yml"
  },
  "install": {
    "mode": "transactional",
    "adapter": "profile-bundle",
    "failurePolicy": "generation-rollback",
    "touchesCurrentBeforeActivation": false
  },
  "lifecycle": {
    "activation": "restart-profile",
    "dispose": "unknown"
  },
  "permissions": [
    "filesystem:workspace",
    "process:spawn",
    "git:read-write"
  ],
  "compatibility": {
    "dshVersions": [
      "0.2.1-rc.5"
    ]
  },
  "capability": {
    "id": "task_status",
    "kind": "tool",
    "invocation": "在任意会话调用 task_status 工具（空任务池）",
    "expected": "返回任务池全局视图：0 条任务、无待决策/阻塞，并给出下一步建议"
  },
  "evidence": {
    "install": null,
    "failureIsolation": null,
    "hotReload": null,
    "remove": null
  }
}
```

字段说明（审核会逐项看）：

- `integration.protocol = harness-profile` + `artifact = cordis.patch.yml`：插件是 DSH Profile Bundle，安装入口是 `dsh plugin`。
- `install.mode = transactional`：失败时依赖 DSH 的 generation rollback；启用前不触碰 current。
- `lifecycle.activation = restart-profile`：首次安装后必须完整重启 DSH（README 已写明）；`dispose = unknown`，不虚构热重载能力。
- `permissions`：`filesystem:workspace`（`.dsh/tasks`、快照、inbox）、`process:spawn`（在任务工作区执行 git 和用户声明的单条 `TEST_CMD`）、`git:read-write`（基线 worktree）。插件没有出站网络请求。
- `compatibility.dshVersions = ["0.2.1-rc.5"]`：只声明作者本机验证过的版本；不写“兼容所有版本”。
- `capability.id = task_status`：审核适配器必须实际调用一次 `task_status` 并观察到任务池视图，不能只证明“加载成功”。
- `evidence` 全为 `null`：目前没有 RC.6 的安装/升级/禁用/移除/失败隔离证据文件，如实留空，等待审核阶段补。

发布并固定新 commit（**手动执行，本文不代跑**；发布物已是 `1.1.2`）：

```sh
# 1) 确认 package.json 仍是合法 JSON，且 dshWorkshop 与 §1.3 的 packageManifest 一致
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"

# 1.5) 发布前复跑离线自测（两条都必须全绿）
node selftest.mjs
node bin/dsh-task --selftest
npm pack --dry-run --cache /tmp/npm-cache-t019   # 确认含 package.json / LICENSE / bin/dsh-task / cordis.patch.yml

# 2) 提交、推送、发布 1.1.2（由作者手动执行）
git add dsh-task-suite/package.json dsh-task-suite/CHANGELOG.md dsh-task-suite/docs/marketplace-submissions.md
git commit -m "feat: declare OMDSH workshop manifest and ship 1.1.2"
git push origin main
npm publish
git tag v1.1.2
git push origin v1.1.2
# 在 GitHub 创建 Release v1.1.2（§1.3 的 changelog 链接需要它）
gh release create v1.1.2 --title v1.1.2 --notes "OMDSH workshop manifest"   # 或网页创建

# 3) 记录投稿用的固定 commit 与日期（§1.3 的 __REF__ / __DATE__ 就取这两个值）
git rev-parse v1.1.2   # 发布后的 tag 指向的 40 位 commit
date -u +%F            # 当天日期，如 2026-11-25
```

> `__REF__` 用发布后的 `git rev-parse v1.1.2` 的输出；如果打成 annotated tag（`git tag -a`），改用 `git rev-parse v1.1.2^{commit}` 取 commit。`__DATE__` 用发布当天的日期（UTC，`YYYY-MM-DD`）。

### 1.3 完整投稿 JSON（v2）

下面这段在替换两个占位符后，已通过 OMDSH 官方校验器（见 §1.6）。`__REF__` 换成发布 `1.1.2` 后 `git rev-parse v1.1.2` 得到的固定 commit，`__DATE__` 换成当天日期（如 `2026-11-25`）；`version` / `profileBundle.spec` 已写 `1.1.2`。

```json
{
  "schema": "omdsh-workshop-submission/v2",
  "operation": "create-project",
  "project": {
    "id": "dsh-task-suite",
    "displayName": "DSH 任务流水线 / DSH Task Suite",
    "summary": "把单个 DSH Agent 变成一支工程团队：Markdown 任务池、主 Agent 调度、后台 worker 交付、机器验收（重跑测试、基线比对、测试改弱审计）、异步需求投递与只读 Web 面板。",
    "kind": "extension",
    "category": "workflow",
    "tags": [
      "task-management",
      "orchestration",
      "subagent",
      "workflow",
      "automation",
      "dashboard"
    ],
    "repository": "https://github.com/qiqll/dsh-task-suite",
    "path": null,
    "author": {
      "name": "qiqll",
      "url": "https://github.com/qiqll"
    },
    "license": "MIT",
    "media": {
      "icon": "assets/icon-512.png",
      "screenshots": [
        "docs/screenshots/dashboard-running.png",
        "docs/screenshots/dashboard-overview.png"
      ]
    }
  },
  "release": {
    "version": "1.1.2",
    "ref": "__REF__",
    "updatedAt": "__DATE__",
    "channel": "stable",
    "compatibility": "DeepSeek Harness 0.2.1-rc.5（作者本机验证，Node.js >= 20）；未在 Workshop 当前基线 @deepseek-ai/dsh@0.1.0-rc.6 上验证。",
    "changelog": "https://github.com/qiqll/dsh-task-suite/releases/tag/v1.1.2",
    "capabilities": {
      "requiresFabric": false,
      "deepHook": false,
      "restartRequired": true
    },
    "profileBundle": {
      "packageName": "dsh-task-suite",
      "spec": "1.1.2"
    },
    "updateFrom": null
  },
  "management": {
    "method": "profile-bundle",
    "protocol": "harness-profile",
    "label": "npm profile bundle",
    "instructions": "dsh plugin --profile desktop add dsh-task-suite@1.1.2（Web profile 改为 --profile web；首次安装后需完整重启 DSH）",
    "source": null
  },
  "declarations": {
    "permissions": "filesystem:workspace（读写工作区 .dsh/tasks、快照与 inbox）；process:spawn（在任务工作区运行 git 与用户声明的单条 TEST_CMD）；无出站网络请求；客户端面板只读，通过宿主注册的 GET /dsh-task-suite/state 读取状态。",
    "testing": "作者在 macOS 桌面版 DSH（本机 0.2.1-rc.5）上运行并截取真实面板；node selftest.mjs（离线自测）通过。尚未提供 RC.6 生命周期证据（安装/升级/禁用/移除/失败隔离），因此按未验证处理。",
    "trustedPublisherRequested": false,
    "installScriptsMustRemainDisabled": true
  },
  "packageManifest": {
    "schema": "omdsh-workshop-package/v1",
    "type": "plugin",
    "integration": {
      "protocol": "harness-profile",
      "artifact": "cordis.patch.yml"
    },
    "install": {
      "mode": "transactional",
      "adapter": "profile-bundle",
      "failurePolicy": "generation-rollback",
      "touchesCurrentBeforeActivation": false
    },
    "lifecycle": {
      "activation": "restart-profile",
      "dispose": "unknown"
    },
    "permissions": [
      "filesystem:workspace",
      "process:spawn",
      "git:read-write"
    ],
    "compatibility": {
      "dshVersions": [
        "0.2.1-rc.5"
      ]
    },
    "capability": {
      "id": "task_status",
      "kind": "tool",
      "invocation": "在任意会话调用 task_status 工具（空任务池）",
      "expected": "返回任务池全局视图：0 条任务、无待决策/阻塞，并给出下一步建议"
    },
    "evidence": {
      "install": null,
      "failureIsolation": null,
      "hotReload": null,
      "remove": null
    }
  }
}
```

生成最终文件（先把上面 JSON 原样保存为 `/tmp/omdsh-submission.json`，再替换两个占位符）：

```sh
# 先把 §1.3 的 JSON 保存为 /tmp/omdsh-submission.json
REF=$(git rev-parse v1.1.2)    # 发布后 v1.1.2 tag 指向的固定 commit；annotated tag 用 v1.1.2^{commit}
DATE=$(date -u +%F)            # 当天日期（UTC），如 2026-11-25
test ${#REF} -eq 40 || { echo "REF 不是 40 位 commit：$REF" >&2; exit 1; }
python3 - "$REF" "$DATE" <<'PY'
import sys
p = '/tmp/omdsh-submission.json'
s = open(p, encoding='utf-8').read()
s = s.replace('__REF__', sys.argv[1]).replace('__DATE__', sys.argv[2])
open(p, 'w', encoding='utf-8').write(s)
PY
python3 -m json.tool /tmp/omdsh-submission.json > /dev/null && echo "JSON OK"
```

### 1.4 Issue 标题与完整正文

**目标**：<https://github.com/omdsh-dev/dsh-hub-workshop/issues/new?template=extension-submission.yml>

**标题**：

```text
[Submission] dsh-task-suite@1.1.2
```

**用 Issue 表单提交时（推荐）**：

1. 标题填 `[Submission] dsh-task-suite@1.1.2`。
2. `Author Studio manifest` 字段：粘贴 §1.3 的 JSON 本身（纯 JSON，不要带 JSON 代码围栏）。
3. `Additional context` 字段：粘贴下面完整正文里的 `### Additional context` 整段。
4. 勾选表单自带的 4 个必选确认框（无敏感信息 / 安装说明与固定 commit 一致 / 不代表安全背书 / 理解三种接入类型与待审核状态）。
5. 不要重复粘贴 `### Author Studio manifest` 等标题——表单会自动生成这些区块。

**用 `gh issue create` 或 GitHub API 创建时**，用下面的完整正文（JSON 与 §1.3 相同；`__REF__` 换成 `git rev-parse v1.1.2` 的输出，`__DATE__` 换成当天日期）：

````markdown
### Author Studio manifest

```json
{
  "schema": "omdsh-workshop-submission/v2",
  "operation": "create-project",
  "project": {
    "id": "dsh-task-suite",
    "displayName": "DSH 任务流水线 / DSH Task Suite",
    "summary": "把单个 DSH Agent 变成一支工程团队：Markdown 任务池、主 Agent 调度、后台 worker 交付、机器验收（重跑测试、基线比对、测试改弱审计）、异步需求投递与只读 Web 面板。",
    "kind": "extension",
    "category": "workflow",
    "tags": [
      "task-management",
      "orchestration",
      "subagent",
      "workflow",
      "automation",
      "dashboard"
    ],
    "repository": "https://github.com/qiqll/dsh-task-suite",
    "path": null,
    "author": {
      "name": "qiqll",
      "url": "https://github.com/qiqll"
    },
    "license": "MIT",
    "media": {
      "icon": "assets/icon-512.png",
      "screenshots": [
        "docs/screenshots/dashboard-running.png",
        "docs/screenshots/dashboard-overview.png"
      ]
    }
  },
  "release": {
    "version": "1.1.2",
    "ref": "__REF__",
    "updatedAt": "__DATE__",
    "channel": "stable",
    "compatibility": "DeepSeek Harness 0.2.1-rc.5（作者本机验证，Node.js >= 20）；未在 Workshop 当前基线 @deepseek-ai/dsh@0.1.0-rc.6 上验证。",
    "changelog": "https://github.com/qiqll/dsh-task-suite/releases/tag/v1.1.2",
    "capabilities": {
      "requiresFabric": false,
      "deepHook": false,
      "restartRequired": true
    },
    "profileBundle": {
      "packageName": "dsh-task-suite",
      "spec": "1.1.2"
    },
    "updateFrom": null
  },
  "management": {
    "method": "profile-bundle",
    "protocol": "harness-profile",
    "label": "npm profile bundle",
    "instructions": "dsh plugin --profile desktop add dsh-task-suite@1.1.2（Web profile 改为 --profile web；首次安装后需完整重启 DSH）",
    "source": null
  },
  "declarations": {
    "permissions": "filesystem:workspace（读写工作区 .dsh/tasks、快照与 inbox）；process:spawn（在任务工作区运行 git 与用户声明的单条 TEST_CMD）；无出站网络请求；客户端面板只读，通过宿主注册的 GET /dsh-task-suite/state 读取状态。",
    "testing": "作者在 macOS 桌面版 DSH（本机 0.2.1-rc.5）上运行并截取真实面板；node selftest.mjs（离线自测）通过。尚未提供 RC.6 生命周期证据（安装/升级/禁用/移除/失败隔离），因此按未验证处理。",
    "trustedPublisherRequested": false,
    "installScriptsMustRemainDisabled": true
  },
  "packageManifest": {
    "schema": "omdsh-workshop-package/v1",
    "type": "plugin",
    "integration": {
      "protocol": "harness-profile",
      "artifact": "cordis.patch.yml"
    },
    "install": {
      "mode": "transactional",
      "adapter": "profile-bundle",
      "failurePolicy": "generation-rollback",
      "touchesCurrentBeforeActivation": false
    },
    "lifecycle": {
      "activation": "restart-profile",
      "dispose": "unknown"
    },
    "permissions": [
      "filesystem:workspace",
      "process:spawn",
      "git:read-write"
    ],
    "compatibility": {
      "dshVersions": [
        "0.2.1-rc.5"
      ]
    },
    "capability": {
      "id": "task_status",
      "kind": "tool",
      "invocation": "在任意会话调用 task_status 工具（空任务池）",
      "expected": "返回任务池全局视图：0 条任务、无待决策/阻塞，并给出下一步建议"
    },
    "evidence": {
      "install": null,
      "failureIsolation": null,
      "hotReload": null,
      "remove": null
    }
  }
}
```

### Submission boundary

- This request contains only public, immutable source coordinates and the generated structured manifest.
- Automated intake may create a pending-review PR, but cannot approve the project or grant Registry installation authority.
- `package.json#dshWorkshop` at the pinned commit is identical to `packageManifest` above.

### Additional context

- npm exact version: `dsh-task-suite@1.1.2` (MIT). Tarball includes `LICENSE` and `cordis.patch.yml`.
- Install: `dsh plugin --profile desktop add dsh-task-suite@1.1.2` (or `--profile web`). A full DSH restart is required after first install because the Web client plugin table is composed at process start.
- The plugin has **no install scripts**; `installScriptsMustRemainDisabled` is `true`.
- The author's runtime is `DeepSeek Harness 0.2.1-rc.5` (Node.js >= 20); the screenshots come from a real session. The current Workshop baseline is `@deepseek-ai/dsh@0.1.0-rc.6`; if RC.6 lifecycle verification is mandatory, this submission will need maintainer guidance rather than a fabricated pass.
- Evidence files for install / failure isolation / hot reload / remove are intentionally `null`: no RC.6 evidence has been produced yet. The submission is a pending-review request, not a claim of verification.
- Screenshots: `docs/screenshots/dashboard-running.png`, `docs/screenshots/dashboard-overview.png`; icon: `assets/icon-512.png`.
- Local validation (official checker): `node scripts/intake.mjs validate /tmp/omdsh-submission.json` → `submission accepted for pending review; no repository code was executed`.

### Confirmations

- [x] The repository and pinned commit are public.
- [x] Permissions, tests, compatibility, and external effects are declared from verifiable evidence.
- [x] No credential, private path, or private data is included.
````

### 1.5 提交方式

- **Issue，不是 PR**。用上面的 Issue 表单（`extension-submission.yml`）创建；自动化会只读核验公开仓库、固定 commit 和声明路径，通过后由 `github-actions[bot]` 在独立分支写 `pending-review` 记录并开审核 PR。
- 不要直接编辑 `catalog.json`、`intake-queue.json`、Registry 或已生成页面；这些由维护者流程写入。
- 一次只提交一个项目。不要在同一条 Issue 里附带其他插件。

### 1.6 提交前本地校验（官方校验器）

```sh
cd /tmp
curl -sSL https://codeload.github.com/omdsh-dev/dsh-hub-workshop/tar.gz/refs/heads/main | tar xz
cd dsh-hub-workshop-main

# 只读校验：不 clone、不执行投稿仓库代码
node scripts/intake.mjs validate /tmp/omdsh-submission.json

# 预览会生成的 intake 记录（id 应为 dsh-task-suite@1.1.2）
node scripts/intake.mjs prepare /tmp/omdsh-submission.json | head -20
```

本机实跑结果（2026-11-25）：

```text
submission accepted for pending review; no repository code was executed
```

> 注意：`validate` 只校验清单结构；Issue 自动化还会用 GitHub API 读固定 commit 的 `package.json`，并做 `deepStrictEqual(packageJson.dshWorkshop, packageManifest)`。所以 §1.2 的 manifest 必须与 §1.3 的 `packageManifest` 逐字一致。

### 1.7 提交后如何验证收录

1. **Issue 自动化**：Issue 下会出现 bot 的 preflight 结果 / 审核 PR 链接；PR 中应出现：
   - `intake/records/dsh-task-suite@1.1.2.json`
   - `intake/plans/dsh-task-suite@1.1.2.json`（v2 会生成 typed plan）
2. **公开队列**：
   ```sh
   curl -s https://raw.githubusercontent.com/omdsh-dev/dsh-hub-workshop/main/intake-queue.json \
     | python3 -c 'import sys,json; d=json.load(sys.stdin); print([r["id"] for r in d["records"] if "dsh-task-suite" in r["id"]])'
   ```
   预期出现 `['dsh-task-suite@1.1.2']`。
3. **Hub 展示**：
   ```sh
   curl -s https://hub.omdsh.dev/marketplace.json \
     | python3 -c 'import sys,json; d=json.load(sys.stdin); print(sum(1 for p in d["projects"] if p["id"]=="dsh-task-suite"))'
   ```
   预期从 `0` 变为 `1`；页面锚点为 `https://hub.omdsh.dev/#package=dsh-task-suite`。
4. **Registry 状态**：`pending-review` 不等于已准入。只有 `approved + current-baseline-passed` 才 eligible，之后还需要维护者显式 admission。按当前基线（`0.1.0-rc.6`）与作者声明（`0.2.1-rc.5`）的差异，本次大概率停在 `pending-review` / `needs-fix`，而不是直接 `admitted`。

### 1.8 风险与预期

- **基线差异**：Workshop 基线是 `@deepseek-ai/dsh@0.1.0-rc.6`，作者只验证了 `0.2.1-rc.5`。这属于“未验证”，不是“已验证”；审核可能要求补 RC.6 证据或明确 blocked。
- **没有 evidence 文件**：`evidence` 全为 `null`，适配器无法把安装/失败隔离/热重载标成 Verified。这是如实声明，不要为了过审伪造。
- **`generation-rollback`**：这是 Profile Bundle 的安装语义声明；如果维护者要求证据，需要在 RC.6 环境补安装失败回滚测试。
- **`dispose: unknown`**：没有声称热重载；如果后续要标 hot-reload，必须同时补 dispose/资源释放/重新激活证据。

---

## 2. DSH Go 市场（ccch1mneyyy/dsh-go-market）

### 2.1 目标与提交方式

- 目标仓库：<https://github.com/ccch1mneyyy/dsh-go-market>
- 提交入口：<https://github.com/ccch1mneyyy/dsh-go-market/pulls>（Fork 后从 compare 页面发起；或用 `gh pr create --repo ccch1mneyyy/dsh-go-market`）
- 规则：README 的“提交插件”节 + [`schema/plugin.schema.json`](https://github.com/ccch1mneyyy/dsh-go-market/blob/main/schema/plugin.schema.json)。
- 要求：npm 上已发布**精确版本**（不接受 `latest` / 范围 / Git 地址）；OSI 开源许可；非 scoped 包文件名用 `<包名>.json`；一次 PR 只增加或修改一个条目；不要写 `tier`、risk、integrity 或审核结论。
- 方式：Fork → 在 `plugins/` 新增 `dsh-task-suite.json` → 向 `main` 提 PR。自动检查通过后启用 auto-merge，无需人工审批。

### 2.2 `plugins/dsh-task-suite.json` 完整内容

```json
{
  "name": "dsh-task-suite",
  "version": "1.1.1",
  "title": {
    "zh": "任务流水线",
    "en": "Task Pipeline"
  },
  "summary": {
    "zh": "把单个 DSH Agent 变成一支工程团队：Markdown 任务池、主 Agent 调度、后台 worker 交付、机器验收（重跑测试、基线比对、测试改弱审计），需求可异步投递，附只读 Web 面板；git 可选。",
    "en": "Turn one DSH agent into a small engineering team: a Markdown task pool, a lead agent that dispatches isolated background workers, machine-verified acceptance (test rerun, baseline diff, test-weakening audit), async intake, and a read-only Web dashboard. Git optional."
  },
  "category": "productivity",
  "screenshots": [
    "https://raw.githubusercontent.com/qiqll/dsh-task-suite/v1.1.1/docs/screenshots/dashboard-running.png",
    "https://raw.githubusercontent.com/qiqll/dsh-task-suite/v1.1.1/docs/screenshots/dashboard-overview.png"
  ],
  "homepage": "https://qiqll.github.io/dsh-task-suite/"
}
```

说明：

- `version` 必须是 npm 上真实存在的精确版本 `1.1.1`；不要写 `^1.1.1` 或 `latest`。
- `category` 只能取 `tools` / `media` / `productivity` / `communication` / `other`；任务管理/自动化归 `productivity`。
- 截图是 HTTPS，最多 4 张；这里用 tag 固定的 raw 链接，避免 `main` 变动导致图失效。两张图已确认可访问（200，image/png）。
- `homepage` 用 GitHub Pages 介绍页，已确认 200。
- 不要加 `tier` / `risk` / `integrity` / 审核结论；这些由市场扫描生成。

### 2.3 PR 标题、描述与检查清单

**标题**：

```text
Add dsh-task-suite 1.1.1
```

**描述**：

````markdown
## 插件

- 包名：`dsh-task-suite`
- 版本：`1.1.1`（npm 精确版本）
- 许可证：MIT
- 仓库：https://github.com/qiqll/dsh-task-suite
- 主页：https://qiqll.github.io/dsh-task-suite/
- 分类：`productivity`

## 用途

把单个 DSH Agent 变成一支工程团队：Markdown 任务池（P0–P3、依赖、验收标准）、主 Agent 调度、独立上下文的 worker 交付、机器验收（重跑 TEST_CMD、基线 worktree 比对、测试改弱审计、越界文件检查），需求可异步投递，附只读 Web 面板。git 与非 git 工作区都能用。

## 主机模式

- Host 工具与任务池：desktop / web 均可。
- Web 面板：需要 web profile；依赖 `dsh-better-sidebar` 提供的右侧栏插槽，但它是软依赖——未安装时任务工具、API、任务池仍正常，只是没有面板。
- 首次安装后需要完整重启 DSH 一次（Web 客户端插件表在进程启动时组合）。

## 检查清单

- [x] 只增加一个 `plugins/dsh-task-suite.json`
- [x] 使用 npm 上已发布的精确版本 `1.1.1`
- [x] 插件有 OSI 开源许可证（MIT）
- [x] 未填写 `tier` 或审核结果
- [x] 没有原生适配声明（不使用 `dshGo` 协议；本条目是 DSH bundle）

## 本地检查

在提交前用市场仓库的官方 checker 对单条目跑过（Node.js 24.9.0）：

```text
node scripts/check.mjs /tmp/dsh-go-candidate
passed: true
status: passed
warnings: shell, network, filesystem, not-adapted
risk.level: medium
```

`not-adapted` 表示没有声明 DSH Go 原生 `dshGo` 协议，不是结构错误；`shell` / `network` / `filesystem` 是启发式风险标记，会展示在 App 数据里。扫描的是 npm 当时返回的 1.1.1 tarball，integrity 为 `sha512-gLiQHqOf+nev9C0i8ebgDBKk5+Ccjt1/dfDSY4WSYqCqKOWdZoAFfy4uZurghL6qy+w56ASH+TYADgDigNHZAg==`。

## 截图

1. `dashboard-running.png` — 真实 T-009 运行中：当前任务、worker、指标、事件流。
2. `dashboard-overview.png` — 任务池、Agent、指标、事件流总览。

两张图均来自真实会话，已裁掉本地工作区路径。
````

**提交时套用仓库的 PR 模板**（`.github/PULL_REQUEST_TEMPLATE.md`）：

```markdown
说明这个插件的用途，以及它在哪些 DSH Go 主机模式可用。

- [x] 只增加或修改一个 `plugins/*.json`
- [x] 使用 npm 上已发布的精确版本
- [x] 插件有 OSI 开源许可证
- [x] 未填写 `tier` 或审核结果（由市场维护者策略与自动扫描生成）
- [x] 如需原生适配，已按 README 在包内声明并实现现有 DSH Go 协议（本插件无此需求）
```

### 2.4 提交前本地校验

```sh
# 1) 准备市场仓库与依赖（Node.js >= 22）
cd /tmp
curl -sSL https://codeload.github.com/ccch1mneyyy/dsh-go-market/tar.gz/refs/heads/main | tar xz
cd dsh-go-market-main
npm ci --ignore-scripts

# 2) 只把我们这一个条目放进临时目录，避免扫描全部 60+ 条
mkdir -p /tmp/dsh-go-candidate
cp plugins/dsh-task-suite.json /tmp/dsh-go-candidate/
node scripts/check.mjs /tmp/dsh-go-candidate

# 3) 市场自身测试
npm test
```

预期（本机实跑，2026-11-25）：

```json
{
  "passed": true,
  "results": [
    {
      "name": "dsh-task-suite",
      "version": "1.1.1",
      "status": "passed",
      "denials": [],
      "warnings": ["shell", "network", "filesystem", "not-adapted"],
      "risk": { "level": "medium" }
    }
  ]
}
```

> `npm ci` 若因 `~/.npm` 权限失败，加 `--cache /tmp/npm-cache`。

### 2.5 提交后如何验证收录

```sh
# PR 合并后：条目文件可读
curl -s https://raw.githubusercontent.com/ccch1mneyyy/dsh-go-market/main/plugins/dsh-task-suite.json

# 发布索引包含 name + exact version
curl -s https://ccch1mneyyy.github.io/dsh-go-market/index.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print([p["versions"] for p in d["plugins"] if p["name"]=="dsh-task-suite"])'

# 分享页应从 404 变为 200
curl -s -o /dev/null -w '%{http_code}\n' https://go.dshtui.com/p/dsh-task-suite
```

然后在 DSH Go 的插件市场刷新（或重启 App），搜索 `dsh-task-suite`，确认版本显示 `1.1.1`。Worker 端点是 `https://go.dshtui.com/market/`，Pages 端点是 `https://ccch1mneyyy.github.io/dsh-go-market/`。

### 2.6 风险提示

- 扫描器会标记 `shell` / `network` / `filesystem`（medium），这是启发式特征，不代表恶意；但 PR 里主动说明“为什么需要执行测试命令、为什么读写工作区”会减少维护者疑问。
- `not-adapted` 是预期结果：本插件没有 `package.json#dshGo` 原生声明，不需要为了消掉这个 warning 去伪造原生适配。
- 自动检查失败最常见的原因是：版本在 npm 上不存在、license 不是 OSI、`dsh.bundle.patch` 指向的文件不在 tarball 内。当前三项都已核对通过。

---

## 3. hrhgit 插件目录（deepseek-harness-plugin-manager）

### 3.1 目标与提交方式

- 目标仓库：<https://github.com/hrhgit/deepseek-harness-plugin-manager>
- 相关包：`@ruihuahe/dsh-plugin-marketplace`（npm 0.1.0），运行时只读 `catalog/v2/catalog.json`；catalog 由 GitHub Actions 扫描 `dsh-plugin` topic 自动生成，**没有手写条目层**。
- 因此这里不是“加一个 JSON 的 PR”，而是 **Issue 请求重扫/排查**。附上可核对事实与验证命令，让维护者直接跑。

### 3.2 Issue 标题与完整正文（英文）

**目标**：<https://github.com/hrhgit/deepseek-harness-plugin-manager/issues/new>

**标题**：

```text
[catalog] qiqll/dsh-task-suite missing from catalog/v2 (npm 1.1.1, dsh-plugin topic set)
```

**正文**：

````markdown
## Summary

`qiqll/dsh-task-suite` is a public MIT DeepSeek Harness bundle published to npm as `dsh-task-suite@1.1.1`. The repository has the `dsh-plugin` topic and its `package.json` declares `dsh.bundle.patch`, but `catalog/v2/catalog.json` contains no entry for the package or the repository.

## Verifiable facts

- Repository: https://github.com/qiqll/dsh-task-suite (public, default branch `main`, license MIT)
- GitHub topic: `["dsh-plugin"]`
- npm: `dsh-task-suite@1.1.1`, published `2026-11-23T11:46:53.551Z`, license MIT
- npm `repository.url`: `git+https://github.com/qiqll/dsh-task-suite.git` (matches the repository owner/name)
- `package.json` at tag `v1.1.1` (commit `c0c8e427f5ad79e6998842778e21e0148c69a047`):
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

curl -s https://registry.npmjs.org/dsh-task-suite/1.1.1 | python3 -c '
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

curl -s https://raw.githubusercontent.com/qiqll/dsh-task-suite/v1.1.1/package.json | python3 -c '
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

- The catalog should contain an entry with `repositoryFullName = "qiqll/dsh-task-suite"` and `version = "1.1.1"`.
- In DSH, install/refresh `@ruihuahe/dsh-plugin-marketplace@0.1.0` and search for `dsh-task-suite`; the marketplace should show it as installable with an exact npm version.

Thanks!
````

### 3.3 提交前本地校验（不用跑构建）

```sh
# 版本 / 许可 / 仓库归属
npm view dsh-task-suite version license repository.url

# topic + 公开性
curl -s https://api.github.com/repos/qiqll/dsh-task-suite \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["private"], d["topics"], d["license"]["spdx_id"])'

# dsh.bundle 声明
curl -s https://raw.githubusercontent.com/qiqll/dsh-task-suite/v1.1.1/package.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["version"], d["dsh"]["bundle"])'

# catalog 是否仍缺失
curl -s https://raw.githubusercontent.com/hrhgit/deepseek-harness-plugin-manager/main/catalog/v2/catalog.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["generatedAt"], len(d["entries"])); print([e["id"] for e in d["entries"] if "dsh-task-suite" in e["id"]])'
```

预期（2026-11-25 实跑）：

```text
1.1.1 MIT git+https://github.com/qiqll/dsh-task-suite.git
False ['dsh-plugin'] MIT
1.1.1 {'patch': './cordis.patch.yml'}
2026-08-14T12:56:57.210Z 1001
[]
```

### 3.4 提交后如何验证收录

```sh
# 1) catalog 条目出现（repositoryFullName + 精确版本）
curl -s https://raw.githubusercontent.com/hrhgit/deepseek-harness-plugin-manager/main/catalog/v2/catalog.json \
  | python3 -c '
import sys, json
d = json.load(sys.stdin)
for e in d["entries"]:
    if e["repositoryFullName"] == "qiqll/dsh-task-suite":
        print(e["id"], e["version"], e.get("availability"), e.get("issueCode"))
'

# 2) 可选：安装市场插件，在 UI 里刷新目录
dsh plugin --profile desktop add @ruihuahe/dsh-plugin-marketplace@0.1.0
# 完整重启 DSH 后，在插件市场搜索 dsh-task-suite
```

### 3.5 说明

- 这个目录没有“人工审稿/收录条目”的 PR 层；catalog 是自动生成的。提 PR 改 `catalog.json` 会被下一次扫描覆盖，也会违背仓库声明。
- 维护者可能需要先修 1000 条上限，才轮得到我们的仓库；Issue 里把“为什么我们本应被扫到”讲清楚，比单纯说“加一下”更有效。

---

## 4. DSH Get（bobby-sheng/dshget-data）

### 4.1 目标与提交方式

- 目标仓库：<https://github.com/bobby-sheng/dshget-data>
- 线上站点：<https://dshget.com/> / <https://www.dshget.com/>
- 方式：GitHub Issue（该仓库 README 的 “Corrections” 明确写：缺失插件或错误元数据开 Issue）。
- 这不是“PR 改 catalog.json”：`catalog.json` 是站点快照，由维护者重新生成；Issue 里给出可核对的线上/快照事实和期望字段即可。

### 4.2 Issue 标题与完整正文（英文）

**目标**：<https://github.com/bobby-sheng/dshget-data/issues/new>

**标题**：

```text
Add qiqll/dsh-task-suite (npm 1.1.1) and fix stale sitemap URLs returning 404
```

**正文**：

````markdown
## Summary

`qiqll/dsh-task-suite` is a public MIT DSH bundle (`dsh-task-suite@1.1.1` on npm). It is **not** in the snapshot `catalog.json`, while the live sitemap already advertises two detail URLs that currently return **404**. Please add the plugin and regenerate the sitemap from the actual catalog.

## What I checked (2026-11-25)

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
- npm: `dsh-task-suite@1.1.1`, published `2026-11-23T11:46:53.551Z`
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
  "added": "2026-11-25",
  "sources": ["github-topic", "awesome-dsh-plugin"],
  "verification": null,
  "installable": true,
  "license": "MIT",
  "version": "1.1.1",
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

### 4.3 期望条目字段说明

| 字段 | 值 | 依据 |
|---|---|---|
| `name` / `owner` | `dsh-task-suite` / `qiqll` | npm 包名 + GitHub owner |
| `url` / `page` | GitHub 仓库 | 快照中 `page` 字段当前指向 GitHub |
| `category` | `workflow` | DSH Get 的 14 个分类之一；任务池/调度属于 workflow |
| `description.en` / `.zh` | 见上方 JSON | README + npm description |
| `npm` | `dsh-task-suite` | npm 包名 |
| `install` | `dsh plugin --profile web add dsh-task-suite` | 与站点现有条目风格一致；桌面版可换 `--profile desktop` |
| `license` | `MIT` | npm + GitHub + LICENSE 文件 |
| `version` | `1.1.1` | npm latest |
| `sources` | `github-topic`, `awesome-dsh-plugin` | 两个来源都已实际收录/可发现 |
| `installable` | `true` | 精确 npm 版本 + `dsh.bundle` 存在 |
| `added` | `2026-11-25` | 本次补录日期，维护者可改 |
| `verification` | `null` | DSH Get 不做安全认证；不要伪造 |

### 4.4 提交前本地校验

```sh
# sitemap 是否仍列出、页面是否仍 404
curl -s https://dshget.com/sitemap.xml | grep -A2 -B2 'qiqll/dsh-task-suite'
curl -s -o /dev/null -w '%{http_code}\n' https://dshget.com/plugins/qiqll/dsh-task-suite
curl -s -o /dev/null -w '%{http_code}\n' https://dshget.com/zh/plugins/qiqll/dsh-task-suite

# 快照是否仍缺失
curl -s https://raw.githubusercontent.com/bobby-sheng/dshget-data/main/catalog.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["count"], d["updated"], sum(1 for p in d["plugins"] if p["name"]=="dsh-task-suite"))'

# 源事实
npm view dsh-task-suite version license repository.url
```

本机实跑（2026-11-25）：

```text
404
404
2460 2026-08-16 0
1.1.1 MIT git+https://github.com/qiqll/dsh-task-suite.git
```

### 4.5 提交后如何验证收录

```sh
# 1) 详情页 200（英文与中文都试）
curl -s -o /dev/null -w '%{http_code}\n' https://dshget.com/plugins/qiqll/dsh-task-suite
curl -s -o /dev/null -w '%{http_code}\n' https://dshget.com/zh/plugins/qiqll/dsh-task-suite

# 2) 快照包含条目
curl -s https://raw.githubusercontent.com/bobby-sheng/dshget-data/main/catalog.json \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print([p for p in d["plugins"] if p["name"]=="dsh-task-suite"])'

# 3) sitemap 与实际页面一致
curl -s https://dshget.com/sitemap.xml | grep -c 'qiqll/dsh-task-suite'
```

DSH Get 的线上站点更新频率高于快照仓库，所以“线上先出现、快照后更新”是正常的；以详情页 200 + 条目字段正确为准。

### 4.6 说明

- 不要直接改 `catalog.json` 提 PR：它是生成快照，下次同步会被覆盖；Issue 才是该仓库声明的修正入口。
- 线上站点标题显示 14,498 个扩展，而快照只有 2,460 条（2026-08-16），两者不一致本身就是本次要报告的事实，不要只写“加一个插件”。

---

## 5. 提交顺序与预计耗时

| 顺序 | 材料 | 动作 | 前置条件 | 提交耗时 | 生效/审核 | 主要风险 |
|---|---|---|---|---|---|---|
| 1 | DSH Go 市场 PR | Fork → 加 `plugins/dsh-task-suite.json` → 向 `main` 提 PR | 无（npm 1.1.1 已发布） | 10–15 分钟 | 自动检查通过后 auto-merge，通常 10–30 分钟 | 风险扫描标记 shell/network/filesystem（medium），不影响上架；版本/许可已核对 |
| 2 | hrhgit 目录 Issue | 开 Issue 请求 full reconcile | 无 | 5–10 分钟 | 维护者处理 + 下次扫描，1–3 天 | 1000 条上限可能仍需维护者改扫描窗口 |
| 3 | DSH Get Issue | 开 Issue 补录 + 修 sitemap | 无 | 5–10 分钟 | 维护者处理/站点重新生成，1–5 天 | 快照更新慢；英文详情页 404 可能是站点级问题 |
| 4 | OMDSH Hub 投稿 | 加 `dshWorkshop` → 发 1.1.2 → 填 Issue 表单 | **必须先改 `package.json` 并发布 1.1.2** | 30–60 分钟（含发版）+ 10 分钟 | `pending-review` 后人工审核，数天到数周 | 当前基线 `0.1.0-rc.6` 与作者验证的 `0.2.1-rc.5` 不一致，可能 `needs-fix`；无 RC.6 evidence |

**建议**：先做 1（全自动、最快），同时开 2 和 3（互不依赖），最后做 4（需要一次真实发版）。4 的 manifest 可以先在本地写好、跑通官方 `validate`，再决定何时发 1.1.2。

### 5.1 提交记录（提交后回填）

| 材料 | 提交 URL | 提交日期 | 当前状态 | 备注 |
|---|---|---|---|---|
| DSH Go PR |  |  |  |  |
| hrhgit Issue |  |  |  |  |
| DSH Get Issue |  |  |  |  |
| OMDSH Issue |  |  |  |  |

### 5.2 提交前的最后自检

- [ ] `npm view dsh-task-suite version` 返回 `1.1.1`（OMDSH 走 1.1.2 时返回 `1.1.2`）
- [ ] GitHub 仓库仍是 public，topic 仍包含 `dsh-plugin`，license 仍为 MIT
- [ ] `v1.1.1` tag 指向 `c0c8e42…`；若已发 1.1.2，换成新 tag/commit
- [ ] DSH Go 条目文件名是 `dsh-task-suite.json`，`version` 是精确版本
- [ ] OMDSH 的 `packageManifest` 与 `package.json#dshWorkshop` 逐字一致
- [ ] 四个 Issue/PR 正文里没有 token、私有路径、客户名或本机绝对路径
- [ ] 没有把 `tier`、risk、integrity 或“已审核”写进 DSH Go 条目
- [ ] 没有直接编辑任何市场的生成文件（catalog/queue/registry/sitemap）
