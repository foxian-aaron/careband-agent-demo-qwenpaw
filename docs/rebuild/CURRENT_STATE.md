# CURRENT_STATE

截至 2026-08-02，本地候选包含 Stage 1–19：Express/SQLite、规则权威、事件任务闭环、前后端同步、QwenPaw Provider、Agent 验证/fallback、公共 Agent API、CSV/Apple Health、记忆、语音、授权、软件模拟器、契约/试点页、CI 三轮证据，以及 Stage 18 运行时 Agent 闭环与 Stage 19 收尾/依赖升级。

- Stage 18 运行时 Agent 闭环已正式闭环；PR #29–#36 已合并至远程。
- Stage 19 升级前端构建工具链：Vite `8.2.0`、Vitest `4.1.10`、`@vitejs/plugin-react` `5.2.0`；`tsconfig.json` 单字段兼容修复 `moduleResolution: Bundler`。
- 正式 Node：`>=22.12.0 <23`；Stage 19 已由 Codex 使用真实 Node `v22.23.1` 与锁文件独立正式复核通过——repository boundary 184 files、verification 4/4、前端 19 files / 207 tests（Vitest 4.1.10）、后端 219、three-run 3/3（仍为 explicit_mock_not_fallback）、Vite 8.2.0 build（85 modules）、根与 backend `npm audit` 均 0、`git diff --check` 全部 PASS。
- Stage 19 实测：前端 207/207、后端 219/219、verification guards 4/4、repository boundary scanner 通过、three-run 3/3、TypeScript/build 通过；根与 backend `npm audit --audit-level=high` 均 0 漏洞。

Stage 16 / Stage 19 的三轮仍是显式 Mock，不能冒充真实模型成功；真实 GLM-5.2 仍只有 Stage 18 的单次 smoke。GitHub Pages 已启用 GitHub Actions 发布模式，静态 Mock 预览首次部署 run `30731249957` 已通过；当前没有软件版 v0.3 封版阻塞项。

永久排除：firmware、ESP32、nRF、PlatformIO、HardwareMode、LAN/真实设备、ASR/TTS、真实长者资料、精确位置、医疗诊断。
