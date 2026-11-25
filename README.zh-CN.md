# Memos

> [English](./README.md)

<img src="./web/public/logo.webp" alt="" width="96" align="right">

**你的想法，你的数据，由你做主。**

Memos 是你的笔记时间线，它属于你。用 Markdown 写作，几秒就能发布，并自由选择每条 memo 的可见范围：仅自己、受邀的人，或任何有链接的人。

**[用 Docker 运行](#快速开始)** · **[在线实例](https://memos.huanjue.me/)** · [阅读文档](https://usememos.com/docs)

[![GitHub stars](https://img.shields.io/github/stars/IV16SL/memos?style=flat-square&logo=github&label=Stars)](https://github.com/IV16SL/memos)
[![MIT license](https://img.shields.io/github/license/IV16SL/memos?style=flat-square)](LICENSE)

<img src="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/demo.png" alt="Memos 时间线：编辑器与最近的 memo" height="512" />

## 关于此 Fork

这是 [usememos/memos](https://github.com/usememos/memos) 的个人 Fork，为
[memos.huanjue.me](https://memos.huanjue.me/) 实例而维护，与上游没有隶属关系。它的改动已经多到
不再是"上游加几个小补丁"，开发方向是自己的。上游行为的 bug 与上游的功能需求请去上游提；
这里的 issue 应该只关于这个 Fork。

### 部署

生产环境跑在 **Vercel Serverless（Go）+ Supabase Postgres + Cloudflare R2** 上，而不是下面的
Docker 镜像。想跑这个 Fork，请从源码构建（`cd web && pnpm install && pnpm build`，然后
`go run ./cmd/memos`）。关于页会显示部署的 commit SHA；拿不到 VCS 元数据时，版本号回退到写死
的 `YY.MM`（见 `serverless/serverless.go`）。本 Fork 不打 release tag，也不发布 Docker 镜像。

### 与上游的不同

- **认证** — TOTP 两步验证，以及 Passkey（WebAuthn）登录、注册与开通。登录页把 SSO 和
  Passkey 并排显示，不再自动跳转到 SSO。
- **图表** — `mermaid` 代码块改用 Pele 渲染（替代 mermaid.js），`` ```plot `` 代码块用
  ECharts 渲染二维数学图形。
- **地图** — 位置搜索改用高德地图（Amap）替代 Leaflet，优先搜索附近地点。
- **数学** — KaTeX 保持在 0.16.x，启用 mhchem 以支持化学式。编辑器仍用经典的
  CodeMirror + react-markdown 组合，没有跟进上游的新编辑器。
- **编辑器** — 任务列表显示进度条，已完成的项加删除线。
- **品牌** — HuanMark 标志与关于页；仓库链接指向本 Fork。
- **Serverless** — 通知邮件同步发送，并按收件人语言本地化；503 时不再泄露初始化错误的细节。

### 上游同步

上游采用 cherry-pick 方式跟进，不直接合并：只拉取选定的修复（目前是 x/net 安全修复与评论模型
重构，评论即为带 parent 的 memo）。上一次与上游的完整 merge-base 是 2026-10-10。不要默认某个
上游新改动已经在这里，先跑 `git cherry main upstream/main` 确认。

## 为什么选择 Memos？

- **先写下来** — 不用选标题、不用建文件夹，就能保存一个想法。Memos 用 Markdown 写作，可以插入图片和文件。
- **以后找得到** — 搜索、按标签筛选，或按日期回顾时间线。重要的钉住，常用的筛选条件存为视图。
- **属于你** — 自行托管，[零遥测](https://usememos.com/features/data-ownership)、[MIT 开源协议](LICENSE)，所有 memo 都能完整导出。
- **想分享时再分享** — 新 memo 默认私密。想分享时再设为登录用户可见或公开。

## 快速开始

> 本 Fork 的生产实例跑在 Vercel Serverless 上（见[关于此 Fork](#关于此-fork)）；下面的镜像是
> 上游的构建，不是本 Fork 的。

用 Docker 运行 Memos：

```bash
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v ~/.memos:/var/opt/memos \
  neosmemo/memos:stable
```

其他安装方式见[部署指南](https://usememos.com/docs/deploy)。

## 获取帮助

发现本 Fork 的 bug？[提交 issue](https://github.com/IV16SL/memos/issues/new/choose)。上游行为与功能需求请见 [usememos/memos](https://github.com/usememos/memos)。
