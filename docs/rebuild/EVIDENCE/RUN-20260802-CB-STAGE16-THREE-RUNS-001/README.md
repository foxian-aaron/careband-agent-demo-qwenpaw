# Stage 16 three-run evidence

This directory contains sanitized, reproducible validation evidence. It does not contain a QwenPaw transcript, token, cookie, local username, raw health file, raw voice text, or precise location.

## What the harness proves

Each of three fresh in-memory SQLite runs starts the real Express app and exercises the implemented public APIs for:

1. TEST001 CSV preview, confirmation, history, and date-idempotent persistence.
2. E001 `software_simulator` SOS ingestion.
3. Server-owned `urgent` risk and open caregiver task creation.
4. Caregiver task transitions through acknowledged, in progress, and resolved.
5. Resolved-event closeout and a non-urgent recomputed risk.
6. Schema-valid caregiver, family, and institution summaries round-tripped through the dashboard read model.

## Honest Agent boundary

The harness calls the implemented Agent Service with `provider="mock"`. It records `requested_provider=mock`, `actual_provider=mock`, `fallback_used=false`, and `real_qwenpaw_called=false`. This is an explicit deterministic Mock validation, not a QwenPaw fallback and not evidence that GLM-5.2 ran successfully.

The harness inserts the validated Agent output and trace into its disposable in-memory database only to verify the existing dashboard persistence/read mapping. It does not add or claim a public Agent write endpoint.

Run with Node 22:

```text
npm run verify:three-runs
```

The tracked `three-runs.json` is one actual local execution. CI repeats the gate and prints a fresh sanitized result to its log without modifying the repository.
