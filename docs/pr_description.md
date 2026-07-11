# CareBand v0.2 本地分支变更说明

本文件记录 `codex/careband-real-demo` 的本地实现范围。当前没有创建 PR、没有 push，也没有进行公网部署；旧版 GitHub Pages 链接不作为本轮闭环证据。

## 主链路

```text
CSV / Apple Health 日聚合或规范硬件事件
→ Express + SQLite 标准化
→ 规则引擎决定六级风险
→ QwenPaw / OpenAI / 确定性 Mock 三端摘要
→ 护工任务
→ 家属与机构同步
```

## 已实现并有本地证据

- 规范事件、DailySnapshot、幂等导入、七日基线与 TEST001 运营隔离。
- 规则优先的风险结果、任务关联、完成后解决事件以及审计记录。
- QwenPaw/OpenAI/Mock Provider 抽象、SSE 解析、固定 JSON Schema、修复重试与可见 fallback。
- CSV 预览/确认/历史、三端 UI、软件硬件模拟器和本地 Demo reset。
- ESP32-S3 固件、按钮状态机、重试队列、BOM、接线、烧录和验收模板。
- 隐私/同意/撤回模板、访谈材料、三分钟 runbook、PPT、截图和软件模拟视频。

## 当前验收

- 后端：57/57。
- 前端：71/71。
- 固件原生状态机：11/11；ESP32-S3 DevKitC-1 编译通过。
- API/SQLite 与真实浏览器软件主链路均连续通过 3/3。
- 前后端依赖审计为 0 个已知漏洞。

## 尚未完成，不能对外声称

- 阿里凭据当前返回 401；只能说 Provider 桥接、假 SSE 与 Mock fallback 已验证，不能说真实 QwenPaw 已成功生成摘要。
- 没有 ESP32 实物与 COM 口，不能说实体按键、LED、震动或 Wi-Fi 已通过三次验收。
- 没有真实访谈记录、正式隐私法律审阅、真实长者试戴或生产部署。
- 当前视频为 2 分 13 秒无旁白的软件模拟版；团队出镜、旁白和实体镜头仍待补充。

所有 Agent 输出必须保留：

```text
本結果僅為照護風險提示，不構成醫療診斷。
```
