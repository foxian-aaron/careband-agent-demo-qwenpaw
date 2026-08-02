# 三分钟软件 Demo Runbook

## 准备

1. 用 Node 22 安装依赖并分别启动后端、前端。
2. 打开 `#/institution`，确认 connected；若显示 Mock，先修复后端，不得假装联网。
3. 不使用真实长者、真实 XML、真实语音或精确位置。

## 主线

1. **机构端**：展示统计和多角色入口，说明 TEST001 不计入服务人数。
2. **CSV**：进入 `#/elder/TEST001/wearable-import`，预览、确认、查看 history；再次确认说明日期幂等覆盖。
3. **软件 SOS**：进入 `#/event-simulator` 发送 E001 SOS，指出 `source="software_simulator"` 且客户端未提交风险字段。
4. **规则、任务与 Agent**：展示后端 `urgent` 和 open task，再查看 Agent 状态。只有 `actual_provider=qwenpaw`、`model=glm-5.2`、`fallback_used=false`、`validation_status=valid` 才称真实摘要；否则明确显示 Mock/fallback。
5. **三端摘要**：查看 E001 长者端、已授权家属端和机构端摘要；随后在护工端完成任务，确认事件关闭、风险不再 urgent，并重新生成与新规则结果匹配的摘要。
6. **记忆/语音**：展示 pending→人工确认，以及文字陪伴的 `summary_only`。
7. **授权**：护工确认并授权后，家属才看到摘要；撤回后立即隐藏。
8. **契约/试点**：展示 backend-contract 与 pilot-plan，明确试点是计划。

`npm run verify:three-runs` 连续三轮覆盖 CSV、SOS、任务关闭、显式 Mock 摘要和 Dashboard round-trip。它不调用真实 QwenPaw；Stage 18 的真实 GLM-5.2 smoke 是单独证据，两者不得混写。

禁止声称已经接入实体手环、完成养老院试点、用 Mock 代替 GLM 成功，或诊断疾病/建议药量。
