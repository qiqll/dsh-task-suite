# 介绍页与社交卡片

- `index.html`：中文落地页，可直接打开，也可由 GitHub Pages 发布。
- `og.html` / `og.png`：1200×630 社交链接预览图；`og@2x.png` 为 2400×1260 高清版。
- 页面图片已复制到 `assets/`，全部相对路径，无需构建；GitHub Pages 只上传本目录也能完整显示。

## 本地预览

```sh
open docs/landing/index.html
# 或起一个静态服务
python3 -m http.server 8765 --directory docs/landing
```

## 发布

介绍页发布在 `gh-pages` 分支（GitHub Pages 项目的 branch source），地址：

```text
https://qiqll.github.io/dsh-task-suite/
```

`main` 分支只保存源文件；更新 `docs/landing/` 后，把内容同步到 `gh-pages` 再推送即可。不要用 GitHub Actions 的 `deploy-pages` 和 branch source 混用。

## 改文案

先改 `docs/launch/positioning.md`，再同步本页、README 和 `docs/marketplace-entry.md`。不要在四个地方各写一套定位。
