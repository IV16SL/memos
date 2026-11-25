# Memos

> [中文](./README.zh-CN.md)

<img src="./web/public/logo.webp" alt="" width="96" align="right">

**Your thoughts, your data, shared on your terms.**

Memos is a timeline for your notes, and it belongs to you. Write in Markdown, post in seconds, and choose who sees each memo: just you, the people you invite, or anyone with the link.

**[Run with Docker](#quick-start)** · **[Try the live instance](https://memos.huanjue.me/)** · [Read the docs](https://usememos.com/docs)

[![GitHub stars](https://img.shields.io/github/stars/IV16SL/memos?style=flat-square&logo=github&label=Stars)](https://github.com/IV16SL/memos)
[![MIT license](https://img.shields.io/github/license/IV16SL/memos?style=flat-square)](LICENSE)

<img src="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/demo.png" alt="The Memos timeline with a memo composer and recent memos" height="512" />

## About this fork

This is a personal fork of [usememos/memos](https://github.com/usememos/memos), maintained for the
[memos.huanjue.me](https://memos.huanjue.me/) instance. It is not affiliated with upstream, and it has
diverged enough that it is no longer "upstream plus a few tweaks" — the development direction is its
own. Bugs in upstream behavior and feature requests for upstream belong upstream; issues here should
be about this fork.

### Deployment

Production runs on **Vercel Serverless (Go) + Supabase Postgres + Cloudflare R2**, not the Docker
image below. To run this fork, build from source (`cd web && pnpm install && pnpm build`, then
`go run ./cmd/memos`). The About page shows the deployment commit SHA; when no VCS metadata is
available the version falls back to a hardcoded `YY.MM` (see `serverless/serverless.go`). This fork
cuts no release tags and publishes no Docker image.

### What is different from upstream

- **Auth** — TOTP two-factor authentication, and Passkey (WebAuthn) login, registration, and
  signup. The sign-in page shows SSO and passkey side by side instead of auto-redirecting to SSO.
- **Diagrams** — Pele replaces mermaid.js for `mermaid` code blocks, and ```` ```plot ```` code
  blocks render 2D math graphs with ECharts.
- **Maps** — Location search uses Amap instead of Leaflet, with nearby-first place search.
- **Math** — KaTeX stays on 0.16.x with mhchem enabled for chemical formulas. The editor still
  uses the classic CodeMirror + react-markdown stack; upstream's new editor was not adopted.
- **Editor** — Task lists show a progress bar and strike through completed items.
- **Branding** — HuanMark logo and About page; repository links point at this fork.
- **Serverless** — Notification emails are sent synchronously and localized by receiver locale;
  init errors no longer leak details on 503s.

### Upstream sync

Upstream is followed cherry-pick style, not by merging: only selected fixes are pulled in (the x/net
security fix and the comment-model rewrite, where a comment is a memo with a parent). The last full
merge base with upstream is 2026-10-10. Do not assume a recent upstream change is present here —
check `git cherry main upstream/main` first.

## Why Memos?

- **Write first** — Save a thought without choosing a title or folder. Memos are written in Markdown and can include images and files.
- **Find it later** — Search, filter by tag, or look back through any day on the timeline. Pin what matters and save the filters you reuse as views.
- **Yours to keep** — Self-host Memos with [zero telemetry](https://usememos.com/features/data-ownership), [MIT-licensed source](LICENSE), and a full export of your memos.
- **Share when you choose** — New memos are private. Make one visible to signed-in users or public when you want to share it.

## Quick Start

> This fork's production instance runs on Vercel Serverless (see
> [About this fork](#about-this-fork)). The image below is upstream's build, not this fork's.

Run Memos with Docker:

```bash
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v ~/.memos:/var/opt/memos \
  neosmemo/memos:stable
```

Other install options are in the [deployment guide](https://usememos.com/docs/deploy).

## Get Help

Found a bug in this fork? [Open an issue](https://github.com/IV16SL/memos/issues/new/choose). For upstream behavior and feature requests, see [usememos/memos](https://github.com/usememos/memos).
