# PROMPTS/stage-01.md — Stage 1 治理文件任务定义

> 本文件保存 Stage 1 的任务目标、约束与验收标准，用于可复现。

---

## 1. 目标

为 careband-agent-demo-qwenpaw 软件版 v0.3 重构建立**治理规则**（Stage 1）。
**仅创建治理文件，不实现任何产品功能。**

工作区：`qwenpaw/stage-01-governance` 分支，基线 `main@6123d79`。

---

## 2. 允许创建或修改的文件（共 9 个）

| # | 文件 |
|---|---|
| 1 | `AGENTS.md` |
| 2 | `docs/rebuild/00_SCOPE.md` |
| 3 | `docs/rebuild/01_FEATURE_MATRIX.md` |
| 4 | `docs/rebuild/02_ARCHITECTURE_DECISIONS.md` |
| 5 | `docs/rebuild/CURRENT_STATE.md` |
| 6 | `docs/rebuild/BUILD_LOG.md` |
| 7 | `docs/rebuild/CODEX_REVIEW_RULES.md` |
| 8 | `docs/rebuild/PROMPTS/stage-01.md` |
| 9 | `.github/pull_request_template.md` |

---

## 3. 禁止项

- 创建 TODO / 临时 / 日志文件（已指定的除外）
- 修改 `src`、`package.json`、`package-lock.json`、`vite`/`tsconfig`、`scripts`（现有）、现有 `docs`、`.github/workflows`
- 读取或修改参考仓库
- 安装依赖、测试、构建
- Git `add` / `commit` / `push` / `pull` / `fetch` / `merge` / `reset` / `clean`
- 进入 Stage 2
- 读取密钥、`.env`、真实健康数据或 firmware

---

## 4. 内容要求摘要

各文件的核心覆盖点：

1. **AGENTS.md**：根级规则；后端规则引擎独占四字段；Agent 仅摘要且固定 GLM-5.2；严格 Schema + 一次修复后 Mock fallback；不做诊断/处方；Node 版本；参考仓库只读；静态 Mock / software_simulator / 隐私 / 硬件排除 / 角色权限 / S=0 A=0 门禁 / Codex 干预记录。
2. **00_SCOPE.md**：软件版 v0.3 纳入范围与永久排除项。
3. **01_FEATURE_MATRIX.md**：25 项能力矩阵；特定行有固定状态/策略/优先级；精确路径。
4. **02_ARCHITECTURE_DECISIONS.md**：10 条已接受架构决策；不得声称代码已实现。
5. **CURRENT_STATE.md**：截至 2026-08-01 的工作仓库状态。
6. **BUILD_LOG.md**：历史事实 / 本轮实测 / 未完成项；Phase 4 R2C、Phase 5 干预记录。
7. **CODEX_REVIEW_RULES.md**：S/A/B/C 定义、问题字段、门禁类别、通过条件。
8. **PROMPTS/stage-01.md**：本文件（任务可复现定义）。
9. **pull_request_template.md**：PR 模板含全部必填字段。

---

## 5. 验收命令

任务完成后**仅执行以下三条只读 Git 命令**：

```bash
git status --short
git diff --check
git ls-files --others --exclude-standard
```

**不得**运行测试、构建、或执行任何写操作 Git 命令。

确认实际变化只有以上 9 个文件。`git ls-files --others --exclude-standard` 列出未跟踪文件，用于发现任何越权创建的文件（`git diff --name-only` 无法发现未跟踪文件，故替换之）。

---

## 6. 返回格式

最终输出单行合法 JSON：

```json
{"status":"completed或blocked","changed_files":[],"diff_check_exit":0,"scope_violation":false,"tests_run":false,"commit":false,"push":false,"stage2_started":false,"errors":[]}
```

---

## 7. 停止条件

- 9 个文件全部创建完毕 ✅
- 三条 Git 只读命令执行完毕 ✅
- 确认 `scope_violation = false`（只有 9 个文件变动）✅
- 输出 JSON 并停止 ✅
