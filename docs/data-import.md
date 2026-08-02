# 日聚合数据导入

本地完整模式在 `#/elder/TEST001/wearable-import` 提供 preview → confirm → history。CSV 必须 UTF-8、最多 64 KiB、最多 366 行；服务端把主体锁定为 TEST001。相同 `elder_id + date` 再次确认时覆盖。

- `POST /api/import/daily-snapshots-csv/preview`
- `POST /api/import/daily-snapshots-csv`
- `GET /api/import/daily-snapshots-csv/history?elder_id=TEST001&limit=20`

Apple Health XML 只在本机聚合：

```bash
cd backend
npm run preview:apple-health -- ../private_data/apple_health/export.xml --limit-days=14
npm run derive:apple-health -- ../private_data/apple_health/export.xml --limit-days=14
```

派生 CSV 再走同一导入流程。静态 Pages 不支持导入；详见 `docs/privacy-apple-health.md`。
