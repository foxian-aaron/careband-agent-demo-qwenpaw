# CareBand 浏览器闭环验收记录

验收日期：2026-07-11

验收范围：本地软件主链路；不包含真实 QwenPaw 成功、实体 ESP32 或人工现场排练。

## 自动化三轮完整 UI 闭环

运行命令：

```powershell
npm run verify:browser
```

脚本 `scripts/verify-browser-demo-three-runs.mjs` 每轮都会重置 Demo、清理浏览器本地状态，并在真实浏览器中完成：

1. 从机构端进入 E001 陈伯。
2. 通过真实 `<input type=file>` 上传内存 CSV，确认 preview 不写库，再完成确认导入。
3. 同一 CSV 重导并核对日期集合不增加；最新快照固定为 `2026-07-10 / CSV Import / 91%`。
4. 从硬件页的软件模拟器提交规范化 SOS 事件。
5. 确认页面明确标记事件来源为 `mock`，不冒充实体 ESP32。
6. 确认规则引擎返回 `urgent`，并生成护工任务。
7. 等待 SOS 对应的 Agent 响应，使用项目统一 Schema 校验器验证 JSON 和规则风险锁。
8. 确认 meta 为 `mock / qwenpaw requested / fallback_valid`，且 `source_event_id` 对应本轮 SOS。
9. 护工依次接单、查看、确认晚药并解决任务。
10. 在护工、家属和机构页面核对同一个最终 `output_id`、各角色摘要和 `Mock fallback` 来源。

结果：3/3 通过，浏览器控制台与页面均无未处理错误。

| 轮次 | 用时 | 事件来源 | 风险 | 任务终态 | CSV 最新 | Agent |
| ---: | ---: | --- | --- | --- | --- | --- |
| 1 | 5298 ms | `mock` | `urgent` | `resolved` | `07-10 / CSV Import / 91%` | `mock / fallback_valid` |
| 2 | 2942 ms | `mock` | `urgent` | `resolved` | `07-10 / CSV Import / 91%` | `mock / fallback_valid` |
| 3 | 2862 ms | `mock` | `urgent` | `resolved` | `07-10 / CSV Import / 91%` | `mock / fallback_valid` |

为复现旧版 20 秒监听竞态，另对第一轮 Agent 响应人为延迟 21 秒；三轮仍以 25221 / 3028 / 3036 ms 通过，浏览器错误为 0。

## 已保存的展示证据

- 软件模拟主视频：2 分 13 秒、1920×1080、30 fps，可离线播放；当前无旁白音轨。
- 可编辑路演 PPT：9 页。
- 浏览器截图：8 张，覆盖机构端、CSV 导入、SOS、规则结果、三端摘要和任务闭环。
- 后端脚本另有三轮 API/SQLite 回归，覆盖 85% 质量、同日幂等重导、SOS→urgent、Mock Schema 校验和任务 resolved。

## 证据边界

- 本记录证明的是三轮本地软件 UI 闭环，不等同于主讲人三轮人工排练。
- 当前 Agent 标签应为 `Mock fallback`；阿里凭据失效时不得称为“真实 QwenPaw”。
- 当前 SOS 来自网页软件模拟器；没有 ESP32 与 COM 口时不得称为“实体按键已上传”。
- 实体 LED、震动、Wi-Fi 队列与三次连续按键仍须按硬件验收表实测。
