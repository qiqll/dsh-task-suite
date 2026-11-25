# 面板截图规范

目标是让读者在 README 第一屏看到“真实面板”，而不是示意图。

## 必需文件

| 文件 | 状态 | 内容 |
|---|---|---|
| `dashboard-overview.png` | 已有 | 真实面板：任务池、Agent、指标、事件流；1130×1505，已裁掉工作区路径 |
| `dashboard-running.png` | 已有 | 真实 T-009 运行中：当前任务、worker、指标、事件流；1128×1536，无本地路径 |
| `pipeline-overview.png` | 已有 | 流程示意：主 Agent 调度 → 后台 worker → 机器验收；2560×1120 |
| `dashboard-verify.png` | 待录 | 有 1 个「待验证」任务，显示验收通过/待确认 |
| `dashboard.gif` | 可选 | 60 秒演示，见 `docs/demo.md` |

仓库根目录的 [`screenshots.json`](../../screenshots.json) 是 dsh-market 详情页截图的唯一来源：路径相对该文件、指向本目录已有 PNG，1–8 张。市场展示顺序即数组顺序（当前为 `dashboard-overview` → `dashboard-running` → `pipeline-overview`）；增删截图时同步更新该文件。

## 录制要求

1. 使用独立演示工作区，不要用真实客户项目。
2. 任务标题用虚构示例，例如：
   - `给 /health 增加超时检查`
   - `补一个失败用例并修复`
   - `更新健康检查文档`
3. 面板中不要出现：
   - API Key、npm token、GitHub token
   - 真实公司名、客户名、内部域名
   - 个人绝对路径（如 `/Users/<name>/...`）
4. 浏览器窗口宽度至少 1280；推荐 1440。
5. 截图为 PNG，保留 Retina 2x；不要加厚重滤镜。
6. GIF 控制在 8 MB 内，帧率 12–15 fps，时长 45–60 秒。

## macOS 截图

```text
Cmd + Shift + 4 → 框选面板区域
```

或只截窗口：

```text
Cmd + Shift + 4 → 空格 → 点击 DSH 窗口
```

保存后移动到：

```text
docs/screenshots/dashboard-overview.png
```

## 演示状态怎么造

参考 [`docs/demo.md`](../demo.md) 的「三个必录状态」：

1. **空池**：只有任务池，没有进行中任务
2. **执行中**：`auto/current.json` 指向一个 running 任务，Agent 行有 worker
3. **待验证**：任务从「进行中」进入「待验证」，验收门禁显示通过

不要为了截图伪造“已完成”状态；面板只读，状态应由真实任务流产生。

## 检查

- [ ] 图片路径在 README 中可渲染
- [ ] GitHub 与 npm 页面都能显示
- [ ] 截图中没有敏感信息
- [ ] 图片小于 5 MB（GIF 小于 8 MB）
