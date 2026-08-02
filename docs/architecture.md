# 软件架构

当前已闭合的公共链路：

```text
DailySnapshot / canonical event
  → loopback-only Express API → SQLite
  → deterministic six-level risk engine → caregiver task lifecycle
  → POST /api/agent/analyze (identity/linkage only)
  → server-built Agent input
  → Agent Service (strict validation / one repair / explicit fallback)
  → QwenPaw SSE Provider / GLM-5.2
  → agent_outputs + agent_runs
  → caregiver, family and institution read models
```

风险引擎是唯一权威；前端 store 只是后端视图或明确 Mock fallback。TEST001 是团队测试主体，不计入机构长者统计。

- `src/`：多角色 React UI、静态 Mock、后端 DTO 映射和隐私门槛。
- `backend/src/routes/`：health、elders、dashboard、events、tasks、CSV import、Agent analyze。
- `backend/src/rules/`：六级风险引擎。
- `backend/src/agent/`：QwenPaw SSE Provider、Agent Service、严格验证与 Mock fallback。
- `backend/src/schema.sql`：九张核心表。

本地完整模式由 Vite 与 `127.0.0.1:3001` 后端组成。GitHub Pages 永远是静态 Mock；只有服务端返回并校验为 QwenPaw/GLM-5.2 的摘要才能使用真实模型标签。

事件、任务和风险先通过公共事件 API 落库；随后客户端显式调用 Agent API。两个步骤故意分离，避免模型失败回滚权威业务结果。Agent 输出和安全运行 trace 原子持久化，原始 Prompt/Response 不入库。
