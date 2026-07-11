# 固件配置、烧录与串口验证

## 1. 准备本地配置

在 `firmware/careband_esp32_s3` 中复制：

```powershell
Copy-Item include/config_local.example.h include/config_local.h
```

只编辑被 `.gitignore` 忽略的 `config_local.h`：

- 演示 Wi-Fi SSID 与密码；
- 运行后端的局域网地址，例如 `http://192.168.x.x:8787/api/events`，不能填 `localhost`；
- 演示长者 `E001` 与原型设备编号；
- 按实际接线修改 GPIO 和有效电平。

不要把令牌、真实长者身份或生产地址写入固件。

## 2. 先跑原生状态机测试

```powershell
pio test -e native
```

应看到短按、长按、三连按、消抖和双击忽略五组测试通过。

## 3. 编译与烧录

```powershell
pio run -e esp32-s3-devkitc-1
pio run -e esp32-s3-devkitc-1 -t upload
pio device monitor -b 115200
```

若自动上传找错串口，可在本地命令中加 `--upload-port COMx`；不要把个人机器的 COM 口写死到仓库。

## 4. 识别逐行 JSON 日志

```json
{"kind":"event","event_id":"HW-careband-proto-001-a1b2c3d4-12345-1","device_id":"careband-proto-001","elder_id":"E001","event_type":"sos","button_pattern":"long_press","occurred_at_ms":12345,"queue_size":1}
{"kind":"state","device_id":"careband-proto-001","indicator":"urgent_red_blink","led":"red_blink","vibration":"triple","wifi":"connected","queue_size":1}
{"kind":"debug","message":"upload_ok","http_status":201,"latency_ms":180}
```

判断成功必须同时满足：事件日志的 `event_type` 是规范值、HTTP 状态为 2xx、网页任务出现并能完成闭环。只有 LED/震动不算上传成功。

## 5. 常见故障

| 现象 | 检查顺序 |
| --- | --- |
| 一直黄灯闪烁 | Wi-Fi 占位值是否已替换 → 电脑与设备是否同网 → 2.4 GHz 支持 |
| HTTP 状态小于 0 | 后端地址不能是 `localhost` → 防火墙/端口 → 后端是否监听局域网 |
| HTTP 4xx / 3xx | 固件记录 `upload_rejected_not_retried` 并移出该事件，避免阻塞后续 SOS；修正 URL/负载后必须重新触发 |
| HTTP 5xx 或状态小于等于 0 | 留在 RAM 队列并指数退避；先恢复后端、网络或防火墙 |
| 短按要等约 0.6 秒 | 这是区分单击与三连按的预期延迟 |
| 马达不动或板子复位 | 立即断电，检查驱动管、续流二极管、共地和电源能力 |
| 常亮紫灯 | 非紧急事件触及 7 条保留边界，或 8 条全为 SOS；日志明确本次未存储 |
| 紫灯闪烁 | HTTP 4xx/3xx 被明确拒绝且不重试；修复后重新执行该操作 |

RAM 队列第 8 个槽位专供 SOS。若 8 条队列中仍有非紧急事件，新 SOS 会淘汰最早的非紧急事件并记录 `oldest_non_urgent_evicted_for_sos`；被淘汰事件不会自动恢复。
