#!/usr/bin/env node
// 发布一致性检查：package.json / CHANGELOG / README（中英）/ git tag 必须同一版本。
// 用法：node scripts/check-version.mjs
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const root = new URL('..', import.meta.url)
const read = (name) => readFileSync(new URL(name, root), 'utf8')
const errors = []
const ok = []

const pkg = JSON.parse(read('package.json'))
const version = pkg.version
const tag = `v${version}`
ok.push(`package.json version = ${version}`)

// 1. CHANGELOG 的第一条版本必须等于 package.json
const changelog = read('CHANGELOG.md')
const firstHeading = changelog.match(/^##\s+(\d+\.\d+\.\d+[^\s]*)/m)
if (!firstHeading) {
  errors.push('CHANGELOG.md 里找不到形如 "## 1.2.0" 的版本标题')
} else if (firstHeading[1] !== version) {
  errors.push(`CHANGELOG.md 最新条目是 ${firstHeading[1]}，package.json 是 ${version}`)
} else {
  ok.push(`CHANGELOG.md 最新条目 = ${firstHeading[1]}`)
}
if (!new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}(\\s|$)`, 'm').test(changelog)) {
  errors.push(`CHANGELOG.md 缺少 ${version} 的独立条目`)
}

// 2. 两个 README 都要存在，并指向当前版本的 Release
for (const name of ['README.md', 'README.zh-CN.md']) {
  if (!existsSync(new URL(name, root))) {
    errors.push(`缺少 ${name}`)
    continue
  }
  const text = read(name)
  if (!text.includes(`releases/tag/${tag}`)) {
    errors.push(`${name} 里的 Release 链接不是 ${tag}`)
  } else {
    ok.push(`${name} → releases/tag/${tag}`)
  }
}

// 3. npm 包必须带上中文 README
const files = pkg.files || []
if (!files.includes('README.zh-CN.md')) {
  errors.push('package.json files[] 缺少 README.zh-CN.md（npm 只会自动带 README.md）')
} else {
  ok.push('package.json files[] 含 README.zh-CN.md')
}

// 4. CI 在 tag 上运行时，tag 必须等于 package.json 版本
const ref = process.env.GITHUB_REF || ''
if (ref.startsWith('refs/tags/')) {
  const pushed = ref.slice('refs/tags/'.length)
  if (pushed !== tag) {
    errors.push(`tag ${pushed} 与 package.json 版本 ${tag} 不一致`)
  } else {
    ok.push(`git tag = ${pushed}`)
  }
}

// 5. 本地有 tag 时顺带比对（CI 之外也有用）
try {
  const localTag = execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
    cwd: new URL('.', root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  if (localTag && localTag !== tag) {
    errors.push(`HEAD 上的 tag 是 ${localTag}，package.json 是 ${tag}`)
  } else if (localTag) {
    ok.push(`HEAD tag = ${localTag}`)
  }
} catch {
  // HEAD 没有 tag 是正常的（发布前的提交）
}

for (const line of ok) console.log(`  ok  ${line}`)
if (errors.length) {
  for (const line of errors) console.error(`  ERR ${line}`)
  console.error(`\nversion-check: ${errors.length} 个问题`)
  process.exit(1)
}
console.log(`\nversion-check: ${version} 一致`)
