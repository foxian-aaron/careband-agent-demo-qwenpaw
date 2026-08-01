# Smoke Task — 纯虚构 E001 协议探测

> 本任务**完全是虚构**的 `E001` 协议探测样本，**不是**任何真实长者的资料。
> 仅用于验证 Agent 是否能严格按合同返回 JSON。

## 任务要求
- 只返回**一个** JSON 对象，无 Markdown fence、无前后说明、无额外字段。
- 4 个锁定字段（`status_level`、`risk_score`、`key_reasons`、`recommended_action`）
  必须**原样复制**，不得改写。
- `safety_disclaimer` 固定为：本结果仅为照护风险提示，不构成医疗诊断。
- 不得诊断、不得处方/停药/改药/药量建议。

## 任务载荷

```json
{
  "task_type": "careband_elder_state_summary",
  "elder_profile": {
    "elder_id": "E001",
    "display_name": "陈伯（虚构）"
  },
  "daily_snapshot": {
    "data_quality": 90,
    "wear_time_hours": 12,
    "steps": 5200,
    "sleep_duration": 7.1
  },
  "personal_baseline": {
    "steps": 5000,
    "sleep_duration": 7.0
  },
  "active_events": [],
  "risk_result": {
    "status_level": "stable",
    "risk_score": 10,
    "key_reasons": ["虚构 E001 聚合数据未见硬风险事件"],
    "recommended_action": "继续日常观察"
  },
  "target_outputs": ["caregiver", "family", "institution"]
}
```
