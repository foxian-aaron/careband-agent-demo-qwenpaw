# 隐私与授权

- 仓库只包含虚构长者 E001–E004 与团队测试主体 TEST001。
- 原始语音文字只存在页面会话；持久化仅允许限长摘要、结构化 Signal 和 pending 草稿。
- 家属语音摘要必须同时满足：资料允许、当前会话已授权、护工已确认、可见级别为 `family_summary`。
- 家属看不到原话、内部置信度、内部关注等级或精确位置。
- 位置只允许 zone label；坐标、地址和轨迹在 API 入库前拒绝。
- Apple Health XML 与逐条记录只在 `private_data/` 处理，不进浏览器、HTTP、SQLite、日志、Agent 或 Git。
- 仓库扫描器对 `.env`、常见 Token/AccessKey 签名、证书、数据库与凭据文件失败关闭；Cookie 等运行时秘密仍不得写入仓库或日志，并由运行边界和人工审查共同防护。

授权与审核 Mock 状态仅当前会话有效，不写入 localStorage。撤回授权后家属摘要立即不可见。
