# ESP32 按钮事件契约

设备只调用本地 `POST /api/events`，不把风险等级上传给服务器。风险由服务端规则引擎计算，Agent 只能解释和分发。

## 长按 SOS

```json
{
  "event_id": "HW-careband-proto-001-a1b2c3d4-12345-1",
  "elder_id": "E001",
  "event_type": "sos",
  "source": "esp32",
  "severity_hint": "urgent",
  "data_quality": "high",
  "occurred_at": "2026-07-11T08:00:00Z",
  "payload": {
    "action": "triggered",
    "button_pattern": "long_press",
    "device_id": "careband-proto-001",
    "device_uptime_ms": 12345,
    "retry_storage": "ram_only"
  }
}
```

若 NTP 尚未同步，固件省略 `occurred_at`，由服务器记录接收时间；不会伪造 1970 年时间。短按只把 `event_type` 改为 `medication`、`severity_hint` 改为 `watch`，并使用 `action=confirmed`、`button_pattern=short_press`。

`event_id` 由设备编号、每次启动生成的随机 `boot_nonce`、设备运行毫秒和本次启动内序号组成。HTTP 重试复用同一 ID 实现幂等；设备重启会生成新 nonce，避免把新的 SOS 误认成重启前的旧事件。

旧名 `sos_long_press` 仅用于历史入口兼容，固件不得发送或存储该旧名。
