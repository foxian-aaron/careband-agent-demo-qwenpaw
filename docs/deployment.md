# CareBand Agent v0.2 Deployment

## Deployment Status

- Original static demo root:
  - `https://foxian-aaron.github.io/careband-agent-demo/#/institution`
- v0.2 has no current public Pages deployment. `codex/careband-real-demo` is a source branch and does not trigger the existing Pages workflow.

The app uses hash routing (`#/...`). If v0.2 is deliberately deployed later, configure and verify a real public base URL before sharing it.

## GitHub Pages Static Preview

GitHub Pages deploys static frontend files only.

It does not run:

- Express
- SQLite
- QwenPaw or OpenAI calls
- `/api/*` backend routes
- Apple Health XML or CSV import endpoints

Therefore any future public v0.2 preview must display a static preview banner and use frontend mock fallback data.

## Local Full Backend Mode

From the v0.2 repository root:

```bash
npm install
cd backend
npm install
cd ..
npm run build
cd backend
npm start
```

Open:

```text
http://localhost:3001/api/health
http://localhost:3001/#/elder/TEST001
```

Expected:

- `/api/health` returns JSON.
- `/#/elder/TEST001` loads the React app.
- The UI says `後端已連接：Express + SQLite`.
- TEST001 is labelled as team Apple Watch test data, not real elder data.
- Agent outputs include `本結果僅為照護風險提示，不構成醫療診斷。`

## Environment Variables

Backend:

```text
PORT=3001
BACKEND_HOST=127.0.0.1
SERVE_STATIC_FRONTEND=true
HARDWARE_MODE=false
DATABASE_PATH=data/careband.sqlite
CORS_ORIGIN=http://127.0.0.1:5173
AGENT_PROVIDER=qwenpaw
USE_MOCK_AGENT=false
QWENPAW_BASE_URL=http://127.0.0.1:8088
QWENPAW_AGENT_ID=careband_summary_agent
QWENPAW_MODEL_LABEL=qwen3.6-plus
QWENPAW_TIMEOUT_MS=5000
ALLOW_TEAM_TEST_REAL_AGENT=false
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
AGENT_TIMEOUT_MS=30000
APPLE_HEALTH_STEP_SOURCE_STRATEGY=prefer_watch
APPLE_HEALTH_XML_UPLOAD_MAX_MB=150
ALLOW_DEMO_RESET=false
```

Frontend:

```text
VITE_API_BASE_URL=
VITE_API_TIMEOUT_MS=8000
VITE_AGENT_TIMEOUT_MS=30000
```

For local Vite development, set:

```text
VITE_API_BASE_URL=http://localhost:3001
```

For single-origin production, leave `VITE_API_BASE_URL` unset so the frontend calls same-origin `/api/*`.

## Full Backend Public Deployment

The following host notes are an unverified future deployment draft; no v0.2 public backend is currently deployed. Use a Node-compatible host for the complete backend demo and perform a fresh security review before exposing it. Do not fake this on GitHub Pages.

Every public host must explicitly set:

```text
BACKEND_HOST=0.0.0.0
SERVE_STATIC_FRONTEND=true
CORS_ORIGIN=https://<verified-public-origin>
AGENT_PROVIDER=<openai|qwenpaw>
```

`AGENT_PROVIDER` never switches automatically because an API key exists. For `openai`, set `OPENAI_API_KEY` as a host secret. For `qwenpaw`, set `QWENPAW_BASE_URL` to a separately secured and reachable QwenPaw service and configure its credential outside Git. Never commit either credential.

### Render

- Root/build command:

```bash
npm install && cd backend && npm install && cd .. && npm run build
```

- Start command:

```bash
cd backend && npm start
```

- Env vars: the required public-host values above plus `PORT`, `OPENAI_MODEL`, `AGENT_TIMEOUT_MS`, and a persistent `DATABASE_PATH` when retention is needed.
- Privacy: do not upload raw Apple Health XML/ZIP to the repo.
- SQLite warning: use a persistent disk if the demo must retain imported snapshots.

### Railway

- Build command:

```bash
npm install && cd backend && npm install && cd .. && npm run build
```

- Start command:

```bash
cd backend && npm start
```

- Add the same explicit host, CORS, Provider, and secret variables as Render.
- Check Railway volume/persistence settings before relying on SQLite data.

### Fly.io

- Build with Node and run `backend/src/server.js` after frontend build.
- Attach a volume for `backend/data/` if SQLite data must persist.
- Verify `PORT` binding follows Fly's runtime port.

### Alibaba Cloud ECS

- Install Node.js 24 or another compatible Node version.
- Clone the repo, install frontend/backend dependencies, run `npm run build`, then run `cd backend && npm start`.
- Use a process manager such as systemd or pm2.
- Store `.env` on the server only, never in Git.
- Keep raw Apple Health files under an ignored/private directory and delete them after deriving daily CSV if not needed.

### Generic Node Host

Minimum commands:

```bash
npm install
cd backend
npm install
cd ..
npm run build
cd backend
npm start
```

Before starting, set `BACKEND_HOST=0.0.0.0`, a specific `CORS_ORIGIN`, and an explicit `AGENT_PROVIDER` as described above.

Verification:

```bash
curl <public-url>/api/health
```

Then open:

```text
<public-url>/#/elder/TEST001
```

Expected:

- backend connected label
- `data_source = Apple Health Export`
- `data_quality`
- Agent source badge
- medical disclaimer

## Apple Health Import Deployment Notes

Direct browser XML upload is for development or small files only. Real Apple Health `export.xml` can be very large.

Recommended real-data flow:

```bash
cd backend
npm run preview:apple-health -- ../private_data/apple_health/export.xml
npm run derive:apple-health -- ../private_data/apple_health/export.xml
```

Then import `private_data/derived/apple_watch_daily_snapshots.csv` with the CSV endpoint. GitHub Pages cannot run this import because it has no backend.

## Public Smoke Check

From the v0.2 root:

```bash
npm run check:public
```

By default this check verifies only the existing original root. To validate a future v0.2 deployment, set `CAREBAND_V02_PUBLIC_URL` to the deployed base URL; the command then checks its HTML and referenced JS/CSS assets. It does not replace manual browser QA.
