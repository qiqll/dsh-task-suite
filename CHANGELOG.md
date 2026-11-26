# Changelog

本文件记录 `dsh-task-suite` 的重要变更。版本号遵循 [semver](https://semver.org/)；`package.json` 的 `version` 是 npm 上用于判断更新的版本。

## 1.2.0 — 2026-11-26

发布工程化版本：把「能发」和「发对了」变成 CI 可验证的流程，并让仓库对英文用户可读。

### Added

- **双语 README**：`README.md` 为英文（npm / GitHub 默认展示），`README.zh-CN.md` 为中文原版，两边顶部互相链接；npm 包同时带上两份。
- **版本一致性检查** `scripts/check-version.mjs`：校验 `package.json`、`CHANGELOG.md` 最新条目、两份 README 的 Release 链接、`files[]` 是否含中文 README，以及 CI 上的 `v*` tag 是否与版本号一致。
- **GitHub Actions** `.github/workflows/version-check.yml`：push / PR / tag 时跑插件自测、面板自测、CLI 自测、版本一致性与 `npm pack --dry-run`。
- **Issue 模板**：`bug_report.yml`、`feature_request.yml`、`config.yml`（引导使用问题去 Discussions）。
- **发布脚本** `scripts/release.sh`：幂等地完成 push → npm publish → tag → GitHub Release，已完成的步骤自动跳过，支持 `--dry-run`。
- `npm run test:all`：一次跑完插件、面板、CLI 三套自测与版本检查。

### Changed

- 默认 README 语言从中文改为英文；中文内容完整保留在 `README.zh-CN.md`，不再是「只有中文」的单语仓库。
- `package.json` 的 `files[]` 增加 `README.zh-CN.md`。

### 升级

```sh
dsh plugin --profile desktop add dsh-task-suite
```

行为与 1.1.2 一致，本版本没有运行时变更；升级后可完整重启一次 DSH 让面板刷新。

## 1.1.2 — 2026-11-25

验收语义对齐 claude-task 0.3.12 / 0.3.13，并补齐市场投稿所需的清单与素材：

- **超时默认通过**：任务进入待验证时写入 `**待验证超时：** N 天`（backlog 未声明时默认 7 天，`0` 关闭），同时写 `待验证起` 与 `怎么验`（≤3 步，优先命令或 URL）。到期前 1 天发一次 `超时预告` 通知；满 24 小时仍无人打回、且交付提交仍在分支上未被回退，则归档为「已完成」并在 `run.log` 记 `TIMEOUT_PASS`。命中高风险改动、改动测试、或备注写了 `默认通过：否` 的任务永不默认通过；存量任务首次检查时从其提交推断起始日期（`· 存量`）。循环在合并 inbox 后与空闲心跳时检查，`/task:next` 在无循环运行时也会检查。
- **自动验收**：循环的机器验收全部通过（`PASS`、无测试改弱告警、无高风险路径、无新增待决策、无 ASSUMPTIONS）时，满足规则 a（只改测试）或规则 b（P2/P3 且录入时标了 `验收方式：自动`、验收标准来自需求方）的任务直接归档为「已完成」，`run.log` 记 `DONE→已完成（自动验收）`；简报仍会发出，只是不弹通知。手动单步（`/task:next`）永不做自动验收。
- **衍生的 P3 只录不做**：worker 报告里的 `DERIVED` 任务默认记为 P3「AI 衍生 P3，只录不做」，循环不派发；人工把任务移到 P0–P2 表后才照常派发。唯一例外是 reviewer 判定的安全 High / Critical 问题（来源为 reviewer finding ID），此时按其父任务优先级排队；基线变红后的修复任务同样只录不做，改由待决策通知人工提高优先级。
- **重开**：打回已归档任务（`dsh-task -d T-0NN "打回：…"`）会按 `dev-progress.md` 里的记录重建任务行并重新排队，`dev-progress.md` 记录末尾追加 `**重开：**`，`run.log` 记 `REJECT | 重开`。关闭方式（需求方确认 / 自动验收 / 超时默认通过）会随归档记录保留。
- **`bin/dsh-task` CLI**：新增终端命令（对齐 claude-task 的 `qtask`），支持 `--status` 查看任务池概览、`-d/--decision` 批量答复待决策、`--pass [ID…] [--except ID…]` 确认待验证、`--selftest` 在临时目录自检；直接读写项目下的 `.dsh/tasks/`（临时文件 + rename 原子写，写后回读校验），不经过 inbox。
- **市场卡片素材**：新增 `screenshots.json`（3 张面板截图）与 `assets/icon-512.png`，README 增加 npm / License / DSH plugin / awesome-dsh-plugin 徽章与介绍页链接；`files` 白名单补上 `client.js`、`bin/*`、`assets/*.png` 与 `LICENSE`，`npm pack` 的 tarball 因此包含 `LICENSE`、`bin/dsh-task`、`cordis.patch.yml`。
- **`dshWorkshop` 清单**：`package.json` 顶层新增 `dshWorkshop`（`omdsh-workshop-package/v1`），声明 profile bundle 的安装/生命周期语义、权限、兼容版本与 `task_status` 能力，满足 OMDSH Hub v2 投稿 preflight 的逐值比对。
