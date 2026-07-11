# CareBand v0.2 Risk Rules

## Division of Responsibility

- The deterministic rule engine decides `status_level`, `risk_score`, reasons, and recommended action.
- The LLM only summarizes and dispatches the already-decided result.
- Every Agent output must include the fixed `safety_disclaimer` and human-verifiable `key_reasons`.
- Disease diagnosis and medication dosage recommendations are forbidden.
- Only unresolved events inside the backend's active time window participate in risk evaluation.

## Risk Levels

- `data_insufficient`: no usable snapshot, `data_quality < 40`, or wear time below 6 hours, unless a direct emergency event exists.
- `stable`: no current signal needs action.
- `observation`: one mild deviation, an isolated strong activity/sleep deviation, an unconfirmed medication signal, or a low-confidence fall signal.
- `attention`: a symptom report, combined activity and sleep decline, or multiple mild deviations.
- `high_risk`: dizziness together with the latest unconfirmed medication signal, or a medium-confidence fall signal.
- `urgent`: any unresolved normalized SOS event or a fall event with confidence at least 0.8.

## Locked Rule Order

1. Any active `sos` event returns `urgent`, even when no snapshot exists. A client severity hint cannot downgrade it.
2. A fall confidence of at least 0.8 returns `urgent`; at least 0.5 returns `high_risk`; lower confidence is `observation` pending human verification.
3. If no direct emergency exists, missing snapshot, `data_quality < 40`, or `wear_time_hours < 6` returns `data_insufficient`.
4. Dizziness plus the latest unconfirmed medication signal returns `high_risk`.
5. Steps below 50% of the seven-day baseline together with sleep below 75% returns `attention`.
6. A single strong step or sleep deviation returns `observation`.
7. One mild deviation returns `observation`; two or more mild deviations return `attention`. Resting-heart-rate comparison uses `resting_heart_rate`, not average heart rate.
8. Resolved, cancelled, dismissed, or stale events do not keep risk elevated.
9. Completing a task resolves all linked events so an old SOS cannot recreate the task.

The seven-day baseline excludes the current snapshot date and is computed independently for every elder.
