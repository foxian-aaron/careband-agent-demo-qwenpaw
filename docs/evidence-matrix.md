# 能力与证据矩阵

| 能力 | 当前证据 | 状态/边界 |
|---|---|---|
| Express + SQLite | backend tests、schema.sql | 完成，loopback-only |
| 六级规则/服务端权威 | risk/event/task tests | 完成 |
| 多角色同步 | frontend/backend tests | 完成，断线显式 Mock |
| QwenPaw GLM-5.2 Provider | Provider tests、Stage18 real smoke、QwenPaw Chat ID | 真实一次通过；fallback 仍有自动测试 |
| Schema/修复/fallback | agent validation tests | 完成 |
| CSV/Apple Health | import/parser tests、Stage16 三轮 | 完成，TEST001/本地聚合 |
| 记忆/语音/授权 | frontend tests | 完成 Mock 体验与隐私门槛 |
| 软件模拟器 | frontend tests + event API | 完成，software_simulator |
| Contract/Pilot | route/component tests | 完成；Pilot 是计划 |
| CI/三轮 | Stage16 manifest/JSON | 3/3；Agent 为显式 Mock |
| 公共事件→真实 Agent | `POST /api/agent/analyze`、frontend/backend tests、real smoke | 已闭合为事件成功后显式 Agent 步骤；模型失败不回滚业务 |
| 硬件/ASR/TTS | 无 | 永久排除 |

Stage 16 证据：`docs/rebuild/EVIDENCE/RUN-20260802-CB-STAGE16-THREE-RUNS-001/`。Stage 18 真实 smoke Chat ID：`f86d8f91-f13a-4783-a757-6f65a37badd7`。历史 README、旧截图和参考仓库数字不是本轮实测。
