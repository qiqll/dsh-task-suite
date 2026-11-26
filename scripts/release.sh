#!/usr/bin/env bash
# 发布一个版本：git push → npm publish → tag → GitHub Release。
# 幂等：已经 push / 已发布 / 已有 tag / 已有 release 的步骤会跳过，可重复执行。
#
#   ./scripts/release.sh --dry-run     # 只打印将要执行的命令与 release notes
#   ./scripts/release.sh               # 真正发布
#
# 前置：git 工作区干净、在 main 上、npm 已登录（npm whoami 能返回用户名）、gh 已登录。
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
PACKAGE="$(node -p "require('./package.json').name")"

run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '  [dry-run] %s\n' "$*"
  else
    printf '  $ %s\n' "$*"
    "$@"
  fi
}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- 前置检查 ---------------------------------------------------------------
[[ -z "$(git status --porcelain)" ]] || die "工作区不干净，先 commit 或 stash"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$CURRENT_BRANCH" == "main" ]] || die "当前分支是 $CURRENT_BRANCH，发布请切到 main"

if [[ "$DRY_RUN" == "0" ]]; then
  NPM_USER="$(npm whoami 2>/dev/null || true)"
  [[ -n "$NPM_USER" ]] || die "npm 未登录或 token 失效：先执行 npm login（或写入新的 _authToken）"
  printf 'npm 用户：%s\n' "$NPM_USER"
  gh auth status >/dev/null 2>&1 || die "gh 未登录：先执行 gh auth login"
else
  printf 'npm/gh 登录状态：dry-run 跳过检查\n'
fi

printf '\n发布 %s@%s（tag %s）\n\n' "$PACKAGE" "$VERSION" "$TAG"

# --- 1. 推送 main -----------------------------------------------------------
printf '1) 推送 main\n'
if git rev-parse --verify --quiet "origin/main" >/dev/null \
   && [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]]; then
  printf '  已是最新，跳过\n'
else
  run git push origin main
fi

# --- 2. npm publish ---------------------------------------------------------
printf '2) npm publish\n'
PUBLISHED="$(npm view "$PACKAGE@$VERSION" version 2>/dev/null || true)"
if [[ -n "$PUBLISHED" ]]; then
  printf '  npm 上已有 %s，跳过\n' "$VERSION"
else
  run npm publish
fi

# --- 3. tag ----------------------------------------------------------------
printf '3) tag %s\n' "$TAG"
if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  printf '  本地已有 tag，跳过创建\n'
else
  run git tag "$TAG"
fi
if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  printf '  远端已有 tag，跳过推送\n'
else
  run git push origin "$TAG"
fi

# --- 4. GitHub Release ------------------------------------------------------
printf '4) GitHub Release %s\n' "$TAG"
NOTES_FILE="$(mktemp)"
trap 'rm -f "$NOTES_FILE"' EXIT
node - "$VERSION" >"$NOTES_FILE" <<'NODE'
const fs = require('fs')
const version = process.argv[2]
const text = fs.readFileSync('CHANGELOG.md', 'utf8')
const lines = text.split('\n')
const start = lines.findIndex((l) => new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}(\\s|$)`).test(l))
if (start === -1) {
  console.error(`CHANGELOG.md 里没有 ${version} 的条目`)
  process.exit(1)
}
let end = lines.length
for (let i = start + 1; i < lines.length; i += 1) {
  if (/^##\s+/.test(lines[i])) { end = i; break }
}
process.stdout.write(lines.slice(start, end).join('\n').trim() + '\n')
NODE

if gh release view "$TAG" >/dev/null 2>&1; then
  printf '  Release 已存在；如需刷新说明：\n    gh release edit %s --notes-file <(sed -n "/^## %s/,/^## /p" CHANGELOG.md)\n' "$TAG" "$VERSION"
else
  run gh release create "$TAG" --title "$VERSION" --notes-file "$NOTES_FILE"
fi

printf '\n完成：%s@%s\n' "$PACKAGE" "$VERSION"
printf '校验：npm view %s@%s version\n' "$PACKAGE" "$VERSION"
