# Apple Health / CSV Import Evidence

## Data boundary

- The test subject is `TEST001`, marked `subject_kind=team_test`; it is not real elder-care data.
- Raw Apple Health XML, Apple ID, raw heart-rate series, `.env`, SQLite and upload files are ignored and never sent to the Agent.
- Only per-day aggregates are stored as `DailySnapshot`.
- `TEST001` remains visible as technical evidence but is excluded from institution operating counts and the caregiver queue.

## Normalized fields

```text
elder_id, date, data_source,
heart_rate_avg, resting_heart_rate, steps, active_minutes,
sleep_duration, wear_time_hours, data_quality
```

`data_quality` is 0-100 in API/SQLite and converted once to 0-1 inside the frontend. Missing metrics remain `null`; the importer does not fabricate zeroes, resting heart rate or import timestamps.

Allowed current sources are `Apple Health Export` and `CSV Import`; demo seed/control sources are reserved for synthetic E001-E004 data. Other wearable platforms remain future integrations.

## Import behavior

- Preview is read-only.
- Confirm writes an `import_runs` audit record.
- The same elder/date is idempotently replaced, not duplicated.
- Apple Health snapshot IDs use `APPLE-<elder>-YYYY-MM-DD`.
- The latest dashboard trend contains seven distinct dates.
- The personal seven-day baseline excludes the current snapshot date.
- `data_quality < 40` or wear time below six hours produces `data_insufficient` unless an unresolved emergency event exists.

## Apple Health derivation

- Steps prefer Apple Watch over iPhone on the same day to avoid double counting.
- Sleep uses wake-date grouping, counts asleep categories only and merges overlaps.
- Large XML should use the local streaming preview/derive commands and then import the derived CSV.

```powershell
cd backend
npm run preview:apple-health -- ../private_data/apple_health/export.xml
npm run derive:apple-health -- ../private_data/apple_health/export.xml
```

## Proven demo checks

- Reimporting the same CSV does not add another daily row.
- A server quality value of 85 displays as 85%, not 1%, 8500% or a fabricated default.
- Import history, source, synchronization time, missing-value warnings and trend refresh are visible in the local UI.
- The software recording shows the real preview/confirm/history API path; it does not claim that TEST001 is an elder trial.
