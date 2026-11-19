# 介绍页与社交卡片

- `index.html`：中文落地页，可直接打开，也可由 GitHub Pages 发布。
- `og.html` / `og.png`：1200×630 社交链接预览图（2x 渲染为 2400×1260）。
- 页面图片已复制到 `assets/`，全部相对路径，无需构建；GitHub Pages 只上传本目录也能完整显示。

## 本地预览

```sh
open docs/landing/index.html
# 或起一个静态服务
python3 -m http.server 8765 --directory docs/landing
```

## 发布

仓库内 `.github/workflows/pages.yml` 在 `main` 分支更新 `docs/landing/**` 时部署到 GitHub Pages：

```text
https://qiqll.github.io/dsh-task-suite/
```

首次运行若 Pages 尚未开启，workflow 里的 `actions/configure-pages` 会尝试启用；若权限不足，在仓库 **Settings → Pages** 选择 “GitHub Actions” 即可。

## 改文案

先改 `docs/launch/positioning.md`，再同步本页、README 和 `docs/marketplace-entry.md`。不要在四个地方各写一套定位。
