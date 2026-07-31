# BUILD_LOG — 构建与阶段日志

> 区分 **历史仓库事实**（可追溯提交/CI 记录）、**本轮实测**（本阶段实际执行的命令与结果）、**未完成项**（明确标注）。

---

## 1. 历史仓库事实

| 阶段 | 结果 | 说明 |
|---|---|---|
| Phase 0C | PASS | 双仓库只读审计与 25 项差距矩阵；无产品文件创建、无测试或构建 |
| Phase 4 (R2C) | PASS | **一次格式修复后通过**（R2C = Review Round 2 Correction） |
| Phase 5 | PASS_WITH_RECORDED_INTERVENTION | 见下方干预记录 |
| Stage 1 | 治理文件已完成，等待 Codex 最终放行与 Git/PR | 仅创建治理文档；QwenPaw 不运行测试/构建，Worker 在 Node 22 上的验证**已通过**；未 Commit/Push/PR/Merge |

---

## 2. Phase 4 — R2C PASS

- **问题**：Codex 审查发现格式问题。
- **修复**：一次格式修复。
- **结果**：PASS。

---

## 3. Phase 5 — PASS_WITH_RECORDED_INTERVENTION

### 3.1 干预记录

| 时间 | 角色 | 事件 | 性质 |
|---|---|---|---|
| Phase 5 执行中 | QwenPaw（Builder） | 误创建 `PHASE5_0D_TODO.md` | 越权文件 |
| Phase 5 执行中 | Codex（审查者） | 精确删除 `PHASE5_0D_TODO.md` | 记录的干预 |
| Phase 5 执行中 | Codex | SSE 结束帧从客户端历史恢复 | 数据恢复 |

### 3.2 实测环境

- Node v22.23.1 / npm 10.9.8
- `npm ci` 安装
- 6 个测试文件、31 项测试，项目文件变化为 0

### 3.3 最终结果

| 检查项 | 结果 |
|---|---|
| 测试 | 31 项全部通过 |
| 构建 | 构建成功 |

---

## 4. Stage 1（当前）

- **范围**：仅创建 9 个治理规则文件（见 `CURRENT_STATE.md` §5）。
- **测试 / 构建边界**：**QwenPaw 本轮不运行任何测试或构建**。治理文档经审查后，由 Deterministic Worker 在 **Node 22** 环境独立运行既有测试与 build，Codex 审查。
- **治理文件创建**：本日志记录文件创建动作。

### 4.0 Worker 验证结果（Stage 1）

| 项目 | 结果 |
|---|---|
| 运行环境 | Node v22.23.1 / npm 10.9.8 |
| 安装 | `npm ci` 成功 |
| 测试 | 6 个测试文件、31 项测试**全部通过** |
| 构建 | `npm run build` 成功 |
| `package-lock.json` | 哈希与 main 基线一致，未被修改 |
| Git 范围 | 仍为合同允许的 **9 个未跟踪治理文件**；`dist`、`node_modules`、`tsconfig.tsbuildinfo` 均为已忽略产物 |
| 依赖漏洞（`npm ci` audit 摘要） | 共 **6 个**：3 moderate、2 high、1 critical；**本轮未执行 `npm audit fix`**（更未执行 `--force`），避免未经审查改变依赖或锁文件；登记为后续安全审计项 |

> **状态**：Worker 验证已通过，但本轮**未执行** Commit、Push、PR 或 Merge。Stage 1 状态为"治理文件已完成，等待 Codex 最终放行与 Git/PR 阶段"，**尚未合并**。

### 4.1 Stage 1 干预记录

| 时间 | 角色 | 事件 | 性质 |
|---|---|---|---|
| Stage 1 Repair 1 | QwenPaw（Builder） | 误创建未跟踪文件 `REPAIR1_TODO.md`（越权） | 第二次同类"擅自创建 TODO"能力问题 |
| Stage 1 Repair 1 | Codex / Deterministic Worker | 核对精确路径后仅删除 `REPAIR1_TODO.md` | 记录的干预 |
| 删除后 | — | 范围恢复为合同允许的 9 个文件 | 范围恢复 |
| Stage 1 Repair 2 | QwenPaw（Builder） | 最终可见回复在合法 JSON 之前加了一句自然语言，违反 raw JSON-only 返回约束 | 能力问题：结构化输出不稳定 |
| Stage 1 Repair 2 | 控制器 | 以持久化 Chat 记录与真实 Git diff 为准核实：真实文件修复有效 | 记录的核实 |

> **教训（擅自创建 TODO）**：这是继 Phase 5 `PHASE5_0D_TODO.md` 之后第二次同类"擅自创建 TODO"能力问题。后续阶段合同应**继续禁止** QwenPaw 创建任何 TODO / scratch / 临时 / 日志文件（合同逐字列出准确路径者除外）。
>
> **教训（结构化输出）**：Stage 1 Repair 2 表明 Builder 的 raw JSON-only 输出不稳定——真实文件修复有效，但最终回复仍混入自然语言。后续控制器**必须以持久化 Chat 记录与真实 Git diff 为准**，不得仅凭单次结构化输出判定结果。

---

## 5. 未完成项

| 项目 | 说明 |
|---|---|
| Stage 2 后端骨架 | 尚未开始 |
| 六级规则引擎实现 | 尚未开始 |
| Agent GLM-5.2 适配 | 尚未开始 |
| 测试套件 | 待 QwenPaw 按后续阶段合同编写 |
| 依赖漏洞安全审计 | `npm ci` 报告 6 个漏洞（3 moderate、2 high、1 critical）；**待后续审查**，**不得**自动执行 `npm audit fix --force` |

---

## 6. 约束备忘

- Node 24 不得用于正式验证。
- 所有 Codex 干预必须在本文件或 PR 描述中记录。
- 禁止自动 Merge。
