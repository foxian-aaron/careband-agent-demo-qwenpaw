# CareBand v0.2 浏览器验收记录

日期：2026-07-11
环境：本地 Vite + Express/SQLite，Microsoft Edge（Playwright Core），桌面 1440×900 / 1600×900，移动端 390×844。

## 已通过

- 机构端、陈伯驾驶舱、CSV 导入、硬件模拟、护工端、家属端均无页面级横向溢出。
- CSV 使用正常点击完成“填入 7 天示例 → 只读预览 → 确认导入 → 导入历史”，`85` 始终显示为 `85%`。
- 软件按钮使用与 ESP32 相同的 `/api/events` 契约触发 SOS；服务器返回 `event_type=sos`、`risk=urgent` 和任务 ID。
- QwenPaw 凭据失效时，页面明确显示 `Mock fallback`、`fallback_valid`、模型与耗时，没有伪装成真实调用。
- 护工正常点击完成接单、已查看、晚药确认和任务完成；完成备注不会重新创建任务。
- 家属端显示“已跟进 / 持续观察”；机构端显示“当前未闭环高风险 0 / 今日曾高风险 1 / 已跟进高风险 1”。
- TEST001 团队测试资料不会进入护工运营队列，也不计入机构运营指标。
- 移动端 390×844 无横向溢出；首屏可见主导航、后端状态和机构端主标题/入口。
- 完整录制过程浏览器 console/page error 均为 0。

## 证据

- `deliverables/screenshots/01-institution-desktop.png`
- `deliverables/screenshots/02-elder-dashboard-desktop.png`
- `deliverables/screenshots/03-csv-import-history.png`
- `deliverables/screenshots/04-sos-urgent-dashboard.png`
- `deliverables/screenshots/05-agent-fallback-trace.png`
- `deliverables/screenshots/06-family-followed-up.png`
- `deliverables/screenshots/07-institution-followed-up.png`
- `deliverables/screenshots/08-institution-mobile.png`
- `deliverables/CareBand_v0.2_software_demo.mp4`（2:13，1080p，真实软件操作，无旁白）

## 边界

- 这份记录证明本地软件闭环与可见 fallback，不证明真实 QwenPaw 模型成功、实体 ESP32 联网或真实长者试戴。
- 录制使用虚构 E001 和团队测试聚合数据；没有原始 Apple Health XML、精确位置、真实联系人或密钥出现在画面中。
