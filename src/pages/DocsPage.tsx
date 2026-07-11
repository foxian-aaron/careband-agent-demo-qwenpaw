import { MedicalDisclaimer } from "../components/MedicalDisclaimer";

export const DocsPage = () => (
  <div className="page docs-page">
    <header className="page-header">
      <div>
        <span>项目说明 / Demo Evidence</span>
        <h1>智护环 CareBand Agent v0.2</h1>
        <p>这里说明当前真正跑通的链路、可见 fallback，以及仍需要外部条件的实体与真实 Agent 验收。</p>
      </div>
    </header>

    <section className="panel docs-section">
      <h2>比赛主链路</h2>
      <ol>
        <li>机构端查看多长者风险热力图，并进入陈伯 E001 驾驶舱。</li>
        <li>展示 DailySnapshot、数据来源、质量、七日个人基线和当日偏离。</li>
        <li>通过硬件模拟器或实体 ESP32 提交规范 SOS / 确认事件。</li>
        <li>后端入库并由确定性规则引擎计算六级风险；SOS 必须升级为 urgent。</li>
        <li>Agent 只生成护工、家属和机构三端摘要，不得修改规则结果。</li>
        <li>护工接单、查看、确认用药并完成任务；关联事件同步解决。</li>
        <li>家属安心卡和机构统计刷新为已跟进状态。</li>
      </ol>
    </section>

    <section className="panel docs-section">
      <h2>当前实现状态</h2>
      <ul className="insight-list">
        <li>CSV：真实文件选择、预览、确认、幂等覆盖、错误提示与导入历史。</li>
        <li>Apple Health：TEST001 团队聚合数据，仅作技术证据，不计入机构运营人数。</li>
        <li>事件：七种规范类型，旧事件名只在 API 入口兼容；模拟器以 source=mock 明确标识。</li>
        <li>Agent：已实现 qwenpaw / openai / mock Provider、SSE、重试、Schema 与安全校验。</li>
        <li>Fallback：真实 Provider 离线、超时、凭据失败或输出不合法时，明确显示 Mock fallback。</li>
        <li>硬件：ESP32-S3 固件可编译；实体按钮、LED、震动和 Wi-Fi 闭环仍需接板验收。</li>
      </ul>
    </section>

    <section className="panel docs-section">
      <h2>风险与数据边界</h2>
      <p>
        风险状态固定为 data_insufficient、stable、observation、attention、high_risk 和 urgent。
        规则引擎先处理 SOS、高置信跌倒和数据不足，再比较步数、睡眠、静息心率、活动分钟、症状与用药确认。
        已解决或过期事件不会继续抬高风险。
      </p>
      <p>
        Agent 只接收每日聚合快照、七日基线、已脱敏事件和规则结果。原始 Apple Health XML、完整语音、精确坐标、地址、密钥和内部档案不会进入模型输入。
      </p>
    </section>

    <section className="panel docs-section">
      <h2>QwenPaw 真实状态</h2>
      <p>
        后端已经连接本机 QwenPaw 的 <code>/api/agent/process</code> SSE 接口，并使用专用
        <code>careband_summary_agent</code>。当前机器的阿里模型凭据返回 401，因此现有页面和录像会诚实显示
        <strong>Mock fallback</strong>；更新凭据并出现 provider=qwenpaw、fallback=false、validation=valid 后，才算真实 Agent 验收通过。
      </p>
    </section>

    <section className="panel docs-section">
      <h2>记忆与隐私</h2>
      <p>
        记忆初始化当前只做文字 Mock 提取。每条草稿必须人工确认或拒绝后才能保存；只保存确认项，并从确认项重建风险关注、沟通、用药和家属通知偏好。AI 草稿不能直接修改风险，也不构成医疗记录。
      </p>
      <p>
        位置默认只保存区域与安全区状态；语音只保存限长摘要；录音同意、撤回和删除模板位于项目文档中。这些模板不构成法律意见。
      </p>
    </section>

    <MedicalDisclaimer />
  </div>
);
