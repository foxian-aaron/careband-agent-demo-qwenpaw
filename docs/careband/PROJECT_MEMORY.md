# CareBand v0.2 Shared Project Memory

Last verified: 2026-07-11 (Asia/Shanghai)

This file is the durable handoff for future CareBand chats. Read it before work and update it only when implementation evidence or external state changes. It records a point-in-time snapshot; re-run relevant checks before making a newer claim.

## Canonical Workspace

- Repository: `careband-agent-demo-v0.2`
- Local branch: `codex/careband-real-demo`
- Verified implementation baseline before this memory was added: `470cc535208612ef4c4c667f207d69e1d7f713a7`
- Repository state before this memory-only change: clean
- GitHub publication policy: verify the remote directly. A source-branch push requires explicit user authorization and does not imply a pull request or public deployment.
- Verified remote state on 2026-07-11: `origin/codex/careband-real-demo` exists and tracks the local branch. No pull request or v0.2 public deployment was created.
- `careband-agent-demo-v02` is UI reference only and must not be merged wholesale.

## Product Invariants

- CareBand provides care-risk signals and follow-up suggestions, not medical diagnoses.
- The rule engine is the sole authority for `risk_level`; the LLM cannot raise, lower, or replace it.
- Agent output must pass the project JSON Schema and match the server-owned risk result.
- Secrets, raw Apple Health XML, precise location, and identifiable participant data must not be written to the repository.
- TEST001 is team-test Apple Watch aggregate evidence. Preserve it, label it `team_test`, and exclude it from institution operating counts and risk metrics.

## Implemented Local Software

### Risk, events, tasks, and persistence

- Six risk states are implemented: `data_insufficient | stable | observation | attention | high_risk | urgent`.
- Canonical events are `sos`, `fall`, `voice`, `medication`, `location`, `device_status`, and `manual_note`; legacy event names are normalized at ingress.
- The backend rebuilds elder context and calculates risk instead of trusting a client-supplied risk result.
- Core behaviors include SOS to urgent, dizziness plus unconfirmed evening medication to high risk, wear time below six hours to data insufficient, fall-confidence handling, and correct resting-heart-rate use.
- Any active fall signal remains actionable without a wearable snapshot: medium confidence is `high_risk`, low confidence is `observation`, and confidence at least 0.8 is `urgent`.
- Only unresolved events inside the effective window influence risk.
- Resolving a task resolves its linked event so historical SOS/fall events do not permanently hold risk or recreate tasks.
- SQLite migrations cover event/task relationships, Agent runs, import history, and audits.
- Same-elder/same-date snapshots are idempotently replaced; seven-day baselines exclude the current date.

### Agent bridge

- `qwenpaw`, `openai`, and deterministic `mock` providers share one interface.
- A requested real provider falls directly to visible Mock fallback on failure; it does not silently spend against another paid provider.
- Agent JSON is validated with the project Schema, fixed disclaimer, non-empty evidence, non-diagnostic wording, and exact risk consistency.
- `recommended_action` is rule-owned alongside status, score, and reasons. Common direct Chinese/English diagnosis and medication instructions are rejected, while quoted rule evidence and safe care observations remain usable.
- One validation repair attempt is supported before fallback.
- Agent runs record requested and actual provider, model, latency, validation result, failure reason, aggregate input, and a length-limited raw response; secrets and raw health exports are excluded.
- Caregiver, family, and institution views consume the same validated Agent result and show provider, latency, validation, and fallback provenance.

### Wearable ingestion and UI

- CSV preview, validation, confirmation, warnings, import history, and real backend persistence are implemented.
- API/SQLite data quality uses 0-100; frontend state uses 0-1 through one conversion boundary. A stored value of 85 displays as 85%.
- Missing values remain null; the UI does not invent resting heart rate, zero values, or fixed import timestamps.
- Dashboards show seven distinct snapshot dates, a baseline excluding the selected date, source, last synchronization, completeness, and quality.
- Demo controls, hardware simulation, and voice/event entry use the same normalized event path online and equivalent deterministic fallback semantics offline.
- The local-only `/api/demo/reset` resets E001-E004 demo state while preserving TEST001. It requires explicit local enablement and loopback access.
- Task patches reject unknown or empty input, bound handler text, and keep `completed_at` server-owned; non-terminal tasks cannot carry a forged completion time.
- Core text inputs have accessible names, and risk/status pill text meets WCAG AA contrast in the verified palette.

### Hardware software package

- An ESP32-S3 DevKitC-1 PlatformIO project implements long-press SOS, short-press confirmation, triple-press help, LED/vibration state, Wi-Fi HTTP upload, an in-memory retry queue, and line-delimited JSON serial logs.
- BOM, wiring, flashing, event-contract, and three-run acceptance documents are under `docs/careband/hardware/`.
- Local Wi-Fi, backend URL, and pin choices belong only in ignored `firmware/careband_esp32_s3/include/config_local.h`.

