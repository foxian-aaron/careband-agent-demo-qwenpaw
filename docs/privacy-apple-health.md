# Apple Health 本地数据边界

Apple Health 导出包含高度敏感的个人健康资料。本项目只允许在本机把原始 XML 转换成 `TEST001` 日聚合 CSV。

## 永久规则

- 原始 `export.xml`、`export.zip`、解压目录和派生文件必须保存在被 Git 忽略的 `private_data/` 下。
- 原始 XML、逐条心率记录、设备身份、Apple ID 和文件绝对路径不得进入浏览器、HTTP API、SQLite、日志、Git、QwenPaw 运行时 Agent 或其他 LLM。
- Stage 10 固定使用团队测试主体 `TEST001`，不支持真实长者 ID。
- 只允许派生的 DailySnapshot CSV 进入 Stage 9 的 preview → confirm 流程；服务端仍负责验证和覆盖权威主体/来源字段。
- 日聚合结果只用于照护风险提示，不构成医疗诊断，不提供处方或药量建议。

## 本地流程

将本地导出放在：

```text
private_data/apple_health/export.xml
```

只读预览：

```bash
cd backend
npm run preview:apple-health -- ../private_data/apple_health/export.xml --limit-days=14
```

生成固定输出 `private_data/derived/apple-health-daily.csv`：

```bash
npm run derive:apple-health -- ../private_data/apple_health/export.xml --limit-days=14
```

随后在本地完整模式的 `#/elder/TEST001/wearable-import` 页面预览并确认 CSV。静态 Pages 不支持此流程。

## 可发送给 Agent 的内容

只允许：单日聚合指标、个人基线摘要、规范事件摘要、后端规则风险结果。禁止：原始 XML、全量心率时间序列、设备拥有者身份、精确位置和临床资料。
