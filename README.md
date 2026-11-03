# DSH Task Suite

把 Claude 的 `task-*` 任务体系移植到 DeepSeek Harness 的本地插件：**一份任务池 + 一套状态机 + 主会话调度 + 后台 worker + 机器验收**。

主 agent 负责和需求方对话、排期、派活、验收；后台 `subagent` 在全新上下文里完成单个任务并输出结构化报告。任务池是磁盘上的 Markdown，需求方可以直接看、直接改。

**git 不是必需**：在 git 仓库里用 commit/worktree 验收；在普通目录自动降级为「文件快照模式」，用快照 + 文件清单完成基线比对、改动归属、测试改弱审计和回滚。

## 安装

从 npm：

```sh
dsh plugin add dsh-task-suite
# 或指定 profile
dsh plugin --profile web add dsh-task-suite
```

直接从 GitHub 源码安装：

```sh
dsh plugin add qiqll/dsh-task-suite
```

桌面版也可以在 **设置 → 插件** 里搜索 `dsh-task-suite` 安装。首次安装后工具与三个 skill（`task-admin` / `task-loop` / `task-worker`）自动注册，无需重启。

本地开发时把本目录 `link:` 到 profile 的依赖里即可；修改代码后禁用/启用该插件行即可热重载。

## 插件市场

本插件按 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的收录格式准备；市场卡片、安装与更新由该目录和 npm 版本驱动。

## 快速开始

```text
task_init                                   # 建 .dsh/tasks/（git 仓库里顺带写 .gitignore）
task_add items=[{title, module, priority, deps, acceptance, note}]
task_status                                 # 全局视图 / 待决策 / 阻塞 / 流水
task_pick mode=manual task_id=T-001         # 手动单步，自己实施
task_accept report="<报告块>"               # 机器验收
task_confirm task_id=T-001 conclusion="..." # 需求方确认后归档
```

自动循环（推荐）：

```text
task_loop action=start max=10 hours=8
task_loop action=tick        # 返回 worker_prompt
# 把 worker_prompt 原样交给 subagent 工具；然后结束回合等完成通知
# 收到 worker 的最后一条消息后：
task_accept report="<整段报告块>"
# 通过 → 待验证；需求方确认 → task_confirm；不通过 → task_reject
task_loop action=tick        # 派下一个
```

停机：`task_loop action=stop reason="..."`；中途叫停：先 `interrupt_agent` 再
`task_loop action=halt`（保留提交，不回滚）。叫停后继续用 `action=resume`
（同一任务带断点重派），放回队列用 `action=requeue`。

## 状态与目录

```text
.dsh/tasks/
├── backlog.md          # 需求方入口：P0–P3 表、待决策、人工阻塞、ID 规则
├── dev-plan.md         # AI 维护：当前批次、进行中、技术前置
├── dev-progress.md     # 已完成归档（按月）
├── inbox/              # 需求方/调度方投递（task_*.json），merge 后移到 .merged/
└── auto/               # 运行时状态，整目录 gitignore
    ├── current.json    # 当前任务：nonce / startSha / 脏文件 / 阶段
    ├── session.json    # 循环会话：active / max / hours / done / noprog
    ├── run.log         # 运行流水
    ├── STOP            # 停机标记
    └── snapshots/      # 非 git 模式：开工快照 + manifest（确认后删）
        └── T-001-<nonce>/
            ├── manifest.json
            └── files/
```

git 仓库里 `task_init` 会把 `.dsh/tasks/` 加入 `.gitignore`；非 git 目录不创建 `.gitignore`。任务池是运行态，不进业务提交。
每个工作区独立一份池；默认不碰 Claude 的 `.claude/` 池。

状态机：

```text
待开始 → 进行中 → 待验证 → 已完成
             └→ 阻塞 / 待决策 → 待开始
             └→ 打回 → 进行中
```

同一时刻只允许一个「进行中」；P0 可中断（旧任务记断点）。

