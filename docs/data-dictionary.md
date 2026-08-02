# 数据字典

- **Elder**：`elder_id`、虚构姓名/房间、风险标签、`subject_kind`。E001–E004 为虚构长者，TEST001 为 `team_test`。
- **DailySnapshot**：单日心率、步数、活跃时长、睡眠、佩戴时长、数据质量和来源；CSV 以 `elder_id + date` 幂等。
- **Canonical Event**：`elder_id`、规范 `event_type`、`source`、`occurred_at`、受限 payload 和处理状态。API 不接受原始语音、精确位置或客户端风险字段。
- **RiskResult**：`status_level`、`risk_score`、`key_reasons`、`recommended_action`；只由服务端规则引擎生成。
- **CareTask**：事件关联任务及 `open → acknowledged → in_progress → resolved` 状态。
- **AgentOutput**：四个锁定风险字段、三端摘要和固定免责声明；必须通过严格 Schema。
- **AgentRun**：requested/actual provider、model、fallback、validation、attempts、failure reason 和安全请求 ID。
- **ImportRun**：TEST001 CSV 文件名、来源、行数、日期范围、质量摘要和创建时间；不保存原始 Apple Health XML。
- **Memory Draft**：来源、类别、置信度、可见范围和 pending/confirmed/rejected。未确认内容不影响风险。
- **Voice Signal**：限长摘要、意图、关注信号、`retention_policy="summary_only"`；不含原始 transcript。
- **Consent/Review**：家属摘要必须通过资料许可、当前会话授权、人工确认和 `family_summary` 四重门槛。

SQLite 表为 `elders`、`snapshots`、`events`、`tasks`、`agent_outputs`、`agent_runs`、`import_runs`、`audit_logs`、`schema_migrations`。
