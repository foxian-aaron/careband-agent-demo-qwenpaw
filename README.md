# 智护环 CareBand Agent｜软件版 v0.3 候选版

CareBand 当前已闭合“日聚合穿戴数据/标准照护事件 → 本机 Express + SQLite → 确定性六级风险 → 护工任务”的公共链路。QwenPaw / GLM-5.2 摘要层已经独立实现并测试，但尚未接入公共事件 API；现有页面摘要仍是明确标记的 Mock。

本仓库只用于软件 Demo。它不做医疗诊断，不包含真实长者资料，也不包含 firmware、ESP32、nRF、PlatformIO、HardwareMode、ASR/TTS 或真实设备同步。

## 两种运行模式

| 模式 | 能力 | 明确限制 |
|---|---|---|
| 本地完整模式 | React、Express、SQLite、事件/任务闭环、CSV 导入、QwenPaw Provider | 仅绑定 `127.0.0.1`；需要 Node 22 与本机 QwenPaw Desktop |
| 静态 Pages 预览 | React 与虚构 Mock 数据 | 没有 Express、SQLite、CSV 写入或真实 Agent；UI 必须显示 Mock/静态状态 |

## 核心安全边界

- `status_level`、`risk_score`、`key_reasons`、`recommended_action` 只由后端规则引擎决定。
- Agent 只能复制上述字段并生成三角色摘要；输出必须通过严格 JSON Schema。
- QwenPaw 首次输出非法时只修复一次，再失败则显式 Mock fallback；不得静默切换模型。
- 软件模拟事件固定 `source="software_simulator"`。
- 原始语音、Apple Health XML、精确位置、密钥和真实健康资料不得进入 SQLite、日志、Agent 或 Git。

## 本地启动

要求 Node.js `>=22.12.0 <23`。Node 24 不属于正式验证环境。

```bash
npm ci
npm ci --prefix backend
```

分别启动两个终端：

```bash
npm run dev:backend
npm run dev:frontend
```

后端固定监听 `http://127.0.0.1:3001`；Vite 在本机把 `/api` 代理到该地址。默认页面为 `#/institution`。

## 测试与门禁

```bash
npm run verify:repository
npm run test:verification
npm run test:frontend
npm run test:backend
npm run verify:three-runs
npm run build
```

Stage 16 的真实本地结果：前端 188/188、后端 214/214、verification guards 4/4、repository boundary scanner 扫描 180 个文件并通过、三轮门禁 3/3、TypeScript 与生产构建通过。三轮 Agent 证据是**显式 Mock、非 fallback**，并记录 `real_qwenpaw_runtime_called=false`，不能当作真实 GLM-5.2 成功证据。

## 主要页面

- `#/institution`、`#/caregiver`、`#/elder/E001`、`#/family/E001`
- `#/elder/E001/profile`、`#/medication/E001`
- `#/elder/TEST001/wearable-import`
- `#/elder/E001/memory-intake`、`#/elder/E001/voice`
- `#/caregiver/elder/E001/privacy`、`#/family/E001/privacy`
- `#/event-simulator`、`#/backend-contract`、`#/pilot-plan`

完整演示见 `docs/demo-runbook.md`。QwenPaw Provider、Schema、一次修复与 fallback 已实现并有自动测试；但公共事件 API 尚未自动调用 Agent Service，因此不得把事件 POST 描述为已自动完成真实 GLM 摘要。

固定声明：**本结果仅为照护风险提示，不构成医疗诊断。**