## 工具

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `task_init` | 初始化池 + `.gitignore` | — |
| `task_add` | 录入 1..N 条，自动判重/ID/依赖/验收 | `items[]`, `source` |
| `task_status` | 全局视图与下一步建议 | — |
| `task_list` | 按状态/优先级/关键词筛选 | `status`, `priority`, `query` |
| `task_show` | 单任务完整简报 | `task_id` |
| `task_pick` | 认领任务；auto 返回 worker_prompt | `mode`(auto/manual), `task_id`, `interrupt` |
| `task_accept` | 机器验收 worker 报告 | `report`, `rollback` |
| `task_confirm` | 需求方确认 → 归档 | `task_id`, `conclusion`, `gate` |
| `task_reject` | 需求方打回 → 待开始 | `task_id`, `reason` |
| `task_answer` | 答复待决策/阻塞，回到待开始 | `task_id`, `answer` |
| `task_inbox` | 投递需求/决策（worker 在跑时用） | `type`, `text`, `title`, `ref` |
| `task_merge` | 立即合并 inbox | — |
| `task_loop` | 循环状态机 | `action`, `max`, `hours`, `reason` |
| `task_verify` | 只读重跑测试 + 基线比对 + 改弱审计 | `test_cmd`, `start_sha` |
| `task_audit` | 只读审计提交归属/越界/脏文件/改弱 | `start_sha`, `task_id` |

`task_loop` 的 action：`start` / `tick` / `stop` / `halt` / `resume` / `requeue` / `status`。

## Worker 报告契约

worker 最后一条消息只输出：

```text
=== TASK-AUTO REPORT ===
NONCE: <current.json 的口令>
RESULT: DONE | NEEDS_DECISION | BLOCKED | BASELINE_RED | FAILED | GATE_PENDING_REVIEW
TASK: T-001
START_SHA: <开工 SHA>
COMMITS: <sha...>
TEST_CMD: <[cd dir &&] 单条测试命令 路径...>
TEST_RESULT: 基线 x passed, y failed → 交付后 z passed, w failed；既有失败：...
TEST_CHANGES: 仅新增 / 无改动 / 有修改（说明）
GATE: <code-reviewer H×n M×n；跳过原因；...>
ACCEPTANCE: <对照验收标准>
ASSUMPTIONS: — / ...
DECISION: — / 问题 / 选项 / 推荐
BLOCKER: — / ...
DERIVED:
- [P2] 标题 | 涉及文件 ... | 来源 ...
BRIEF:
给需求方的 1–3 句人话说明
=== END REPORT ===
```

`task_accept` 会校验 nonce、任务归属、阶段、提交信息里的任务 ID、脏文件、
测试范围与基线失败集合、测试是否被改弱、高风险路径；通过后把任务落到
「待验证」并生成衍生任务，失败则按 RESULT 进入待决策 / 阻塞 / 自动失败计数。

`GATE_PENDING_REVIEW` 时验收暂停在 `review_pending`：调度员自己看 `start_sha..HEAD`，
通过就再调用 `task_accept` 并传 `review="pass: ..."`（同一报告即可），验收继续；
不通过就把发现发回 worker 修复并重交。

## 两种基线模式

`mode` 默认 `auto`：能拿到 git HEAD 就用 git 模式，否则自动用文件模式；也可以强制 `mode: file` / `mode: git`。

| | git 模式 | 文件模式（非 git 目录） |
|---|---|---|
| 开工基线 | `START_SHA` | `auto/snapshots/<T-NNN>-<nonce>/` 全量快照 + `manifest.json` |
| 改动归属 | commit message 含任务 ID | 快照与当前目录的文件差异（新增/修改/删除） |
| 基线测试 | `git worktree` 回到 START_SHA | 快照复制到临时目录，回放开工时代码 |
| 回滚 | `git reset --keep START_SHA` + ref | 从快照恢复文件，恢复前再备份当前树 |
| 提交要求 | 每个 commit 带任务 ID | 不 commit；`COMMITS: —` |
| 局限 | 要求有 HEAD | 无法区分「谁改的」；快照占磁盘；依赖目录/构建产物被排除 |

