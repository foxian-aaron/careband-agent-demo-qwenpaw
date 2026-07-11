# CareBand v0.2 Minimal API Contract

Base path: `/api`. The server owns normalization, risk recomputation, task creation, and Agent context reconstruction.

## POST /api/events

Accepts one canonical event with `event_type` in:

`sos | fall | voice | medication | location | device_status | manual_note`

Legacy names such as `sos_long_press`, `voice_symptom`, and `medication_confirmed` are accepted only at this boundary and normalized before storage. The request must not provide or override a risk result.

Response:

```json
{
  "ok": true,
  "accepted": true,
  "event": {},
  "risk_result": {},
  "task": {},
  "risk_recomputed": true,
  "task_id": "task_001"
}
```

## POST /api/snapshots

Accepts one `DailySnapshot`. The server stores one idempotent record per elder and local calendar date; missing wearable metrics remain `null` and `data_quality` uses the 0-100 scale.

Response:

```json
{
  "ok": true,
  "snapshot": {}
}
```

## POST /api/agent/analyze

Request body contains only the elder reference and an optional source event reference:

```json
{
  "elder_id": "E001",
  "source_event_id": "evt_001"
}
```

The server reloads the elder, latest snapshot, seven-day baseline, and active events, then runs the deterministic rule engine before calling the configured Agent provider. Client-supplied snapshots, events, or risk results are rejected. `agent_result` must match `agent_output.schema.json`; provider/model/fallback/validation details are returned separately in `meta`.

## CSV import

- `POST /api/import/daily-snapshots-csv/preview` is read-only.
- `POST /api/import/daily-snapshots-csv` confirms an idempotent import and records import history.
- `GET /api/import/daily-snapshots-csv/history?elder_id=E001` returns import history.

## PATCH /api/tasks/:id

Allowed task statuses:

- `open`
- `acknowledged`
- `in_progress`
- `resolved`
- `cancelled`

Resolving or cancelling an allowed task also resolves its linked events. Urgent tasks cannot be cancelled.

## POST /api/demo/reset

Available only when `ALLOW_DEMO_RESET=true` and the request comes from loopback. It resets E001-E004 demo events, tasks, and Agent results while preserving TEST001 team-test wearable aggregates.
