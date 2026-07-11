# CareBand ESP32-S3 v0.2 原型固件

这是比赛用、非医疗用途的单按钮原型，目标板为 ESP32-S3 DevKitC-1。它不测量心率、血氧或血压，只把按钮交互转换为 CareBand 规范事件：

| 手势 | 规范事件 | payload |
| --- | --- | --- |
| 短按一次 | `medication` | `action=confirmed`, `button_pattern=short_press` |
| 长按 1.5 秒 | `sos` | `action=triggered`, `button_pattern=long_press` |
| 0.6 秒窗口内三连按 | `sos` | `action=triggered`, `button_pattern=triple_click` |
| 双击 | 不上传 | 串口记录 `double_click_ignored`，避免误操作 |

事件上传到 `POST /api/events`。网络错误或 HTTP 5xx 会保存在最多 8 条的 RAM 队列中并指数退避；HTTP 4xx/3xx 会明确记录为拒绝并移出队列，不会阻塞后续 SOS。队列始终为 SOS 预留 1 个槽位；满队列收到 SOS 时会淘汰最早的非紧急事件，只有 8 条全是 SOS 时才拒绝第 9 条。设备断电后队列会丢失，这是 v0.2 的明确限制。

## 配置

1. 复制 `include/config_local.example.h` 为 `include/config_local.h`。
2. 在本地文件中填写演示 Wi-Fi、后端地址、设备/长者编号和实际针脚。
3. 不要把 `config_local.h` 加入 Git；目录内 `.gitignore` 已忽略它。

未创建本地配置时仍可编译，但会使用不可连接的占位值，不能用于现场演示。

## 编译与测试

```powershell
pio test -e native
pio run -e esp32-s3-devkitc-1
pio run -e esp32-s3-devkitc-1 -t upload
pio device monitor -b 115200
```

串口只输出逐行 JSON：`kind=event` 表示产生了规范事件，`kind=state` 明确包含 `led`、`vibration`、`wifi` 和 `queue_size`，`kind=debug` 表示上传结果、不可重试拒绝或可恢复错误。日志不会输出 Wi-Fi 密码或密钥。

## 指示状态

| 状态 | LED | 震动 |
| --- | --- | --- |
| 启动 | 蓝色 | 无 |
| Wi-Fi 未连接 | 黄灯闪烁 | 无 |
| 待机 | 绿色 | 无 |
| 上传中 | 黄色 | 无 |
| SOS 已排队 | 红灯闪烁 | 三次 |
| 上传成功 | 青绿色短闪 | 两次 |
| HTTP 4xx/3xx 被拒绝 | 紫灯闪烁 2 秒 | 四次；该事件不会重试或伪装成功 |
| 非紧急保留槽 / 全 SOS 队列已满 | 紫色 | 四次；日志明确未存储 |

完整接线、安全限制和实物验收见 `docs/careband/hardware/`。
