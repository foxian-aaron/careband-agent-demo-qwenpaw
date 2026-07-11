# 智護環 CareBand Agent Demo v0.2

## 2026-07-11 本地软件真实闭环

当前主链路已经锁定为：

```text
CSV / Apple Health 日聚合或 ESP32 事件
→ Express + SQLite 标准化
→ 规则引擎决定六级风险
→ QwenPaw / OpenAI / 确定性 Mock 生成同一次三端摘要
→ 护工、家属、机构页面同步
```

风险等级固定为 `data_insufficient | stable | observation | attention | high_risk | urgent`。LLM 无权改写规则结果，所有 Agent 输出都必须通过项目 JSON Schema、固定免责声明和非诊断/非处方措辞校验。

Windows 一键启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

脚本会检查本地 QwenPaw `127.0.0.1:8088`，必要时隐藏启动服务并等待就绪，然后启动后端和前端。真实 Provider 超时、离线或输出非法时，页面会明确显示 `Mock fallback`；不会暗中切换另一付费模型。若阿里凭据过期，请先通过 `qwenpaw models config` 刷新凭据，再运行：

```powershell
cd backend
npm run smoke:qwenpaw
```

默认启动把前端和后端都限制在 `127.0.0.1`。只有连接实体 ESP32 时才显式启用局域网硬件模式：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1 -HardwareMode
```

硬件模式仍让前端只监听 `127.0.0.1`，仅将后端绑定到 `0.0.0.0:3001`，并在终端打印 ESP32 可用的 `http://<电脑局域网IP>:3001/api/events` 候选地址。选择与开发板同一网段的地址填入被 Git 忽略的 `config_local.h`。该原型接口没有设备认证或 TLS，只能临时用于可信私有局域网；不要配置公网端口转发，Windows 防火墙提示时只允许专用网络。

本分支只用于本地比赛演示，不包含 GitHub push、PR、公网部署、真实长者数据、真实录音或医疗能力。

CareBand Agent v0.2 是學生 AI 競賽用的落地驗證 demo。核心流程不是單純健康看板，而是：

```text
wearable data -> DailySnapshot -> personal baseline -> riskEngine -> AI Agent summaries -> caregiver task -> family / institution visibility
```

本系統只做照護風險提示，不做醫療診斷。所有 Agent 輸出都必須保留：

```text
本結果僅為照護風險提示，不構成醫療診斷。
```

## Current Public Demo Status

- Original demo root path:
  - https://foxian-aaron.github.io/careband-agent-demo/#/institution
  - https://foxian-aaron.github.io/careband-agent-demo/#/elder/E001/profile
  - https://foxian-aaron.github.io/careband-agent-demo/#/medication/E001
- v0.2 static preview:
  - https://foxian-aaron.github.io/careband-agent-demo/v0.2/#/institution
  - https://foxian-aaron.github.io/careband-agent-demo/v0.2/#/elder/TEST001
  - https://foxian-aaron.github.io/careband-agent-demo/v0.2/#/elder/E001/profile
  - https://foxian-aaron.github.io/careband-agent-demo/v0.2/#/medication/E001

Important: GitHub Pages is static only. The `/v0.2/` public link uses mock fallback data and does not run Express, SQLite, OpenAI, or backend API routes. Full backend mode must be run locally or deployed to a Node-compatible host.

## Demo Personas

- `TEST001`: 團隊 Apple Watch 測試資料，非真實長者，用於驗證 Apple Health / Apple Watch 每日聚合資料導入。
- `E001` 陳伯：主照護閉環 demo，展示活動下降、頭暈、SOS、護工任務、Agent 摘要與三端同步。

Unknown elder routes intentionally do not fallback to E001. They show `資料未載入：找不到此長者資料。`

## Current Local Demo Surfaces

- `#/elder/E001/memory-intake`：只生成待人工确认的文字草稿，不直接改写正式档案或风险。
- `#/elder/E001/wearable-import`：真实调用本地 CSV preview / confirm / history API，按长者与日期幂等写入 SQLite。
- `#/hardware-simulator`：软件按钮真实 POST 到与 ESP32 相同的规范事件接口，并触发规则、Agent 与三端刷新。
- `#/backend-contract`：展示固定接口与类型边界。
- `#/privacy`：展示角色授权、区域级位置、语音摘要和撤回边界。
- `#/pilot-plan`：展示工作人员/志愿者先行的访谈与试点路径。