快照默认排除 `.git`、`node_modules`、`.venv`/`venv`、`__pycache__`、`dist`/`build`、`.dsh/tasks` 等。项目很大时用 `snapshotIgnore` 排除更多目录，或调大 `snapshotMaxBytes` / `snapshotMaxFiles`。任务确认/打回后快照会删除，并默认只保留最近 10 份。

文件模式的 `TEST_CMD`、测试改弱审计、nonce、遗留文件检查与 git 模式完全一致；只是「提交归属」换成「快照差异归属」。

## 验收与防作弊

- **nonce**：每次 claim 生成一次性口令，旧报告/重复通知直接丢弃。
- **提交归属**（git）：`git log START_SHA..HEAD` 里每个 commit 的 message 必须含任务 ID；出现别人的 commit → 停下，不自动处理。
- **改动归属**（文件）：与开工快照比对，新增/修改/删除都列出；报告 `CHANGES` 与实际不符会告警。
- **基线比对**：当前测试失败时，在 `git worktree` 的 START_SHA（git）或快照副本（文件）上重跑同一命令，只有「基线也失败」的用例才算既有失败；新失败 → 打回。
- **测试范围**：`TEST_CMD` 必须是单条命令，禁止 `; | & $( > <` 与
  `-k/--deselect/--ignore/--lf/--collect-only/--passWithNoTests`；
  改动/删除的测试文件必须落在命令路径参数覆盖范围内。
- **改弱审计**：删除用例、移走文件、skip/xfail、注释断言、断言净减少、
  测试配置 ignore 都会产生告警；DONE 带告警 → 转「待决策」。
- **高风险路径**：认证、支付、迁移、部署、CI、依赖清单等；命中时要求报告写
  `GATE` 与 `ASSUMPTIONS`，否则转人工 review。

## 配置

`cordis.patch.yml` 的 `config` 可覆盖：

| 键 | 默认 | 说明 |
|---|---|---|
| `stateDir` | `.dsh/tasks` | 相对项目根 |
| `testTimeoutSec` | `900` | 单次测试超时 |
| `defaultMaxTasks` | `10` | 循环最多交付数 |
| `defaultMaxHours` | `8` | 循环最长小时数 |
| `maxNoprog` | `3` | 连续无进展自动停机 |
| `maxDerivedPerParent` | `3` | 单任务衍生上限 |
| `maxDerivedDepth` | `2` | 衍生层级上限 |
| `mode` | `auto` | `auto` / `git` / `file`；强制文件模式可让 git 仓库也走快照 |
| `snapshotIgnore` | `[]` | 额外排除的相对路径或 `*` glob |
| `snapshotMaxBytes` | `536870912` | 单次快照体积上限（512MB） |
| `snapshotMaxFiles` | `20000` | 单次快照文件数上限 |
| `snapshotKeep` | `10` | 保留最近多少份快照 |

## 与 Claude 版的差异

- 状态目录是 `.dsh/tasks/`（DSH 独立运行态），不是 `.claude/`。
- 调度用 DSH 的 `subagent` 工具；没有内置心跳/cron，长循环可用
  `schedule_create` 定时提醒主会话 `tick`。
- 机器验收在原 `verify_tests.sh` / `check_test_weakening.sh` 的基础上重写为
  Node 实现，判定口径保持一致。
- 不提供 Web 任务板；`backlog.md` 就是看板。

## 开发自测

```bash
cd dsh-task-suite
node selftest.mjs
```

自测覆盖两种模式：

- git：建池/录入/解析、认领、报告解析、DONE 验收与归档、FAIL_NEW 基线比对、测试改弱、inbox、待决策、循环启停、halt/resume/requeue；
- 非 git：快照认领、快照差异归属、DONE 验收、FAIL_NEW 基线、测试改弱、失败回滚。
