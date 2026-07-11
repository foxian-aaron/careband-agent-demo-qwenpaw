# TEST001 Apple Watch Demo Script

Goal: demonstrate Apple Health / Apple Watch data import only.

1. Explain TEST001 is team member Apple Watch test data.
2. Explain it is not real elder data.
3. Preview the Apple Health XML locally:

```bash
cd backend
npm run preview:apple-health -- ../private_data/apple_health/export.xml
```

4. Derive daily aggregated CSV:

```bash
npm run derive:apple-health -- ../private_data/apple_health/export.xml
```

5. Import the derived CSV with the backend CSV endpoint.
6. v0.2 currently has no public static-preview URL. For full local backend mode, open:

```text
http://localhost:3001/#/elder/TEST001
```

7. Show:

- `data_source = Apple Health Export`
- `data_quality`
- latest snapshot date
- steps
- heart rate
- sleep duration
- baseline label

Do not use TEST001 as the main elder care-loop story. Use E001 for the scripted
caregiver task demo.

GitHub Pages is static only. It can show safe mock Apple Health sample data but
cannot run XML/CSV import endpoints.
