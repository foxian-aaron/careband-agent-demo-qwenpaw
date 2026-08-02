# 服务端六级风险规则

等级固定为 `data_insufficient`、`stable`、`observation`、`attention`、`high_risk`、`urgent`。

未解决 SOS 与高置信跌倒优先；中置信跌倒为 high_risk；无硬事件时低数据质量/佩戴不足可为 data_insufficient；头晕信号叠加晚药未确认、活动/睡眠下降会提高关注；过期或已解决事件不维持当前风险。

四个锁定字段只由 `backend/src/rules/riskEngine.js` 生成。客户端伪造字段由 canonical contract 拒绝；任务完成会关闭关联事件并重算。前端 `src/lib/riskEngine.ts` 只用于 Mock/历史兼容，不是 connected 权威。

本系统仅为照护风险提示，不构成医疗诊断，也不提供处方或药量建议。