这些页面不代表实体硬件、生产穿戴平台、真实 ASR/TTS 或真实长者试戴已经完成。Agent 路径可以调用 QwenPaw；当前阿里凭据失效时会明确显示 Mock fallback。

## Quick Start

Install dependencies:

```bash
npm install
cd backend
npm install
cd ..
```

Run frontend and backend together:

```bash
npm run dev
```

Default URLs:

- Frontend: http://127.0.0.1:5173/
- Backend health: http://127.0.0.1:3001/api/health

If the machine does not have a global npm, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-demo.ps1
```

## Single-Port Production Smoke Test

```bash
npm run build
cd backend
npm start
```

Then open:

```text
http://localhost:3001/api/health
http://localhost:3001/#/elder/TEST001
```

In this mode, Express serves both `/api/*` and the built frontend from `dist/`.

## Apple Health Test Data

Recommended real-data flow for large Apple Health exports:

```bash
cd backend
npm run preview:apple-health -- ../private_data/apple_health/export.xml
npm run derive:apple-health -- ../private_data/apple_health/export.xml
```

The derived daily CSV is written to:

```text
private_data/derived/apple_watch_daily_snapshots.csv
```

Then import the derived CSV through the backend CSV endpoint. Direct XML upload is only for development or small files. GitHub Pages cannot import XML because it has no backend.

Privacy rules:

- Do not commit raw Apple Health exports.
- Do not commit `export.zip`, `export.xml`, `apple_health_export/`, `private_data/`, SQLite DB files, uploads, or `.env`.
- Do not send raw XML to OpenAI, QwenPaw, or any external LLM.
- Agent analysis receives only daily aggregated snapshots, risk results, and event summaries.
- `TEST001` must remain labelled as team Apple Watch test data, not real elderly user data.

## API Highlights

- `GET /api/health`
- `GET /api/elders`
- `GET /api/dashboard`
- `POST /api/snapshots`
- `POST /api/events`
- `POST /api/import/daily-snapshots-csv/preview`
- `POST /api/import/daily-snapshots-csv`
- `GET /api/import/daily-snapshots-csv/history`
- `POST /api/import/apple-health-xml/preview`
- `POST /api/import/apple-health-xml`
- `POST /api/agent/analyze`
- `PATCH /api/tasks/:id`
- `POST /api/demo/reset`（仅当 `ALLOW_DEMO_RESET=true` 且请求来自本机 loopback）

## Validation

```bash
cd backend
npm test
cd ..
npm test
npm run build
```

Current local validation for the real closed-loop branch:

- Backend tests: 60 passed
- Frontend tests: 81 passed
- Hardware-mode PowerShell tests: 14 passed
- TypeScript: passed
- Vite production build: passed
- Frontend and backend npm audits: 0 known vulnerabilities
- ESP32 native button, queue, HTTP and identity tests: 11 passed
- ESP32-S3 DevKitC-1 firmware build: passed
- Three consecutive API/SQLite demo runs and three consecutive browser UI runs: passed with labelled Mock fallback
- QwenPaw provider bridge and fake-SSE tests: passed; the live Alibaba call currently returns 401 and still requires a refreshed credential
- No public deployment or GitHub push is part of this branch

## Key Docs

- `.agents/README.md`
- `docs/public_demo_checklist.md`
- `docs/deployment.md`
- `docs/agent_architecture.md`
- `docs/privacy_apple_health.md`
- `docs/apple_health_import_report.md`
- `docs/demo_script_chenbo.md`
- `docs/demo_script_test001_apple_watch.md`
- `docs/pr_description.md`
- `docs/review_pr_checklist.md`
- `docs/careband/README.md`
- `docs/careband/demo_runbook.md`
- `docs/careband/hardware/acceptance.md`
- `docs/careband/browser_qa.md`
- `docs/careband/evidence/README.md`
- `deliverables/CareBand_v0.2_software_demo.mp4`
