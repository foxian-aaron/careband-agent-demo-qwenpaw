# CareBand v0.2 风险规则

本文件描述当前后端实际执行的规则。权威机器可读约束位于 `.agents/skills/risk-engine-guardrail/references/risk_rules.md`，实现位于 `backend/src/rules/riskEngine.js`。

## 责任边界

- 规则引擎唯一决定 `status_level`、`risk_score`、`key_reasons` 和 `recommended_action`。
- QwenPaw、OpenAI 或 Mock 只能生成三端摘要，不能修改上述四个字段。
- Agent 不得诊断疾病、给出处方或建议调整药量。
- 每份 Agent 输出必须包含固定免责声明，并通过 JSON Schema 和规则一致性校验。
- 只有后端有效时间窗内、尚未解决的事件参与风险计算。

## 六级状态

| 状态 | 当前条件 |
| --- | --- |
| `data_insufficient` | 没有快照、`data_quality < 40`，或 `wear_time_hours < 6`；SOS 和任何有效跌倒信号优先于数据不足 |
| `stable` | 没有需要处理的当前信号，通常风险分低于 25 |
| `observation` | 单项强偏离、单项轻度偏离、单独晚药未确认，或低置信度跌倒；通常为 25–44 |
| `attention` | 主诉事件、步数与睡眠同时明显下降，或多项轻度偏离；通常为 45–74 |
| `high_risk` | 头晕与最新晚药未确认同时出现，或跌倒置信度在 0.5 至 0.8 之间；通常至少 75 |
| `urgent` | 未解决的规范 SOS，或跌倒置信度达到 0.8；由硬规则直接决定 |

## 固定判定顺序

1. 任何未解决的规范 `sos` 事件直接返回 `urgent`、风险分 100。即使没有快照或数据质量低也不能降级。
2. 规范 `fall` 事件取有效事件中的最高置信度：
   - `confidence >= 0.8`：`urgent`，风险分 95。
   - `0.5 <= confidence < 0.8`：至少 `high_risk`，风险分至少 82。
   - `confidence < 0.5`：至少 `observation`，风险分至少 35，等待人工复核。
3. 没有 SOS 或任何有效跌倒信号时，缺少快照、`data_quality < 40` 或佩戴少于 6 小时返回 `data_insufficient`；数据不足不能被表述为“稳定”。
4. 有头晕关键词，并且最新规范 `medication` 事件仍为 `reminder`、`missed`、`not_confirmed` 或 `unconfirmed`，返回至少 `high_risk`，风险分至少 86。
5. 今日步数低于七日基线 50%，同时睡眠低于基线 75%，返回至少 `attention`，风险分至少 62。
6. 只有一项上述强步数或睡眠偏离时，返回至少 `observation`，风险分至少 38。
7. 规范 `voice` 主诉包含“头晕、胸闷、跌倒、不舒服”等照护关键词时，返回至少 `attention`，风险分至少 55；语音主诉本身不会自动升级为 `urgent`。
8. 轻度偏离包括：步数低于基线 75%、睡眠低于基线 90%、静息心率比基线高至少 12，或活跃分钟低于基线 60%。一项轻度偏离为 `observation`，两项以上为 `attention`。
9. 只有晚药未确认且没有更高规则时，为 `observation`，风险分至少 32。
10. 其余情况为 `stable`，基准风险分 12。

## 数据和事件约束

- 七日基线按每位长者独立计算，并排除当前快照日期。
- 静息心率比较使用 `resting_heart_rate`，不能用平均心率代替。
- 旧事件名只在 API 入口兼容；入库前统一为 `sos`、`fall`、`voice`、`medication`、`location`、`device_status` 或 `manual_note`。
- 已 `resolved`、`cancelled`、`dismissed` 或超过有效时间窗的事件不参与当前风险。
- 任务进入 `resolved` 或 `cancelled` 时同步解决关联事件，旧 SOS 不得重新生成任务。
- 位置越界、慢病标签或严重语音词目前不会单独触发额外硬编码等级；它们只能作为已实现规则的证据或未来经测试加入。

## 非医疗表达

建议动作只能要求人工查看、复核设备/数据、观察现场情况或按机构流程升级。不得输出疾病结论、处方、具体药物服用指令、停药或剂量调整建议。
