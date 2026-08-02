# CURRENT_STATE

截至 2026-08-02，本地候选包含 Stage 1–16：Express/SQLite、规则权威、事件任务闭环、前后端同步、QwenPaw Provider、Agent 验证/fallback、CSV/Apple Health、记忆、语音、授权、软件模拟器、契约/试点页和 CI 三轮证据。

- 当前候选：`qwenpaw/stage-17-demo-seal`，基于 `e5980f4`。
- 远程 `main` 仍到 Stage 10；Stage 11–16 为本地堆叠提交，GitHub 登录恢复前不 Push。
- 正式 Node：`>=22.12.0 <23`；本机验证 v22.23.1。
- 实测：前端 188/188、后端 214/214、verification guards 4/4、repository boundary scanner 扫描 180 个文件并通过、三轮 3/3、TypeScript/build 通过。

未闭合：公共事件 API 尚未自动调用 Agent Service 并持久化输出；真实 QwenPaw/GLM-5.2 需单独 smoke。Stage 16 是显式 Mock，不能冒充真实模型成功。

永久排除：firmware、ESP32、nRF、PlatformIO、HardwareMode、LAN/真实设备、ASR/TTS、真实长者资料、精确位置、医疗诊断。
