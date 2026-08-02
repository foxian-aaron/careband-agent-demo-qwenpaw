export interface ContractField {
  name: string;
  description: string;
}

export interface DomainContract {
  name: "DailySnapshot" | "CareEvent" | "RiskResult" | "CareTask" | "AgentInput" | "AgentOutput";
  authority: string;
  fields: ContractField[];
}

export const DOMAIN_CONTRACTS: readonly DomainContract[] = [
  {
    name: "DailySnapshot",
    authority: "后端校验与 SQLite 持久化；导入端只提交日聚合数据",
    fields: [
      { name: "elder_id + date", description: "长者与自然日唯一键" },
      { name: "steps / sleep_duration / wear_time_hours", description: "日聚合指标，不含原始时间序列" },
      { name: "data_quality", description: "0–100 数据质量" },
    ],
  },
  {
    name: "CareEvent",
    authority: "客户端提交允许字段，后端规范化后才持久化",
    fields: [
      { name: "elder_id / event_type / source", description: "设备无关的规范事件身份" },
      { name: "occurred_at", description: "带明确时区的 ISO 时间" },
      { name: "payload", description: "结构化安全载荷；不含原始语音或精确位置" },
    ],
  },
  {
    name: "RiskResult",
    authority: "仅后端确定性规则引擎生成，前端和 Agent 均无权改写",
    fields: [
      { name: "status_level / risk_score", description: "固定六级风险与 0–100 分数" },
      { name: "key_reasons", description: "规则命中的结构化原因" },
      { name: "recommended_action", description: "规则生成的照护动作" },
    ],
  },
  {
    name: "CareTask",
    authority: "后端事件工作流创建并控制状态转换",
    fields: [
      { name: "task_id / elder_id", description: "任务身份" },
      { name: "linked_event_id", description: "关联规范事件" },
      { name: "status", description: "open → acknowledged / in_progress → resolved / cancelled；urgent 任务禁止取消" },
    ],
  },
  {
    name: "AgentInput",
    authority: "后端按最小必要原则组装，不发送原始健康文件或原始语音",
    fields: [
      { name: "daily_snapshot / personal_baseline", description: "日聚合数据与个人基线" },
      { name: "active_events", description: "已清洗的活跃事件" },
      { name: "risk_result", description: "服务器锁定的风险结论" },
    ],
  },
  {
    name: "AgentOutput",
    authority: "QwenPaw + GLM-5.2 只做多角色摘要；后端严格 Schema 验证",
    fields: [
      { name: "status_level / risk_score / key_reasons / recommended_action", description: "必须原样复制 RiskResult 的四个锁定字段" },
      { name: "caregiver_summary / family_summary / institution_summary", description: "三端差异化摘要" },
      { name: "safety_disclaimer", description: "固定非医疗诊断声明" },
    ],
  },
] as const;

export const API_CONTRACTS = [
  "GET /api/health",
  "GET /api/elders",
  "GET /api/elders/:id",
  "GET /api/dashboard",
  "GET /api/elders/:id/dashboard",
  "POST /api/events",
  "PATCH /api/tasks/:id",
  "POST /api/import/daily-snapshots-csv/preview",
  "POST /api/import/daily-snapshots-csv",
  "GET /api/import/daily-snapshots-csv/history",
] as const;

export interface PilotStep {
  order: number;
  title: string;
  status: "未开始";
  evidenceNeeded: string;
}

export const PILOT_STEPS: readonly PilotStep[] = [
  { order: 1, title: "团队成员测试", status: "未开始", evidenceNeeded: "使用虚构资料与 TEST001 验证主链路" },
  { order: 2, title: "工作人员或志愿者封闭测试", status: "未开始", evidenceNeeded: "在非长者主体上验证可用性和处置流程" },
  { order: 3, title: "机构访谈", status: "未开始", evidenceNeeded: "记录真实需求，不把访谈模板当作已完成证据" },
  { order: 4, title: "授权与安全审查", status: "未开始", evidenceNeeded: "确认角色权限、保存期限、撤回和应急边界" },
  { order: 5, title: "评估真实长者试戴", status: "未开始", evidenceNeeded: "仅在前四步完成并获正式批准后评估" },
] as const;
