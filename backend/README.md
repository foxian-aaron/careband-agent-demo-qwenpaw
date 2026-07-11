# CareBand Agent Backend v0.2

本后端只服务比赛主链路：DailySnapshot / 规范事件 → SQLite → 确定性规则引擎 → 三端 Agent 摘要 → 照护任务。

## 启动

从项目根目录启动整套本地 Demo：

```powershell
& scripts/start-demo.ps1
```

仅启动后端：

```powershell
cd backend
npm install
npm run dev
```

默认监听 `127.0.0.1:3001`。实体 ESP32 联调必须显式使用根目录脚本的 `-HardwareMode`，不要长期暴露局域网监听。
硬件模式下，非本机设备只能访问 `GET /api/health` 与 `POST /api/events`；事件端点仍无设备认证或 TLS，只能用于可信私有局域网。

## 环境变量

参考 `.env.example`。关键配置包括：

- `BACKEND_HOST=127.0.0.1`
- `PORT=3001`
- `DATABASE_PATH=./data/careband.sqlite`
- `AGENT_PROVIDER=qwenpaw | openai | mock`
- `QWENPAW_BASE_URL=http://127.0.0.1:8088`
- `QWENPAW_AGENT_ID=careband_summary_agent`
- `CORS_ORIGIN=http://127.0.0.1:5173`
- `ALLOW_DEMO_RESET=true`（仅本地演示；接口仍强制要求 loopback 请求）

密钥只保存在本机 Provider/QwenPaw 配置或未提交的 `.env` 中。

## 数据表

- `elders`
- `snapshots`
- `events`
- `tasks`
- `agent_outputs`
- `agent_runs`
- `import_runs`
- `audit_logs`
- `schema_migrations`

SQLite 文件、上传临时文件和原始 Apple Health XML 均不得提交。

## API

- `GET /api/health`
- `GET /api/elders`
- `GET /api/dashboard`
- `POST /api/snapshots`
- `POST /api/events`
- `POST /api/import/daily-snapshots-csv/preview`
- `POST /api/import/daily-snapshots-csv`
- `GET /api/import/daily-snapshots-csv/history`
- `POST /api/import/apple-health-xml/preview`
- `POST /api/import/apple-health-xml`
- `POST /api/agent/analyze`
- `PATCH /api/tasks/:id`
- `POST /api/demo/reset`（仅当 `ALLOW_DEMO_RESET=true` 且请求来自 loopback）

`POST /api/agent/analyze` 只接收 `elder_id` 和可选 `source_event_id`；服务器自行重建快照、七日基线、有效事件和风险结果，拒绝客户端伪造风险。

来自 `esp32/nrf` 的 `POST /api/events` 会先快速返回已入库的事件、规则风险和任务，再由后端排队运行同一 Agent 编排；因此实体事件不依赖网页额外调用。若旧摘要与当前规则结果不一致，Dashboard 不会把它当作当前摘要返回。

## 锁定风险规则

- 任意未解决规范 `sos` → `urgent`，即使没有快照。
- 跌倒置信度 ≥ 0.8 → `urgent`；≥ 0.5 → `high_risk`；更低 → `observation`。
- 无快照、`data_quality < 40` 或佩戴少于 6 小时 → `data_insufficient`，但不能覆盖 SOS/高置信跌倒。
- 头晕 + 最新晚药未确认 → `high_risk`。
- 步数低于七日基线 50% 且睡眠低于基线 75% → `attention`。
- 单项强偏离或一项轻度偏离 → `observation`；多项轻度偏离 → `attention`。
- 已解决或超过有效时间窗的旧事件不参与判断；任务完成会解决全部关联事件。

LLM 不得修改 `status_level`、`risk_score` 或 `key_reasons`。

## Agent Provider

- `qwenpaw`：默认真实 Provider，通过 `POST /api/agent/process`、`X-Agent-Id` 和 SSE 调用专用工作区。
- `openai`：只有显式设置 `AGENT_PROVIDER=openai` 时使用。
- `mock`：确定性演示 Provider，也是任何真实调用失败后的明确 fallback；不会暗中切换另一付费模型。

所有输出必须通过 `backend/src/schemas/agent_output.schema.json`、固定免责声明、证据和禁止诊断/处方检查。当前机器的阿里凭据已过期，因此真实 QwenPaw 探测会返回 401；代码会诚实标记 `Mock fallback`，不能把它宣称为真实 Agent 成功。

## 验证

```powershell
npm test
npm run verify:demo
npm run smoke:qwenpaw
```

`verify:demo` 验证三轮确定性 Mock 闭环、实体来源事件的后端 Agent 排队、CSV 幂等和任务解决后的摘要刷新；只有 `smoke:qwenpaw` 出现 `provider=qwenpaw`、`fallback_used=false`、`validation_status=valid` 才能证明真实 Agent 链路。
