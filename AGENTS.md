# CareBand 软件版 v0.3 重构 — 根级治理规则

> 本文件是工作仓库（careband-agent-demo-qwenpaw）的最高优先级规则文件。
> 所有 Agent、CI 流程、人工审查必须遵守。冲突时本文件优先。

---

## 1. 权威边界

### 1.1 后端规则引擎独占

以下四个字段**仅由后端确定性规则引擎计算**，Agent（LLM）**不得独立决定或修改**，只能在输出中**原样复制**服务端规则锁定值：

| 字段 | 说明 |
|---|---|
| `status_level` | 风险等级（六级之一） |
| `risk_score` | 数值风险分 |
| `key_reasons` | 触发规则原因列表 |
| `recommended_action` | 建议动作 |

### 1.2 Agent 职责

- Agent **仅负责摘要生成**（自然语言概述）。
- 模型**固定为 GLM-5.2**，不得切换其他模型。
- Agent **不得做诊断、处方、医疗建议**。
- Agent 输出必须符合严格 JSON Schema（见 §3）。
- 三端摘要对象固定为 **caregiver / family / institution**；elder voice 是独立页面，不是第四个或替代摘要端。

---

## 2. 运行环境

| 项目 | 规则 |
|---|---|
| Node.js | 正式安装/构建/验证使用 `>=22.12.0 <23`（当前基线 22.23.1）或 `>=20.19.0 <21`；**禁止使用 Node 24** 进行正式验证 |
| 包管理器 | npm（随 Node 附带） |
| 数据库 | SQLite |
| 前端 | React（多角色 SPA） |

---

## 3. Schema 与 Fallback

### 3.1 严格 JSON Schema

- Agent 输出必须通过 `backend/src/agent/agentOutputValidator.js` 校验。
- Schema 定义：`backend/src/schemas/agent_output.schema.json`。
- Worker 验证 Skill 副本：`.agents/skills/agent-json-summary-validator/references/agent_output.schema.json`。

### 3.2 显式 Mock Fallback

- 校验失败后**允许一次自动修复重试**。
- 第二次仍失败 → **显式降级到 Mock 摘要**。
- Agent 输出本体仍须通过 strict JSON Schema；**不得**在严格 Agent 输出中凭空增加 `source:"mock_fallback"`。
- Fallback trace 必须明确记录 `requested_provider=qwenpaw`、`actual_provider=mock`、`fallback_used=true`、`failure_reason`。
- Fallback 矩阵：`docs/careband/fallback_matrix.md`。
- **禁止静默吞错**；所有 fallback 必须可观测、可追溯。

---

## 4. 参考仓库

- 参考仓库**只读**，用于对照设计、字段名、数据结构。
- **禁止整仓复制**参考仓库代码到工作仓库。
- 引用时在文档中注明出处，逐段对照、按需重写。

---

## 5. 运行模式与事件来源

| 模式 | 说明 |
|---|---|
| 静态 Pages 模式 | 仅使用 Mock 数据，不连接后端；用于演示截图与静态托管 |
| 本地完整模式 | Express + SQLite + Agent SSE 完整链路，本地运行 |

- `source="software_simulator"` 仅对**软件事件模拟器产生的事件**强制。
- 其他合法来源（voice / manual / import 等）经 device-neutral canonical event contract 标准化后亦可进入系统。
- **禁止**伪装成 ESP32、Apple Watch 或真实硬件来源。
- 软件模拟器事件必须可配置、可重放、可溯源。
- **禁止**引入真实硬件数据流。

---

## 6. 隐私与数据安全

以下内容按本表规则限制持久化、传输与输出；文字模拟原始表达仅允许在当前页面会话临时显示：

| 类别 | 规则 |
|---|---|
| 密钥 / 凭据 / `.env` | 禁止读取、写入、提交 |
| 原始语音录音 | **永久禁止保存**；语音以文字模拟替代 |
| 文字模拟的原始表达 | 仅存在于当前页面会话（**原始文字可在页面会话中出现，不禁止**）；**不进入** localStorage、SQLite、Agent 日志或 Git；持久化**只允许**限长摘要、结构化 Signal 与 pending 记忆草稿 |
| XML 原始数据 | 禁止直接入库或进入 Git/Agent；仅本机解析，经脱敏脚本处理后使用 |
| 精确位置（GPS 坐标） | 禁止；仅保留区域级粒度 |
| 真实健康数据 / 原始时间序列 | 禁止；仅用 Mock / 合成数据；日聚合 `DailySnapshot` 可用于规则和 Agent 输入 |
| Token / 密钥 | 禁止持久化或提交 |
| 医疗诊断 / 处方 | 禁止生成 |

---

## 7. 硬件排除（永久）

以下在本软件版本中**永久排除**，不实现、不规划：

> firmware / ESP32 / nRF / PlatformIO / HardwareMode / 硬件适配器 / LAN 上传 / 实体设备 / ASR / TTS / 真实传感器 / 真实试点

**例外**：保留一条与设备无关的 canonical event API 契约，供软件模拟器和未来可能的数据源共用。此契约不绑定任何特定硬件。

---

## 8. 角色与权限

| 角色 | 权限 | 限制 |
|---|---|---|
| **QwenPaw Builder** | 唯一产品/控制器文件与代码作者；只运行阶段合同允许的命令 | 不得越权；受本文件规则约束 |
| **Deterministic Worker** | 独立运行测试、构建、范围/Secret/Hardware 扫描及 Git/GitHub 确定性操作 | 不写产品代码；不独立做产品决策 |
| **Codex**（审查者） | 规划与审查；通常只读 | 仅用户明确授权的紧急干预才可修复，且必须在阶段记录中逐项登记 |
| **ChatGPT**（用户主交互） | 阶段管理、提示词与产品解释 | 不写代码；不执行 Git |
| **用户**（决策者） | 批准、否决、方向决策 | — |

### 8.1 门禁规则

- **Commit / Push / Draft PR 前**：`S = 0` 且 `A = 0`（S 类和 A 类问题必须全部清零）。
- Codex **禁止自动 Merge**；Merge 必须由用户确认。
- 任何 Codex 干预（创建/删除/修改文件）必须在 `BUILD_LOG.md` 或 PR 描述中记录。

---

## 9. 纪律

- 先读后写；改动只触碰必要文件。
- 文档用中文，路径/字段/命令保留英文。
- 不创建 TODO / 临时 / 日志文件；除非未来阶段合同逐字列出准确路径，否则禁止 scratch/TODO 文件。
- 每阶段结束后输出证据（测试结果、构建日志、截图引用）。
