# integrations/qwenpaw — Stage 7A Runtime Agent 合同

本目录是 **Stage 7A 运行时 Agent 合同**，**不是**后端 Provider 实现。
它定义 Summary Agent 的输入/输出契约与冒烟探测载荷，供 QwenPaw 端运行时使用。

## 固定 Agent 身份
- **Agent ID:** `careband_summary_agent`

## 固定运行时配置
- **provider:** `zhipu-cn-codingplan`
- **model:** `glm-5.2`
- **Planning:** `false`
- **Coding Mode:** `false`
- **所有 builtin / MCP tools:** `false`

## 端口与连接
- QwenPaw Desktop 端口必须**动态**从 `~/.qwenpaw/desktop_port` 读取，
  不得硬编码。
- 只连接 `127.0.0.1`（本地回环）。

## Stage 7A 探测方式
- 使用 `/api/console/chat` 作为客户端可见的 **synthetic probe**（合成探测）。

## Stage 7B 前置约束
- Stage 7B 实现后端 Provider 之前，**必须再次探测**真实运行时端点；
  不得机械照搬参考仓库的旧 `8088` 端点。

## 数据与安全
- 不保存密钥、不保存完整对话、不保存真实健康数据。
- `smoke_task.md` 仅为 **synthetic test**；其历史成功
  **不能**代表产品 Provider 已完成。
