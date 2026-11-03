# 任务池管理 · 手动单步

这是**手动模式**：一次只交付一个任务，做完就停，等需求方确认。无人值守连续消化用 skill `task-loop`（调度员 + 后台 worker），两者共用同一套 `.dsh/tasks/` 状态。

## 文件与工具

| 文件 | 谁写 | 作用 |
|------|------|------|
| `.dsh/tasks/backlog.md` | 需求方 + AI | 待办池：P0–P3、状态、依赖、验收、待决策、人工阻塞 |
| `.dsh/tasks/dev-plan.md` | 工具自动 | 排期：当前批次、进行中、待验证、阻塞 |
| `.dsh/tasks/dev-progress.md` | 工具自动 | 已完成归档（需求方确认后才写） |
| `.dsh/tasks/inbox/*.md` | 需求方/工具 | 新任务与决策投递，`task_merge` 单点合并 |
| `.dsh/tasks/auto/` | 工具自动 | current / session / run.log / STOP（运行时状态，已 gitignore） |

工具：`task_init` `task_add` `task_status` `task_list` `task_show` `task_pick` `task_accept` `task_confirm` `task_reject` `task_answer` `task_inbox` `task_merge` `task_verify` `task_audit` `task_loop`（`start/tick/stop/halt/resume/requeue/status`）。

## 状态机

```
待开始 ──► 进行中 ──► 待验证 ──► 已完成
   │          │          │
   └──► 已取消 └──► 阻塞  └──► 打回（验证不通过，回到进行中）
```

| 状态 | 含义 | 谁改 |
|------|------|------|
| `待开始` | 已录入，排队中 | 需求方录入 / AI |
| `进行中` | AI 正在实施（同一时刻最多 1 个） | AI |
| `阻塞` | 缺前置条件（依赖任务未完成 / 需人工操作 / 需你决策） | AI |
| `待决策` | 遇到需你拍板的问题，已挂到「待决策」表，答复后回到待开始 | AI |
| `待验证` | 代码已提交并过门禁，等你实际使用确认 | AI |
| `已完成` | 你确认无误，移入 `dev-progress.md` | 需求方确认后由 AI 移动 |
| `打回` | 你使用后发现不对，说明问题后重新排队 | 需求方 |
| `已取消` | 不做了 | 需求方 |

## 优先级

按**后果**定级，不按语气：

| 判据 | 级别 |
|------|------|
| 已在线上产生错误数据 / 安全漏洞 / 服务不可用 | P0（可打断进行中的任务） |
| 用户能感知的功能缺失、报错、体验断点 | P1 |
| 功能增强、重构、补测试、清技术债 | P2 |
| 没有明确使用场景的想法 | P3 |

判定不确定时问需求方，不要自己拍；误判 P0 会打断正在进行的任务。

## 0. 初始化

`task_init`：创建三个文件与 `inbox/`、`auto/`；git 仓库里把运行时目录加进 `.gitignore`，非 git 目录不加。已存在文件一律不动。

## 1. 录入（只录入，不实施）

`task_add items=[…]`，每条：

- `title`：动宾结构，说清「改什么达到什么效果」，不要写成「优化 XX」。
- `priority`：按上面判据；不确定就问。
- `module`：沿用待办池已有模块名；项目有模块索引就对索引。
- `acceptance`：**以「验收：…」给出可用命令或操作判定的完成标准**；需求方给了就照抄，没给就拟一条并标 `acceptanceAi: true`。
- `deps`：依赖的 `T-0NN` / `H-0NN`；无则省略。
- `parent`：衍生任务填父 ID（层级自动 +1，优先级不得高于父）。
- 一句话里包含多个可独立交付的诉求就拆多条；不能独立提交的（「加端点」+「加端点测试」）不拆。

录入前 `task_list query=…` 查重；工具也会自动并入重复项。录完回执只报 ID、标题、优先级和池计数，不复述全表。

## 2. 挑任务

- `task_status` 看全局；有「进行中」说明上次未收尾，先继续它，不要挑新的（除非需求方指定）。
- `task_pick task_id=<可选>`，自动按 P0→P1→P2→P3 + 依赖顺位挑，跳过待决策/阻塞/待验证。
- 全空或全阻塞：报空 + 阻塞原因，**不要自己发明需求**。
- `task_pick mode=manual` 会把任务标「进行中」并捕获基线（git：START_SHA + 脏文件；非 git：文件快照）/ nonce，返回简报。

## 3. 开工前澄清（需求方保留决策权）

以下情况必须先问，不要自行假设：没有可验证的完成标准；2 种以上合理路径且代价差异显著；要改数据库 schema / 核心路由 / 认证；会破坏对外 API 兼容性。问清再继续。

## 4. 实施

加载 skill `task-worker` 按它的硬约束做（它同样适用于手动模式）：范围收敛、不碰既有脏文件、不改弱测试。git 模式每逻辑单元 commit 带任务 ID、不 push；文件模式不 commit，改动直接留工作区。需要看大文档时 grep 定位。

## 5. 门禁

- `subagent` 派 code review 审本任务全部改动（git：`START_SHA..HEAD`；文件模式：快照与当前工作区差异）；涉及认证/输入/上传/加密追加安全审查。
- 修 High/Critical；Medium 酌情；Low 标跳过理由；修复独立 commit（`fix: review 修复 — T-0NN`）。
- 跑回归测试；既有失败用 `task_verify` 的基线比对证明，不要笼统说「不相关」。
- git 模式：`git status --porcelain` 除开工脏文件外必须干净；文件模式：确认没改 `.dsh/tasks/` 和不该动的文件。

## 6. 交付

写一份与 worker 相同格式的报告块（`NONCE` 用 `task_pick` 返回的 nonce），调用 `task_accept report=…`。它会机器验收并把任务置「待验证」，同时录入衍生任务、刷新 dev-plan。

然后输出 6 行内简报：做了什么、改了哪些文件、门禁结果、请你怎么验证、待办池计数、下一个建议。**停在这里，不要自动开始下一个，不要 `git push`。**

## 7. 需求方确认后

| 需求方说 | 你做 |
|---------|------|
| 「T-0NN 没问题 / 通过 / 验证 OK」 | `task_confirm task_id=… conclusion=…` → 移入 dev-progress.md |
| 「T-0NN 不对 / 打回：…」 | `task_reject task_id=… reason=…` → 「打回」重排队；先定位为什么第一次做错，再改 |
| 「T-0NN 选 B / 按 X 改」 | `task_answer task_id=… answer=…` |
| 「加个任务：…」 | `task_add` 或 `task_inbox`（自动循环在跑时用 inbox） |

## 8. 自动循环

需求方说「自动跑 / 挂机 / 连续消化 / 开启自动模式」→ 加载 skill `task-loop`。循环运行期间本工作区归它独占：不要手工 commit / 切分支；要并行干活用别的 worktree。

## 边界

- 一次只做一个任务，做完就停。
- 不自己发明需求；池空了就说空了。
- 不 `git push`；不 `git reset --hard`；不 `git stash`。
- P0 可打断进行中任务，但先把当前任务落到可提交的中间态并在 current 记断点。
