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
