# CURRENT_STATE — 当前状态快照

> 截至 **2026-08-01**

---

## 1. 工作仓库基线

- **仓库**：careband-agent-demo-qwenpaw
- **分支**：qwenpaw/stage-01-governance
- **基线提交**：main@6123d79
- **当前版本**：v0.1.3，纯前端（Vite + React），无后端

---

## 2. 已完成

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 0C | ✅ 完成 | 双仓库只读审计与 25 项差距矩阵；无产品文件创建、无测试或构建 |
| Phase 4 (R2C) | ✅ PASS | 一次格式修复后通过审查 |
| Phase 5 | ✅ PASS_WITH_RECORDED_INTERVENTION | 见 BUILD_LOG.md 详情 |
| Stage 1（治理文档） | 🔶 治理文件已完成，等待 Codex 最终放行与 Git/PR 阶段 | Worker 验证已通过；**未** Commit/Push/PR/Merge |

---

## 3. Phase 5 实测环境

| 项目 | 值 |
|---|---|
| Node.js | v22.23.1 |
| npm | 10.9.8 |
| 安装方式 | `npm ci` |
| 测试结果 | 31 项测试全部通过 |
| 构建结果 | 构建成功 |
| 文件变化 | 6 个测试文件、31 项测试，项目文件变化为 0 |

---

## 4. Node 版本约束

- **允许**：`>=22.12.0 <23`（当前基线 22.23.1）或 `>=20.19.0 <21`
- **禁止**：Node 24（不得用于任何正式验证）
- 实测验证版本：v22.23.1

---

## 5. Stage 1 范围

本阶段**仅创建治理规则文件**（共 9 个）：

1. `AGENTS.md`
2. `docs/rebuild/00_SCOPE.md`
3. `docs/rebuild/01_FEATURE_MATRIX.md`
4. `docs/rebuild/02_ARCHITECTURE_DECISIONS.md`
5. `docs/rebuild/CURRENT_STATE.md`
6. `docs/rebuild/BUILD_LOG.md`
7. `docs/rebuild/CODEX_REVIEW_RULES.md`
8. `docs/rebuild/PROMPTS/stage-01.md`
9. `.github/pull_request_template.md`

**不实现任何产品功能、不写 src 代码、不运行测试或构建。**

**验证边界**：QwenPaw 本轮不运行任何测试或构建。治理文档经审查后，由 Deterministic Worker 在 **Node 22** 环境独立运行既有测试与 build。

**Worker 验证结果（Stage 1）**：

| 项目 | 结果 |
|---|---|
| 运行环境 | Node v22.23.1 / npm 10.9.8 |
| 安装 | `npm ci` 成功 |
| 测试 | 6 个测试文件、31 项测试**全部通过** |
| 构建 | `npm run build` 成功 |
| `package-lock.json` | 哈希与 main 基线一致，未被修改 |
| Git 范围 | 仍为合同允许的 **9 个未跟踪治理文件**；`dist`、`node_modules`、`tsconfig.tsbuildinfo` 均为已忽略产物 |
| 依赖漏洞（`npm ci` audit 摘要） | 共 **6 个**：3 moderate、2 high、1 critical；**本轮未执行 `npm audit fix`**，避免未经审查改变依赖或锁文件；登记为后续安全审计项 |

> **注意**：以上为 Deterministic Worker 验证结果。本轮**未执行** Commit、Push、PR 或 Merge。Stage 1 状态为"治理文件已完成，等待 Codex 最终放行与 Git/PR 阶段"，**尚未合并**。

---

## 6. 下一步

| 阶段 | 状态 | 说明 |
|---|---|---|
| Stage 2（后端骨架） | ⬜ 未开始 | Express + SQLite + 规则引擎骨架 |

Stage 2 将在 Stage 1 治理文件经审查确认后启动。
