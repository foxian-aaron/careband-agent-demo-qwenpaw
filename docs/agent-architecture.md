# Agent 架构与安全合同

- 后端规则引擎决定四个锁定字段。
- `careband_summary_agent` 只生成护工、家属、机构摘要。
- Mock Agent 仅用于显式 Mock 或失败后的可见 fallback。

运行时目标固定为 Provider `zhipu-cn-codingplan`、Model `glm-5.2`。QwenPaw Desktop 端口从 `~/.qwenpaw/desktop_port` 动态读取，只接受 loopback。

输出必须是无额外字段的 JSON，包含四个锁定字段、三端摘要和固定免责声明：

> 本结果仅为照护风险提示，不构成医疗诊断。

第一次失败会把固定验证错误反馈给同一 Provider 修复一次；第二次失败后生成安全 Mock，并记录 requested/actual provider、fallback、failure reason、attempts 和 request IDs。不得静默调用其他模型。

Stage 16 三轮使用 `provider="mock"`，所以 `fallback_used=false` 且 `real_qwenpaw_runtime_called=false`。它证明 Schema 与业务 round-trip，不证明真实 GLM 调用成功。
