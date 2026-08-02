# BUILD_LOG — 构建与阶段日志

> 区分 **历史仓库事实**（可追溯提交/CI 记录）、**本轮实测**（本阶段实际执行的命令与结果）、**未完成项**（明确标注）。旧记录只追加、不覆盖。

---

## 1. 早期历史仓库事实

| 阶段 | 当时结果 | 说明 |
|---|---|---|
| Phase 0C | PASS | 双仓库只读审计与 25 项差距矩阵；无产品文件创建、无测试或构建 |
| Phase 4 (R2C) | PASS | 一次格式修复后通过（R2C = Review Round 2 Correction） |
| Phase 5 | PASS_WITH_RECORDED_INTERVENTION | 见下方干预记录 |
| Stage 1 | 治理文件完成 | 当时等待 Codex 最终放行与 Git/PR；后来已通过 PR 合并 |

## 2. Phase 4 — R2C PASS

- **问题**：Codex 审查发现格式问题。
- **修复**：一次格式修复。
- **结果**：PASS。

## 3. Phase 5 — PASS_WITH_RECORDED_INTERVENTION

### 3.1 干预记录

| 时间 | 角色 | 事件 | 性质 |
|---|---|---|---|
| Phase 5 执行中 | QwenPaw（Builder） | 误创建 `PHASE5_0D_TODO.md` | 越权文件 |
| Phase 5 执行中 | Codex（审查者） | 精确删除 `PHASE5_0D_TODO.md` | 记录的干预 |
| Phase 5 执行中 | Codex | SSE 结束帧从客户端历史恢复 | 数据恢复 |

### 3.2 实测环境与结果

- Node v22.23.1 / npm 10.9.8。
- `npm ci` 安装成功。
- 6 个测试文件、31 项测试全部通过，构建成功，项目文件变化为 0。

## 4. Stage 1 — 治理

### 4.1 Worker 验证结果（当时）

| 项目 | 结果 |
|---|---|
| 运行环境 | Node v22.23.1 / npm 10.9.8 |
| 安装 | `npm ci` 成功 |
| 测试 | 6 个测试文件、31 项测试全部通过 |
| 构建 | `npm run build` 成功 |
| `package-lock.json` | 哈希与 main 基线一致，未被修改 |
| Git 范围 | 合同允许的 9 个治理文件；构建产物均已忽略 |
| 依赖漏洞（当时 `npm ci` audit 摘要） | 3 moderate、2 high、1 critical；未执行 `npm audit fix` 或 `--force`，登记为待复核安全债务 |

### 4.2 Stage 1 干预记录

| 时间 | 角色 | 事件 | 性质 |
|---|---|---|---|
| Repair 1 | QwenPaw（Builder） | 误创建 `REPAIR1_TODO.md` | 第二次同类越权 TODO |
| Repair 1 | Codex / Worker | 核对精确路径后仅删除该文件 | 记录的干预 |
| Repair 2 | QwenPaw（Builder） | 合法 JSON 前加入自然语言，违反 raw JSON-only | 结构化输出不稳定 |
| Repair 2 | Controller / Codex | 以持久化 Chat 和真实 Git diff 核验修复 | 记录的核实 |

教训：后续合同继续禁止未明确列出的 TODO、scratch、临时和日志文件；控制器必须以持久化 Chat、真实 diff 和独立测试为准，不能只相信 Builder 自报 JSON。

## 5. Stage 2–15 实施摘要

