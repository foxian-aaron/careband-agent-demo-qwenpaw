# CURRENT_STATE

截至 2026-08-02，本地候选包含 Stage 1–18：Express/SQLite、规则权威、事件任务闭环、前后端同步、QwenPaw Provider、Agent 验证/fallback、公共 Agent API、CSV/Apple Health、记忆、语音、授权、软件模拟器、契约/试点页和 CI 三轮证据。

- 当前候选：`qwenpaw/stage-18-runtime-agent-closure`，基于 Stage 17 `aa47442`。
- 远程 `main` 仍到 Stage 10；Stage 11–16 为本地堆叠提交，GitHub 登录恢复前不 Push。
- 正式 Node：`>=22.12.0 <23`；本机验证 v22.23.1。
- Stage 18 实测：前端 207/207、后端 219/219、verification guards 4/4、repository boundary scanner 扫描 184 个文件并通过、TypeScript/build 通过；真实 QwenPaw/GLM-5.2 smoke 一次通过且未 fallback。

Stage 16 的三轮仍是显式 Mock，不能冒充真实模型成功；Stage 18 的真实 smoke 是独立单次运行证据。当前未完成项主要是依赖漏洞复核和 GitHub 登录恢复后的堆叠分支交付。

永久排除：firmware、ESP32、nRF、PlatformIO、HardwareMode、LAN/真实设备、ASR/TTS、真实长者资料、精确位置、医疗诊断。
