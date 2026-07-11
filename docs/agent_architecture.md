# CareBand v0.2 Agent Architecture

## Rule-first chain

```text
Wearable / CSV / hardware event
→ DailySnapshot or normalized event
→ SQLite and seven-day baseline
→ deterministic risk engine
→ validated Agent JSON
→ caregiver / family / institution views
→ task lifecycle and linked-event resolution
```

The six locked states are:

`data_insufficient | stable | observation | attention | high_risk | urgent`

The rule engine owns state, score, evidence and action. SOS is always `urgent`; high-confidence fall is `urgent`; dizziness with the latest unconfirmed medication signal is `high_risk`; low-quality or low-wear data is `data_insufficient` unless a direct emergency exists.

## Server-owned Agent context

The manual regenerate endpoint accepts:

```json
{
  "elder_id": "E001",
  "source_event_id": "optional-event-id"
}
```

The backend reloads the elder, aggregated snapshot, baseline and active events, then runs rules. It does not accept client-supplied Agent snapshots, events or risk results.

Physical `esp32` and `nrf` events do not depend on a browser follow-up: after `POST /api/events` persists the event, risk and task, the backend queues the same server-owned Agent orchestration. Dashboard responses suppress a stored output when its risk lock no longer matches the current deterministic result.

## Providers and validation

- `qwenpaw`: local QwenPaw `/api/agent/process` + SSE + `X-Agent-Id`.
- `openai`: explicit opt-in Provider only.
- `mock`: deterministic Provider and labelled fallback.

Every response must be JSON-only and match the project Agent Schema. It is rejected when it changes the rule result, lacks evidence or the fixed disclaimer, or contains diagnosis/prescription language. One repair attempt is allowed; the second failure becomes visible Mock fallback.

## Privacy boundary

- Only daily aggregates reach the Agent; raw Apple XML and raw heart-rate series never do.
- Voice events store a bounded transcript summary, not raw audio/transcript payloads.
- Location events accept only server-known coarse zone labels and safe-zone status; coordinates, precise addresses and address-like client zone text are removed before SQLite insertion and during legacy migration.
- Agent logs retain a bounded response excerpt and redact credential-like errors.

## Current proof boundary

The QwenPaw provider, SSE parser, retry, Schema enforcement and fallback are implemented and covered by local fake-service tests. The current Alibaba credentials return 401, so current browser/video evidence is explicitly Mock fallback. Real success requires a new credential and a database run with `provider=qwenpaw`, `fallback_used=0`, and `validation_status=valid`.