| Stage | 可追溯提交 | 能力 | 状态 |
|---|---|---|---|
| 2 | `51d06bd` | 最小 Express 后端骨架 | 已通过 PR 合并 |
| 3 | `7a1604f` | SQLite 基础、迁移和种子数据 | 已通过 PR 合并 |
| 4 | `2a2bacd` | 服务端六级风险引擎 | 已通过 PR 合并 |
| 5 | `570a13d` | Canonical Event 与任务闭环 | 已通过 PR 合并 |
| 6A | `7130402` | Dashboard 只读 API | 已通过 PR 合并 |
| 6B | `a670099`、`657f735` | 前端后端只读同步及审查修复 | 已通过 PR 合并 |
| 6C | `aa57cb6` | connected 写入与任务闭环 | 已通过 PR 合并 |
| 7A | `f1ebb0d` | GLM-5.2 摘要 Agent 协议 | 已通过 PR 合并 |
| 7B | `ceb71e1` | QwenPaw SSE Provider | 已通过 PR 合并 |
| 8 | `b6ebf02` | Agent Schema、一次修复和显式 fallback | 已通过 PR 合并 |
| 9A | `d8dc511` | CSV 后端 preview/confirm/history | 已通过 PR 合并 |
| 9B | `f09b0a3` | TEST001 CSV 导入前端 | 已通过 PR 合并 |
| 10 | `1629b45` | Apple Health 本地日聚合 | 已通过 PR 合并 |
| 11 | `8b68216` | 记忆初始化与人工确认 | 本地堆叠提交，未 Push |
| 12 | `63da28d` | 隐私安全的语音文字模拟 | 本地堆叠提交，未 Push |
| 13 | `4129769` | 隐私、授权与家属门槛 | 本地堆叠提交，未 Push |
| 14 | `bc88d19` | 软件事件模拟器 | 本地堆叠提交，未 Push |
| 15 | `53c2f20` | Backend Contract 与 Pilot Plan | 本地堆叠提交，未 Push |

各阶段 QwenPaw 表现、Codex 精确修复和阻塞详情保存在本机外部 `PHASE-*.md`；这些原始运行日志不提交到公开产品仓库。上表只登记可复核提交与范围，不把历史参考仓库结果当成本轮实测。

## 6. Stage 16 — CI、安全扫描与三轮证据

提交：`e5980f4`（本地，未 Push）。

| Stage 16 门禁 | 结果 |
|---|---|
| 前端 | 18 files / 188 PASS |
| 后端 | 214 PASS |
| verification guards | 4/4 PASS |
| repository boundary scanner | 180 files / PASS |
| three-run | 3/3 PASS |
| TypeScript/build | PASS |
| 双重 Review | S=0, A=0, B=0, C=0 |

三轮明确使用显式 Mock，`real_qwenpaw_runtime_called=false`。一次全局 npm dry-run 意外使用 Node 24，不计正式验证，也未修改项目。QwenPaw Stage 16 精确修复 Chat 超时且无改动；Codex 按授权完成最小修复，并在外部 `PHASE-16.md` 登记。

## 7. Stage 17 — 文档封版候选

- 仅整理当前能力、运行模式、隐私边界、Demo Runbook 和证据矩阵，并修复开发服务器误绑定 `0.0.0.0` 的安全问题。
- Stage 16 的完整门禁在 Node v22.23.1 下再次通过：前端 188、后端 214、guards 4/4、scanner 180 files、three-run 3/3、TypeScript/build PASS。
- 文档明确：公共事件 API 尚未调用 Agent Service，页面摘要仍是 Mock；真实 GLM-5.2 尚待公共编排和 smoke。
- QwenPaw 仅完成短边界确认；具体文档整理与审查修复由 Codex 按授权完成，并记录在本机外部 `PHASE-17.md`。

## 8. Stage 18 — 运行时 Agent 闭环

- 新增 `POST /api/agent/analyze`：仅接受长者 ID 与可选源事件 ID，服务端组装权威输入，严格输出与安全 trace 原子持久化。
- connected Store 和软件事件模拟器在业务写入成功后显式调用 Agent；失败不会回滚事件/任务/风险，并明确显示错误或确定性 fallback。
- 前端只接受四个规则锁定字段完全一致、免责声明固定、Provider/Model trace 合法的服务端摘要；家属摘要继续受日状态授权门禁保护。
- Node v22.23.1 实测：前端 207/207、后端 219/219、guards 4/4、scanner 184 files、TypeScript/build PASS。
- 真实 smoke：`actual_provider=qwenpaw`、`provider=zhipu-cn-codingplan`、`model=glm-5.2`、`fallback_used=false`、`validation_status=valid`、Chat ID `f86d8f91-f13a-4783-a757-6f65a37badd7`。
- QwenPaw Builder Chat `78c56a13-a1b6-400a-9a9f-bca6750d9089` 空历史且无文件变化，216 秒后为节省 Token 安全停止；Codex 按用户授权完成精确实现并在外部 `PHASE-18.md` 登记。

