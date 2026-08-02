# Agent 架构与安全合同

- 后端规则引擎决定四个锁定字段。
- `careband_summary_agent` 只生成护工、家属、机构摘要。
- Mock Agent 仅用于显式 Mock 或失败后的可见 fallback。

运行时目标固定为 Provider `zhipu-cn-codingplan`、Model `glm-5.2`。QwenPaw Desktop 端口从 `~/.qwenpaw/desktop_port` 动态读取，只接受 loopback。

输出必须是无额外字段的 JSON，包含四个锁定字段、三端摘要和固定免责声明：

> 本结果仅为照护风险提示，不构成医疗诊断。

第一次失败会把固定验证错误反馈给同一 Provider 修复一次；第二次失败后生成安全 Mock，并记录 requested/actual provider、fallback、failure reason、attempts 和 request IDs。不得静默调用其他模型。

Stage 16 三轮使用 `provider="mock"`，所以 `fallback_used=false` 且 `real_qwenpaw_runtime_called=false`。它证明 Schema 与业务 round-trip，不证明真实 GLM 调用成功。

Stage 18 新增 `POST /api/agent/analyze`。客户端只能提交 `elder_id` 和可选 `source_event_id`；服务端读取当前 Dashboard 组装日快照、活跃事件与权威风险，并将严格输出和安全 trace 原子写入 `agent_outputs` / `agent_runs`。前端再次校验四个锁定字段与 Provider 身份后才显示真实标签。

2026-08-02 的独立真实 smoke：`careband_summary_agent` 使用 `zhipu-cn-codingplan / glm-5.2`，一次通过，`fallback_used=false`、`validation_status=valid`，QwenPaw Chat ID `f86d8f91-f13a-4783-a757-6f65a37badd7`。这条证据不替代 Stage 16 的三轮确定性验证。
