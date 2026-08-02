# 01_FEATURE_MATRIX — 能力矩阵（25 项）

> 本表冻结的是 Phase 0C 初始差距基线，不代表当前实现状态。当前实现与剩余缺口以 `docs/evidence-matrix.md` 和 `docs/rebuild/CURRENT_STATE.md` 为准。

> 状态：`已有` / `部分具备` / `缺失` / `本轮排除`
> 策略：`保留` / `改造` / `重写` / `仅参考` / `排除`
> 优先级：`S` / `A` / `B` / `C`

| # | 能力 | 工作仓库现状 | 目标证据或契约 | 状态 | 策略 | 优先级 | 风险依赖 |
|---|---|---|---|---|---|---|---|
| 1 | 脚手架（monorepo 结构） | 前端 Vite + React 已有，后端目录缺失 | 前端保留；`backend/` 新建 | 部分具备 | 改造 | S | 无 |
| 2 | 路由（多角色 SPA） | 前端已有基础路由 | 护工 / 家属 / 机构三端路由（caregiver / family / institution） | 部分具备 | 改造 | A | #1 |
| 3 | Demo store | 前端 Mock 数据已有 | Mock + 完整模式双态 store | 部分具备 | 改造 | S | #1 |
| 4 | 领域模型 | 已有 `src/types.ts` | 服务端领域模型 + DB schema；前端类型改造复用 | 部分具备 | 改造 | A | #5,#6 |
| 5 | Express HTTP 服务 | 不存在 | `backend/` Express 服务 | 缺失 | 重写 | S | #1 |
| 6 | SQLite 持久化 | 不存在 | `backend/src/schema.sql` | 缺失 | 重写 | S | #5 |
| 7 | 六级规则引擎 | 已有前端六级结构和 R1–R9 | 服务端确定性规则 → status_level/risk_score/key_reasons/recommended_action | 部分具备 | 改造 | S | #5,#6 |
| 8 | 服务端权威 | 不存在 | 所有风险判定经规则引擎 | 缺失 | 重写 | S | #7 |
| 9 | 事件标准化（canonical event） | 已有 mock event type 基础 | 统一 canonical event schema | 部分具备 | 改造 | A | #5,#6 |
| 10 | 任务闭环 | 已有 demoStore 的任务 reducer 语义 | 事件→评估→任务→确认/关闭 | 部分具备 | 改造 | S | #7,#9 |
| 11 | 三端摘要（GLM-5.2） | 不存在 | caregiver / family / institution 三端自然语言摘要 | 缺失 | 重写 | S | #12,#13,#14 |
| 12 | QwenPaw Provider | 不存在 | `backend/src/agent/qwenpawProvider.js` — 模型无关 SSE 桥 | 缺失 | 重写 | S | #5 |
| 13 | GLM-5.2 适配 | 不存在 | Provider 桥模型无关；主要改 Agent 模型配置、Prompt、Schema 验证和 smoke test | 缺失 | 改造 | S | #12,#14 |
| 14 | JSON Schema + 验证 | 不存在 | `backend/src/schemas/agent_output.schema.json`、`backend/src/agent/agentOutputValidator.js`、`.agents/skills/agent-json-summary-validator/references/agent_output.schema.json` | 缺失 | 重写 | S | 无 |
| 15 | 安全 fallback | 不存在 | `docs/careband/fallback_matrix.md`；一次修复→显式 Mock；fallback trace 记录 requested_provider/actual_provider/fallback_used/failure_reason | 缺失 | 重写 | S | #14 |
| 16 | CSV 日聚合 | 不存在 | `backend/src/importers/csvImporter.js`、`backend/src/routes/import.js`、`backend/examples/daily_snapshots_sample.csv`、`src/lib/wearableImport.ts` | 缺失 | 重写 | A | #6 |
| 17 | Apple Health 导入 | 不存在 | `backend/src/importers/appleHealthXml.js`、`backend/scripts/deriveAppleHealthCsv.js`、`backend/scripts/previewAppleHealth.js`、`docs/privacy-apple-health.md` | 缺失 | 重写 | B | #16 |
| 18 | 记忆确认 | 不存在 | 用户确认 / 拒绝 Agent 建议 | 缺失 | 重写 | A | #10,#11 |
| 19 | 语音文字模拟 | 已有 `voice_symptom`、DemoControl 语音事件、风险和摘要基础 | 文字模拟替代真实 ASR/TTS；原始文字仅当前页面会话，持久化仅限长摘要、结构化 Signal、pending 记忆草稿 | 部分具备 | 改造 | A | #1 |
| 20 | 隐私授权 | 已有 `mockConsent` 与 `ConsentStatusCard` | 授权页 + 同意流程 | 部分具备 | 改造 | A | #1 |
| 21 | software_simulator | 已有 `DemoControlPage` 与 reducer 模拟基础 | 软件事件模拟器；软件模拟事件固定 `source="software_simulator"`，不复制 HardwareMode 名称或硬件来源 | 部分具备 | 改造 | A | #5,#9 |
| 22 | 契约 / 试点页 | 不存在 | 契约展示页 + 试点说明页 | 缺失 | 重写 | B | #1 |
| 23 | 测试 / CI 三轮 | 已有 6 个前端 Vitest 文件和 Pages workflow | 基础测试/CI（S）；最终三轮演示验证为 B 交付 | 部分具备 | 改造 | S | 全部 |
| 24 | Demo 证据文档 | 已有 `docs/data-dictionary.md`、`docs/demo-script.md`、`docs/event-flow.md`、`docs/risk-rules.md` | 截图 / 测试报告 / 构建日志 | 部分具备 | 改造 | B | #23 |
| 25 | 硬件排除 | N/A | firmware/ESP32/nRF/PlatformIO/HardwareMode/硬件适配器/LAN 上传/实体设备/ASR/TTS — 永久排除；保留 device-neutral canonical event API 契约 | 本轮排除 | 排除 | C | 无 |

---

## 备注

- **第 13 项**（GLM-5.2 适配）：状态 = `缺失`，策略 = `改造`，优先级 = `S`。Provider 桥模型无关，主要改 Agent 模型配置、Prompt、Schema 验证和 smoke test。依赖 QwenPaw Provider（#12）与 Schema（#14）。
- **第 15 项**（安全 fallback）：Agent 输出本体仍须通过 strict Schema，不得凭空增加 `source:"mock_fallback"`；fallback trace 须记录 `requested_provider=qwenpaw`、`actual_provider=mock`、`fallback_used=true`、`failure_reason`。
- **第 19 项**（语音文字模拟）：状态 = `部分具备`，策略 = `改造`，优先级 = `A`。已有 `voice_symptom`、DemoControl 语音事件、风险和摘要基础，不是完整文字聊天 UI。目标要求原始文字仅当前页面会话，持久化仅限长摘要、结构化 Signal、pending 记忆草稿。
- **第 21 项**（software_simulator）：软件模拟事件固定 `source="software_simulator"`，不复制 HardwareMode 名称或硬件来源。
- **第 23 项**（测试 / CI）：状态 = `部分具备`，策略 = `改造`，优先级 = `S`。已有 6 个前端 Vitest 文件和 Pages workflow。基础测试/CI 是 S；最终三轮演示验证是 B 交付。测试由 QwenPaw 按阶段合同编写，Deterministic Worker 独立运行，Codex 审查。
- **第 25 项**（硬件排除）：状态 = `本轮排除`，策略 = `排除`，优先级 = `C`。永久排除，但保留 device-neutral canonical event API 契约。
