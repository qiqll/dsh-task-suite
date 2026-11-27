# 给 OMDSH Issue #188 的补充说明（复制到评论）

> 用途：把「预检失败不是清单问题」讲清楚，并把复现数据和现成修复 PR 指给维护者。
> 直接粘贴下面整段即可（英文，仓库文档是双语的）。

```markdown
### Preflight diagnosis: the failure is the known new-project `untested` gate, not this submission

Reproduced locally against `main` of this repository, with this Issue's body as the event payload.

**1. The intake stage that this submission controls passes.**

`node scripts/prepare-issue-intake.mjs <event>` →
`prepared dsh-task-suite@1.2.0 from Issue #188 with a typed Harness plan; Registry remains ineligible`

So title pattern, fenced-JSON extraction, `validateSubmission`, `createIntakeRecord`, the typed plan, and the anonymous public-source preflight (public repo, commit `433fcba07cefcd3aae71a6b1ab9d178295412b2e`, all declared paths present) all succeed.

**2. `npm run validate` fails one assertion later, in the inventory gate.**

`scripts/check-public-site.mjs:138`:

```text
verification inventory must cover every Catalog project, match exact Intake evidence, and grant no Registry admission
```

Bisecting the clauses of that condition gives exactly one mismatch:

| clause | value | expected |
|---|---|---|
| `inventory.summary.verification.untested` | **885** | `catalog.packages.length - intake.records.length` = 896 − 12 = **884** |
| `catalogProjects`, `projects.length` | 896 | 896 |
| `current-baseline-passed` / `source-evidence-passed` / `blocked` | 1 / 9 / 1 | 1 / 9 / 1 |
| `management.transactional` / `guided` | 2 / 894 | 2 / 894 |

**3. Why a first-time submission can never satisfy it.**

`scripts/build-verification-inventory.mjs` builds one row per **Catalog** project, so an intake record for a project that is not in the Catalog yet (this one: `create-project`) contributes no row and cannot lower `untested`. `check-public-site.mjs` however subtracts **all** intake records, so the two numbers can never agree for a new project — only for updates of already-catalogued ones.

**4. There is already a fix for this exact assertion.**

PR #185 — *fix(intake): subtract only Catalog-backed submissions from the untested count* (open since 2026-11-02, mergeable, +6/−1 in `scripts/check-public-site.mjs`) — changes precisely this subtraction. Merging it unblocks this Issue and the other new-project submissions in the queue (#180, #176, #174…).

I am not resubmitting to avoid duplicate Issues; the fixed source (`433fcba…`, npm `1.2.0`) will stay valid. Happy to re-run anything if you prefer a different manifest shape.
```

## 提交前自检

- [ ] 只贴上面 `markdown` 代码块的内容，不要带上本文件的小标题
- [ ] 不要 `@` 任何人
- [ ] 不要在评论里重复贴整份 manifest（Issue 正文已有）
