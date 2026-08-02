# Fallback 矩阵

| 场景 | 行为 | 必须显示/记录 |
|---|---|---|
| 静态 Pages | 不发 API，使用 Mock | 静态预览/Mock |
| 本地后端不可用 | 前端降级 Mock | 安全错误码，不伪装 connected |
| 显式 `provider=mock` | 确定性 Mock | requested=actual=mock，fallback=false |
| QwenPaw 成功 | 使用 GLM-5.2 摘要 | actual=qwenpaw，fallback=false |
| 第一次非法 | 同一 Provider 修复一次 | attempts=2，保留 request IDs |
| 第二次失败/超时 | 安全 Mock fallback | requested=qwenpaw，actual=mock，fallback=true，failure_reason |
| Agent 改风险字段 | 拒绝并修复/fallback | 后端风险保持不变 |

不得静默切换模型，也不得显示错误正文、Token、路径或原始健康资料。
