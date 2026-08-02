# 02_ARCHITECTURE_DECISIONS — 架构决策记录

> 本文件记录软件版 v0.3 重构中**已接受**的架构决策、理由与后果。
> 决策状态均为 **Accepted**。
> **注意**：此处记录的是设计决定，不代表对应代码已实现。

---

## ADR-01：运行时选择 Node 22.12+（或 20.19.x）

- **决定**：Node.js 22.12+ 或 20.19.x 作为唯一正式运行时。
- **理由**：长期支持、fetch 原生支持、稳定性充分验证。
- **后果**：禁止 Node 24 用于正式验证；CI 必须锁定 Node 22.x。Phase 5 实测使用 Node v22.23.1 / npm 10.9.8。

---

## ADR-02：Express + SQLite 单进程后端

- **决定**：后端用 Express + SQLite，单进程部署。
- **理由**：轻量、零外部依赖（无独立 DB 服务）、本地完整模式可一键启动。
- **后果**：不适合高并发生产环境，但满足本地 Demo 验证需求。数据库 schema 已实现于 `backend/src/schema.sql`。

---

## ADR-03：服务端规则引擎权威

- **决定**：`status_level`、`risk_score`、`key_reasons`、`recommended_action` 四个字段**仅由服务端确定性规则引擎计算**。
- **理由**：可审计、可复现、可单元测试；消除 LLM 随机性带来的风险判定漂移。
- **后果**：Agent（LLM）不参与风险判定，仅生成摘要。六级规则引擎已实现于 `backend/src/rules/riskEngine.js`。

---

## ADR-04：Canonical Event 标准化

- **决定**：所有事件进入系统前必须映射到统一的 canonical event schema。
- **理由**：前端、后端、Agent、模拟器使用同一种事件表示，减少转换层与不一致。
- **后果**：canonical event 已在 `backend/src/eventContract.js` 定义并由事件入口强制校验。

---

## ADR-05：固定 GLM-5.2 + 模型无关 SSE 桥

- **决定**：Agent 摘要固定使用 GLM-5.2；通过 `qwenpawProvider.js` 建立模型无关 SSE 桥。传输桥在技术上**模型无关**，但**本项目当前运行时模型固定为 GLM-5.2**；任何未来模型切换**必须新建一条架构决策记录**，不得自动切换或静默切换。
- **理由**：固定模型保证可复现性；SSE 桥隔离模型差异，保留未来切换能力（但切换须经显式决策，不得静默发生）。
- **后果**：Provider 与 Agent Service 已按 GLM-5.2 合同实现；公共事件到 Agent 的自动编排仍是候选版缺口。

---

## ADR-06：严格 JSON Schema + 显式 Fallback

- **决定**：Agent 输出必须通过 JSON Schema 校验；失败允许一次修复重试，再次失败则显式降级 Mock。
- **理由**：下游消费者依赖结构化字段；静默吞错不可接受。
- **后果**：`agentOutputValidator.js` 与 `agent_output.schema.json` 已实现；fallback 矩阵记录在 `docs/fallback-matrix.md`。

---

## ADR-07：隐私最小化

- **决定**：禁止密钥、原始语音、XML 原始数据、精确位置、真实健康数据进入仓库或任何输出。
- **理由**：合规、安全、最小暴露面。
- **后果**：语音以文字模拟替代；位置仅区域级；Apple Health 数据经脱敏脚本处理；`.env` 永不提交。

---

## ADR-08：双运行模式

- **决定**：提供"静态 Pages 模式"（仅 Mock）与"本地完整模式"（Express + SQLite + SSE）。
- **理由**：静态模式便于演示截图与静态托管；完整模式验证真实链路。
- **后果**：前端 store 需支持双态切换；Demo store 需 Mock + 完整模式数据源。

---

## ADR-09：双仓库隔离

- **决定**：参考仓库（careband 参考实现）只读，工作仓库（careband-agent-demo-qwenpaw）独立。
- **理由**：防止参考代码污染；按需逐段对照重写，保留独立演进能力。
- **后果**：禁止整仓复制参考仓库；引用须注明出处。

---

## ADR-10：硬件永久排除

- **决定**：firmware / ESP32 / nRF / PlatformIO / HardwareMode / 硬件适配器 / LAN 上传 / 实体设备 / ASR / TTS / 真实传感器在本软件版本中永久排除。
- **理由**：软件版聚焦规则引擎、Agent 摘要与任务闭环的验证，不涉及硬件链路。
- **后果**：不实现硬件链路、不预留硬件接口；但**保留一条与设备无关的 canonical event API 契约**，供软件模拟器和未来可能的数据源共用。软件模拟器产生的事件固定 `source="software_simulator"`；其他合法来源（voice / manual / import 等）经 canonical event 标准化后亦可进入系统，但禁止伪装成 ESP32、Apple Watch 或真实硬件来源。

---

## 决策状态汇总

| ADR | 标题 | 状态 |
|---|---|---|
| 01 | Node 22.12+ / 20.19.x | Accepted |
| 02 | Express + SQLite | Accepted |
| 03 | 服务端规则引擎权威 | Accepted |
| 04 | Canonical Event | Accepted |
| 05 | GLM-5.2 + 模型无关 SSE 桥 | Accepted |
| 06 | 严格 Schema + 显式 Fallback | Accepted |
| 07 | 隐私最小化 | Accepted |
| 08 | 双运行模式 | Accepted |
| 09 | 双仓库隔离 | Accepted |
| 10 | 硬件永久排除 | Accepted |
