# 事件与任务流

```text
UI / CSV → canonical validation → SQLite → server risk engine
         → event response + caregiver task → task transitions
         → related event resolved → risk recomputed → dashboard refresh
```

客户端不能提交权威风险字段。软件模拟器固定 `source="software_simulator"`。Agent Service 是风险之后的摘要层，不参与事件标准化或风险计算；当前公共事件路由尚未自动调用 Agent。