## 9. Stage 19 — 最终收尾与依赖升级

- 范围：升级前端构建工具链，关闭遗留安全债务，交付 Stage 11–18 堆叠分支。
- 构建工具链升级（`package.json` / `package-lock.json`）：Vite `8.2.0`、Vitest `4.1.10`、`@vitejs/plugin-react` `5.2.0`。
- 兼容修复（`tsconfig.json`，单字段）：`compilerOptions.moduleResolution` 由 `Node` 改为 `Bundler`，以匹配 Vite 8 的模块解析约定；其余字段不变。
- QwenPaw 客户端留痕：主任务 Chat `2591ebc1-de0c-4861-a6fc-3e17895d7370` 完成依赖升级与大部分测试后停在构建兼容判断，由 Codex 安全 stop；Repair 01 Chat `16d64fb4-df18-4973-85ad-7b5919dd7c59` 完成 `tsconfig` 与初版文档；Repair 02 Chat `a767cefb-f4a6-48f8-b074-f2b8aef4cb11` 按 Node 22 独立证据修正状态文档。三条 Chat 均保留在 QwenPaw Desktop。
- 本轮实测门禁：repository / verification / 前端 207/207 / 后端 219/219 / three-run 3/3 全部通过；`npm run build` 在修复 `moduleResolution` 后通过。
- 三轮 Agent 证据**仍为显式 Mock**（`real_qwenpaw_runtime_called=false`）；真实 GLM-5.2 仍只有 Stage 18 的单次 smoke，未在 Stage 19 重复。
- 依赖漏洞复核：本轮在根目录与 `backend/` 分别运行 `npm audit --audit-level=high`，均 `found 0 vulnerabilities`。Stage 1 登记的旧安全债务已复核清零。
- GitHub 交付：PR #29–#36 已合并；Stage 18 运行时 Agent 闭环已正式闭环。
- GitHub Pages：仓库已启用 GitHub Actions 发布模式，静态 Mock 预览首次部署 run `30731249957` 已通过。

### 9.1 环境与注意

- 历史事实：QwenPaw 在 Stage 19 Repair 01 未持续保留已发现的 Node 22 PATH，因而把 build 与 audit 跑在系统 Node `24.18.0` 下；按 ADR-01，该结果仅登记为本机实测，不计正式验证。
- Codex 独立正式复核：使用真实 Node `v22.23.1` 与锁文件在同一 Worktree 重跑全部门禁——repository boundary 184 files PASS、verification 4/4 PASS、前端 19 files / 207 tests PASS（Vitest 4.1.10）、后端 219 PASS、three-run 3/3 PASS（仍为 `explicit_mock_not_fallback`）、Vite 8.2.0 build PASS（85 modules）、根目录 `npm audit` 0、backend `npm audit` 0、`git diff --check` PASS。Stage 19 的 Node 22.x 正式复核已通过，无需再复测。

## 10. 封版状态与安全债务

| 项目 | 说明 |
|---|---|
| GitHub Pages 预览 | 已启用 GitHub Actions 发布；首次静态 Mock 预览部署 run `30731249957` 通过 |
| 软件封版阻塞 | 无；根与 backend `npm audit` 均 0，Node 22 全量门禁通过 |

## 11. 约束备忘

- Node 24 不得用于正式验证。
- 所有 Codex 干预必须在本文件、外部 `PHASE-*.md` 或 PR 描述中登记。
- 禁止自动 Merge。
- 永久排除 firmware、HardwareMode、真实设备、ASR/TTS、真实健康数据、精确位置与医疗诊断。
