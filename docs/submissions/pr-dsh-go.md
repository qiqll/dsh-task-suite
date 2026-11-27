# PR：DSH Go 市场（ccch1mneyyy/dsh-go-market）

**对比链接（点开直接建 PR）**：
https://github.com/ccch1mneyyy/dsh-go-market/compare/main...qiqll:main?expand=1

**标题**：

```text
Add dsh-task-suite 1.2.0
```

**正文**（复制下面整块）：

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

## 用 gh CLI 一条命令（可选）

```sh
gh pr create \
  --repo ccch1mneyyy/dsh-go-market \
  --base main \
  --head qiqll:main \
  --title "Add dsh-task-suite 1.2.0" \
  --body-file docs/submissions/pr-dsh-go.md
```

> 注意 `--body-file` 要指向上面的「正文」段落；若直接用本文件，标题/说明文字也会进正文。稳妥做法是先把正文段另存为临时文件，或用网页版粘贴。
