# 长者语音陪伴文字模拟

`#/elder/E001/voice` 是文字模拟，不使用麦克风、ASR 或 TTS。每次输入最多 500 字，页面只保留最近 20 条消息。

原始文字不会写入 localStorage、SQLite、CareEvent 或 Agent 日志。系统只生成 `retention_policy="summary_only"` 的 Signal、限长摘要和 pending 草稿。

长者页面不能确认自己的草稿。护工可确认/拒绝；家属仅在授权和人工确认同时满足时看到固定 family summary。紧急表达只能转换为不含原话的 canonical event 信号，最终风险仍由后端规则引擎决定。
