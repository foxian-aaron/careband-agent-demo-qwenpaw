# 事件流说明

```mermaid
flowchart TD
  A[穿戴日聚合 / CSV / 规范事件] --> B[后端标准化并读取老人档案与七日基线]
  A --> A1[用药 / SOS / 跌倒 / 语音 / 位置事件]
  A1 --> B
  B --> C[读取用药计划和授权状态]
  C --> D[检查硬事件]
  D --> E[检查数据完整度]
  E --> F[计算日常偏离]
  F --> G[风险引擎输出 riskLevel]
  G --> H[生成或更新护工任务]
  H --> I[QwenPaw / OpenAI / 明示 Mock fallback 生成三端摘要]
  I --> I1[JSON Schema 与规则字段一致性校验]
  I1 --> K[CaregiverPage / FamilyPage / InstitutionPage 同步展示同一结果]
  H --> J[任务 open / acknowledged / in_progress]
  J --> L[护工接单 / 查看 / 确认用药 / 完成处理]
  L --> M[家属端和机构端同步更新]
```

## 陈伯主线

1. 初始数据进入系统：步数 820、睡眠 4.8 小时、晚药未确认。
2. 系统读取陈伯个人基线：7 日平均步数 2150、平均睡眠 6.5 小时。
3. 规则引擎输出“需关注”。
4. 20:15 添加语音事件“我有点头晕”。
5. `voice` 事件入库后，规则引擎升级为“高风险”；真实 Provider 或明示 Mock fallback 生成同一次护工、家属、机构摘要。
6. 护工端生成高优先级任务。
7. 护工接单，任务进入处理中。
8. 护工标记已查看，新增 `manual_note` 事件，`payload.action = caregiver_checked`。
9. 护工确认晚药，新增 `medication` 事件，`payload.action = confirmed`。
10. 护工完成处理，任务状态变为 `resolved`；完成时间由服务器生成，并解决关联事件。
11. 家属端和机构端同步显示“已跟进 / 持续观察”，同时保留“今日曾出现高风险事件”的说明。
