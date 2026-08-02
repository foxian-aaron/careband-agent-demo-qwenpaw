# 软件架构

当前已闭合的公共链路：

```text
DailySnapshot / canonical event
  → loopback-only Express API → SQLite
  → deterministic six-level risk engine → caregiver task lifecycle
  → caregiver, family and institution read models（当前摘要为明确 Mock）
```

已独立实现、尚待公共 API 接线的链路：

```text
server-built Agent input
  → Agent Service (strict validation / one repair / explicit fallback)
  → QwenPaw SSE Provider / GLM-5.2
  → agent_outputs + agent_runs
```

风险引擎是唯一权威；前端 store 只是后端视图或明确 Mock fallback。TEST001 是团队测试主体，不计入机构长者统计。

- `src/`：多角色 React UI、静态 Mock、后端 DTO 映射和隐私门槛。
- `backend/src/routes/`：health、elders、dashboard、events、tasks、CSV import。
- `backend/src/rules/`：六级风险引擎。
- `backend/src/agent/`：QwenPaw SSE Provider、Agent Service、严格验证与 Mock fallback。
- `backend/src/schema.sql`：九张核心表。

本地完整模式由 Vite 与 `127.0.0.1:3001` 后端组成。GitHub Pages 永远是静态 Mock；公共 Agent 编排接线完成前，本地页面摘要也只能称为 Mock。

事件、任务和风险已形成公共 API 闭环。Agent Provider/Service 已独立实现并测试，但公共事件路由尚未自动编排并持久化 Agent 输出；因此不得宣称 `POST /api/events` 已触发真实 GLM-5.2。
