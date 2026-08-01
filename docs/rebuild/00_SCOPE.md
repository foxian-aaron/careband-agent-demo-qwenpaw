# 00_SCOPE — 软件版 v0.3 范围定义

> 定义 careband-agent-demo-qwenpaw 软件版 v0.3 的**纳入范围**与**永久排除项**。

---

## 1. 纳入范围（In Scope）

### 前端

| 编号 | 能力 |
|---|---|
| F-1 | React 多角色 SPA（护工端 / 家属端 / 机构端（caregiver / family / institution）） |
| F-2 | 多角色路由与权限切换 |
| F-3 | Demo 数据 store（Mock + 完整模式双态） |
| F-4 | 静态 Pages 模式（仅 Mock，用于截图与静态托管） |

### 后端

| 编号 | 能力 |
|---|---|
| B-1 | Express HTTP 服务 |
| B-2 | SQLite 持久化（`backend/src/schema.sql`） |
| B-3 | 六级规则引擎（权威计算 `status_level` / `risk_score` / `key_reasons` / `recommended_action`） |
| B-4 | 服务端权威：所有风险判定经服务端规则引擎，Agent 不参与判定 |
| B-5 | Canonical Event 标准化（统一事件 schema） |
| B-6 | 任务闭环（事件 → 评估 → 任务 → 确认/关闭） |

### Agent / LLM

| 编号 | 能力 |
|---|---|
| A-1 | GLM-5.2 三端摘要（护工端 / 家属端 / 机构端（caregiver / family / institution）） |
| A-2 | 模型无关 SSE 桥（`backend/src/agent/qwenpawProvider.js`） |
| A-3 | 严格 JSON Schema + 一次修复 + 显式 Mock fallback |
| A-4 | Agent 不做诊断 / 处方 |

### 数据导入

| 编号 | 能力 |
|---|---|
| D-1 | CSV 日聚合（`backend/examples/daily_snapshots_sample.csv`） |
| D-2 | Apple Health CSV 转换（`backend/scripts/deriveAppleHealthCsv.js`） |
| D-3 | Apple Health 预览（`backend/scripts/previewAppleHealth.js`） |

### 交互与隐私

| 编号 | 能力 |
|---|---|
| I-1 | 记忆确认机制（用户确认 / 拒绝 Agent 建议） |
| I-2 | 语音以**文字模拟**实现（无真实 ASR / TTS） |
| I-3 | 隐私授权页与同意流程 |
| I-4 | software_simulator — 软件事件模拟器（模拟器产生的事件固定 `source="software_simulator"`；其他合法来源经 canonical event 标准化） |

### 工程化

| 编号 | 能力 |
|---|---|
| E-1 | 契约页 / 试点展示页 |
| E-2 | 测试 / CI / 证据三轮（QwenPaw 按阶段合同写测试 → Deterministic Worker 执行 → Codex 审查） |
| E-3 | Demo 证据文档（截图、测试报告、构建日志引用） |

---

## 2. 双运行模式

| 模式 | 说明 |
|---|---|
| 静态 Pages 模式 | 仅 Mock 数据，不连后端；用于演示与静态托管 |
| 本地完整模式 | Express + SQLite + GLM-5.2 SSE 完整链路 |

---

## 3. 永久排除项（Out of Scope — 永久）

以下在本软件版本中**永久排除**，不实现、不规划硬件链路：

> **例外**：保留一条与设备无关的 canonical event API 契约，供软件模拟器和未来可能的数据源共用。此契约不绑定任何特定硬件。

| 类别 | 排除内容 |
|---|---|
| 固件 | firmware / ESP32 / nRF |
| 构建工具链 | PlatformIO |
| 运行模式 | HardwareMode |
| 硬件适配 | 硬件适配器、LAN 上传 |
| 实体硬件 | 传感器、手环、网关等实体设备 |
| 语音 | ASR（语音识别）、TTS（语音合成）、原始录音 |
| 数据 | 真实健康数据、真实试点数据 |
| 定位 | 精确 GPS 定位（仅保留区域级） |
| 医疗 | 诊断、处方、医疗建议 |
