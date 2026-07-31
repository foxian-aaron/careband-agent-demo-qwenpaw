# CODEX_REVIEW_RULES — 代码审查规则

> 定义 Codex 审查的严重级别、问题字段与门禁规则。

---

## 1. 严重级别定义

| 级别 | 名称 | 含义 | 示例 |
|---|---|---|---|
| **S** | Showstopper（阻断） | 必须修复才能继续；阻断一切推进 | 安全漏洞、数据泄露、违反隐私规则、硬件代码混入 |
| **A** | 严重（Critical） | 必须修复才能 Commit / Push / Draft PR | 违反权威边界（Agent 生成 status_level）、Node 24 使用、缺失 Schema 校验 |
| **B** | 一般（Normal） | 应修复；可跟踪到后续阶段 | 命名不一致、缺少注释、次要设计偏差 |
| **C** | 轻微（Minor） | 可选修复；不阻塞 | 格式风格、文档措辞 |

---

## 2. 问题记录格式

每条 Codex 审查问题必须包含以下字段：

```
- 级别：S / A / B / C
- 文件：相对路径:行号
- 类别：路径 / 安全 / 规则权威 / Agent / 隐私 / 硬件 / 模式 / 测试 / 证据
- 描述：具体问题描述
- 建议：修复建议
```

---

## 3. 门禁类别

### 3.1 路径门禁
- 仅允许修改当前阶段合同指定的文件。
- 越权文件（如 `*_TODO.md` 误建）标记为 A 或 S。

### 3.2 安全门禁
- 密钥、`.env`、凭据不得出现在任何文件中 → S。
- 禁止引入不安全依赖。

### 3.3 规则权威门禁
- `status_level` / `risk_score` / `key_reasons` / `recommended_action` 不得由 Agent（LLM）生成 → A（设计） / S（运行时）。
- 后端规则引擎必须是唯一权威来源。

### 3.4 Agent 门禁
- Agent 模型固定 GLM-5.2 → 违反 = A。
- Agent 不得做诊断 / 处方 → 违反 = S。
- Schema 校验失败后必须显式 fallback → 静默吞错 = A。

### 3.5 隐私门禁
- 原始语音、XML 原始数据、精确位置、真实健康数据 → S。
- 隐私最小化原则贯穿全项目。

### 3.6 硬件门禁
- firmware / ESP32 / nRF / PlatformIO / HardwareMode / 实体设备代码 → S（永久排除）。

### 3.7 模式门禁
- 静态 Pages 模式仅 Mock；不得连接真实后端 → 违反 = A。
- software_simulator 产生的事件必须标记 `source="software_simulator"`；其他合法来源（voice / manual / import 等）经 canonical event 标准化后亦可进入系统；**禁止**伪装成 ESP32、Apple Watch 或真实硬件来源 → 违反 = A。

### 3.8 测试门禁
- 测试由 QwenPaw 按阶段合同编写，Deterministic Worker 独立运行，Codex 审查。
- 测试结果必须真实记录，不得伪造 → 伪造 = S。

### 3.9 证据门禁
- 每阶段结束必须产出证据（测试报告、构建日志、截图引用）。
- 证据缺失或不完整 → A。

---

## 4. 通过门禁

| 关卡 | 要求 |
|---|---|
| Commit | `S = 0` 且 `A = 0` |
| Push | `S = 0` 且 `A = 0` |
| Draft PR | `S = 0` 且 `A = 0` |
| Merge | `S = 0` 且 `A = 0` 且 `B ≤ 可接受阈值`；**必须用户确认** |

---

## 5. 禁止事项

- **禁止自动 Merge**：Merge 必须由用户确认。
- **禁止跳过审查**：不得在 S > 0 或 A > 0 时推进。
- **禁止隐匿干预**：所有 Codex 干预（文件创建/删除/修改）必须在 `BUILD_LOG.md` 或 PR 描述中记录。
