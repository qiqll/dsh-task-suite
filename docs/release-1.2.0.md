# dsh-task-suite 1.2.0

1.2.0 是发布工程化版本：把「能发」和「发对了」变成 CI 可验证的流程，并让仓库对英文用户可读。运行时行为与 1.1.2 一致。

## 新增

- **双语 README**：`README.md` 英文（npm / GitHub 默认展示）+ `README.zh-CN.md` 中文，顶部互相链接，npm 包同时包含两份。
- **版本一致性检查**：`node scripts/check-version.mjs`，校验 package.json、CHANGELOG 最新条目、两份 README 的 Release 链接、`files[]` 与 tag 是否同一版本。
- **CI**：`.github/workflows/version-check.yml` 在 push / PR / tag 上跑插件自测、面板自测、CLI 自测、版本一致性与 `npm pack --dry-run`。
- **Issue 模板**：Bug / Feature 表单 + Discussions 引导。
- **发布脚本**：`scripts/release.sh`，幂等执行 push → publish → tag → release，支持 `--dry-run`。

## 升级

```sh
dsh plugin --profile desktop add dsh-task-suite
```

装完完整退出并重新打开 DSH 一次。

## 验证

```sh
node selftest.mjs            # 18/18
node test-dashboard.mjs      # 11/11
node bin/dsh-task --selftest # 8/8
node scripts/check-version.mjs
npm view dsh-task-suite version
# 1.2.0
```

## 发布步骤（人工）

```sh
git add -A && git commit -m "release: 1.2.0"
./scripts/release.sh          # push → npm publish → tag v1.2.0 → GitHub Release
```