### Demo, privacy, and interview package

- Local startup, reset, fallback, architecture, three-minute runbook, shot list, rehearsal checklist, judge Q&A, editable pitch deck, and software-only demo video are present.
- Participant information, recording consent, withdrawal/deletion, invitation drafts, role-specific interview templates, and an anonymous insight structure are present.
- No fabricated interview findings are permitted.

## Verified Evidence at This Snapshot

- Frontend tests: 81/81 passed.
- Backend tests: 69/69 passed.
- PowerShell hardware-mode checks: 14/14 passed.
- Native firmware state-machine tests: 11/11 passed.
- ESP32-S3 PlatformIO build: passed (approximately 14.2% RAM and 26.8% flash).
- API/SQLite primary flow: passed three consecutive runs.
- Browser primary flow: passed three consecutive runs with zero browser errors.
- Each browser run used a fixed seven-date CSV ending 2026-07-10, displayed `CSV Import` and quality 91, created urgent SOS risk, resolved the linked task, showed valid Mock fallback, and kept all three role outputs consistent.
- Re-importing the same CSV did not create duplicate daily snapshots.
- Real `npm run dev` reset returned HTTP 200 and preserved TEST001.
- TypeScript and production Vite build passed.
- Agent Schema compilation passed, and the repository Schema matched the backend-bundled Schema.
- Secret and sensitive-path scans were clean.
- Three independent release reviews closed with 0 Critical and 0 Required findings after the safety, accessibility, task-audit, risk-order, and deployment-document fixes.
- Final pitch deck contains nine slides and passed template-fidelity and overflow checks. Its displayed backend count is the earlier 60/60 baseline; refresh that slide together with the user's remaining final media before the competition submission. Do not mutate PPTX XML directly.

## Not Yet Proven or Completed

### Live QwenPaw

- QwenPaw version checked: `1.1.11.post2`.
- The dedicated Agent is configured for `aliyun-codingplan/qwen3.6-plus`, with unrelated built-in tools, MCP tools, planning, and coding mode disabled.
- The latest evidenced live attempt returned HTTP 401: invalid or expired access token.
- Provider credential files had not changed after that failure at the last check, so no further paid call was made.
- Therefore the real QwenPaw three-role response is **not yet proven**. Only the provider implementation and Mock fallback are proven.

### Physical ESP32 loop

- No COM port, ESP32 USB device, or local `config_local.h` was present at the last check.
- Firmware compilation and simulator/native tests do not prove a physical button-to-backend loop.
- Physical flashing and three consecutive button acceptance runs remain incomplete.

### Real interviews and human media

- Existing interview and consent files are unfilled templates.
- No verified caregiver, family, or institution interview record exists.
- No signed/executed consent record, approved contact set, team-member information, human narration, or physical-prototype footage exists in the repository.
- Existing videos are software-only evidence and do not prove physical hardware operation.

## User Inputs Required to Resume

Resume in this order:

1. **QwenPaw credential:** The user runs `qwenpaw models config` and refreshes the Alibaba `aliyun-codingplan` token locally. Never ask them to paste the token into chat or Git. After the user says `阿里凭据已刷新`, verify the credential file changed, make one fictional E001 call, then run the real Agent flow three times if successful.
2. **Physical hardware:** The user connects an ESP32-S3 DevKitC-1 with a data-capable USB cable and components until Windows exposes `COMx`. Detect the port, have the user keep Wi-Fi credentials in ignored `config_local.h`, flash, inspect serial JSON, and run the physical acceptance sequence three times.
3. **Interviews:** The user supplies or contacts one caregiver, one care-experienced family member, and one institution/community contact and personally confirms invitation and recording consent. Store only anonymized findings.
4. **Final human video:** The user supplies approved team names/roles, narration or permission for generated narration, and physical prototype footage.

## Resume Checklist for a Future Chat

1. Read this file and `AGENTS.md`.
2. Run `git status --short --branch`; preserve user changes and do not assume the recorded commit is still current.
3. Recheck ports/processes before starting services. At the last snapshot, ports 8088, 3001, and 5173 were closed and no demo service was running.
4. Recheck only the external condition the user says changed. Do not make another paid model call unless the Alibaba credential has been refreshed.
5. Keep all validation data fictional or aggregated (`E001`/TEST001); never send real elder-identifying data to a model.
6. Do not push, open a pull request, deploy, buy hardware, or contact participants unless the user explicitly authorizes that action in the current conversation. Record any completed external action here after verifying it.
7. Update this memory with new evidence, including the date, exact test result, and remaining limitations.
