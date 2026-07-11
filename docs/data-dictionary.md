# 数据字典

## ElderProfile

老人档案。包含 `elderId`、姓名、年龄、房间、楼层、慢病标签、风险标签、护工 ID 和家属联系人 ID。

## PersonalBaseline

个人基线。包含 7 日平均步数、平均睡眠、平均活跃时长、静息心率基线、用药准时率和基线置信度。风险引擎用它和今日数据比较。

## DailySnapshot

今日状态快照。包含数据来源、数据质量、心率、静息心率、今日步数、活跃时长、睡眠时长、早晚药状态、佩戴时间、位置、安全区状态、跌倒检测、数据完整度和最后同步时间。Apple Health 导入只写入每日聚合数据，不写入 raw XML 或原始时间序列。

## MedicationPlan

用药计划。v0.2 保留完整模拟计划，包含 `elderId`、计划名称、来源、更新时间、备注、非医疗声明和 `doses`。页面只展示照护记录，不给出处方或剂量调整建议。TEST001 使用无固定用药的测试计划，避免误显示陈伯用药数据。

## MedicationDose

单次用药记录。包含 `doseId`、老人 ID、早药 / 晚药标签、计划时间、模拟用药名称、说明、状态、确认时间、确认人、确认来源、提醒事件 ID 和确认事件 ID。

状态包括：

- `confirmed`：已确认
- `not_confirmed`：未确认
- `delayed`：延迟
- `not_required`：今日无需确认

确认来源包括老人按钮、护工、Demo 控制和系统记录。

## ContactPerson

联系人。包含联系人 ID、姓名、角色、关系、脱敏电话和可见角色。用于老人档案页展示照护团队，不包含真实隐私数据。

## ConsentStatus

授权状态。包含家属是否可查看今日安心卡、用药状态、位置区域、语音摘要，以及医生摘要是否需要授权、位置精度和语音原文策略。

## ElderProfileDetail

老人档案详情。包含语言偏好、所属机构、照护组、照护类型、主责护工、备用护工、家属联系人、紧急联系人和授权状态。

## CareEvent / event

照护事件。所有输入在入库前规范化，完整契约以 `.agents/skills/careband-event-contract/references/events.schema.json` 为准：

- `event_type`：只允许 `sos`、`fall`、`voice`、`medication`、`location`、`device_status`、`manual_note`。旧名称只在入口转换。
- `payload.action`：表示具体动作，例如 `long_press`、`symptom_report`、`confirmed`、`geofence_exit` 或 `caregiver_completed`。
- `payload.symptom_keywords`：语音主诉识别出的关键词，如“头晕”。
- `payload.medication_name`：涉及的用药项，如“晚药”；只作照护确认，不作处方建议。
- `payload.safe_zone_status`：位置事件中的安全区状态，只保留区域级位置。
- `payload.no_response_seconds`：跌倒事件后未回应秒数。
- `payload.confidence`：0-1 跌倒置信度。
- `payload.note`：护工处理备注。
- `status`：事件处理状态，`open`、`acknowledged` 或 `resolved`。
- `linked_task_id`：事件关联的护工任务。

## RiskResult

风险引擎输出。包含风险等级、风险分、五维状态、关键原因、触发规则、建议动作、数据完整度、置信度和非医疗诊断声明。

## CareTask

护工任务。包含任务 ID、老人 ID、来源事件、优先级、标题、原因、建议动作、负责人、任务状态、创建更新时间、服务端生成的完成时间和护工备注。状态只允许 `open`、`acknowledged`、`in_progress`、`resolved`、`cancelled`。

## AgentRoleSummaries

通过 Schema 验证的 Agent 输出。Provider 可以是 QwenPaw、OpenAI 或明确标记的 Mock fallback；三端文案来自同一份规则结果，但面向不同角色。`status_level`、`risk_score`、`key_reasons` 和 `recommended_action` 必须逐字匹配规则引擎。

## careLoopStatus / displayStatus

`careLoopStatus` 是护工闭环状态：无任务、待处理、处理中、已查看、晚药已确认、已完成。

`displayStatus` 是前台展示状态：例如“高风险待处理”“高风险处理中”“已查看 / 待完成记录”“已跟进 / 持续观察”。它与 `riskLevel` 分离，避免家属端在护工完成后仍只看到“高风险”。
