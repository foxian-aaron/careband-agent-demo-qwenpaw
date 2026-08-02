import { useState } from "react";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import {
  analyzeElderVoiceCompanion,
  appendVoiceSessionExchange,
  type ElderVoiceCompanionResult,
  type VoiceSessionMessage,
} from "../lib/elderVoiceCompanion";
import { useDemo } from "../store/demoStore";

interface ElderVoiceCompanionPageProps {
  elderId: string;
}

const scenarios = [
  ["日常陪伴", "今天想聊聊天"],
  ["身体不适", "我有点头晕"],
  ["用药询问", "我今天吃药了吗"],
  ["往事回忆", "我年轻时在码头工作"],
  ["孤独表达", "我有点寂寞，想找人说话"],
  ["位置困惑", "我不知道在哪里"],
  ["请求护工", "我想找护工"],
  ["一般表达", "今天天气不错"],
] as const;

export const ElderVoiceCompanionPage = ({ elderId }: ElderVoiceCompanionPageProps) => {
  const { state, dispatch } = useDemo();
  const profile = state.profiles[elderId];
  const snapshot = state.snapshots[elderId];
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<VoiceSessionMessage[]>([]);
  const [latestResult, setLatestResult] = useState<ElderVoiceCompanionResult | null>(null);
  const connectedMode = state.backend.mode === "backend";

  if (!profile) {
    return (
      <div className="page">
        <section className="panel">
          <h1>未找到长者</h1>
          <p>长者 ID “{elderId}” 不存在，系统不会自动回退到其他档案。</p>
          <a className="primary-link" href="#/institution">返回机构总览</a>
        </section>
      </div>
    );
  }

  const submit = (candidate: string) => {
    const rawText = candidate.trim().slice(0, 500);
    if (!rawText) return;
    const result = analyzeElderVoiceCompanion({
      elderId,
      rawText,
      context: {
        medicationEvening: snapshot?.medicationEvening,
        locationZone: snapshot?.locationZone,
      },
    });
    const stamp = Date.now();
    setMessages((current) => appendVoiceSessionExchange(current, rawText, result.assistantReply, String(stamp)));
    setLatestResult(result);
    setInputText("");
    if (!connectedMode) {
      dispatch({
        type: "ADD_VOICE_COMPANION_RESULT",
        elderId,
        signal: result.signal,
        memoryDrafts: result.memoryDrafts,
      });
    }
  };

  const storedSignals = state.voiceSignalsByElderId[elderId] ?? [];
  const storedDrafts = state.voiceMemoryDraftsByElderId[elderId] ?? [];
  const signal = latestResult?.signal ?? storedSignals[storedSignals.length - 1];

  return (
    <div className="page voice-companion-page">
      <header className="page-header">
        <div>
          <span>Stage 12｜长者陪伴</span>
          <h1>{profile.name}的语音陪伴文字模拟</h1>
          <p>当前仅用文字模拟表达，不使用麦克风、ASR 或 TTS。</p>
        </div>
        <a className="primary-link" href={`#/elder/${elderId}/profile`}>返回长者档案</a>
      </header>

      <section className="panel voice-privacy-notice">
        <strong>原话仅保留在当前页面会话</strong>
        <p>Store、localStorage 和照护记录只保存限长结构化摘要（summary_only）；本功能不构成医疗诊断。</p>
        {connectedMode ? <p><strong>Connected 模式仅在本页生成本地 Mock 建议，不写入后端，也不代表已经通知护工。</strong></p> : null}
      </section>

      <section className="voice-companion-grid">
        <article className="panel">
          <div className="section-title">
            <span>当前会话</span>
            <h2>让长者慢慢说</h2>
          </div>
          <div className="voice-session" aria-live="polite">
            {messages.length === 0 ? <p className="muted-copy">可输入一句话，或选择下方演示场景。</p> : null}
            {messages.map((message) => (
              <div className={`voice-message voice-message--${message.role}`} key={message.id}>
                <strong>{message.role === "elder" ? profile.name : "陪伴助手"}</strong>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <label className="voice-input">
            <span>文字模拟输入（最多 500 字）</span>
            <textarea
              aria-label="长者语音文字模拟"
              maxLength={500}
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="例如：今天想聊聊天"
            />
          </label>
          <div className="button-row">
            <button className="primary" onClick={() => submit(inputText)}>生成照护摘要</button>
            <button onClick={() => { setMessages([]); setLatestResult(null); setInputText(""); }}>清空本页会话</button>
          </div>
          <div className="voice-scenarios" aria-label="八类陪伴场景">
            {scenarios.map(([label, text]) => (
              <button key={label} onClick={() => submit(text)}>
                <strong>{label}</strong>
                <span>{text}</span>
              </button>
            ))}
          </div>
        </article>

        <aside className="panel">
          <div className="section-title">
            <span>结构化照护信号</span>
            <h2>摘要不替代规则风险</h2>
          </div>
          {signal ? (
            <dl className="voice-signal">
              <div><dt>意图</dt><dd>{signal.detectedIntent}</dd></div>
              <div><dt>复核等级</dt><dd>{signal.attentionLevel}</dd></div>
              <div><dt>照护摘要</dt><dd>{signal.transcriptSummary}</dd></div>
              <div><dt>保留策略</dt><dd>{signal.retentionPolicy}</dd></div>
              <div><dt>建议人工通知</dt><dd>{signal.shouldNotifyCaregiver ? "是" : "否"}</dd></div>
            </dl>
          ) : <p className="muted-copy">尚未生成结构化信号。</p>}
          <p className="muted-copy">立即复核只表示需要人工查看，不等于 urgent，也不会修改规则引擎结果。</p>
        </aside>
      </section>

      <section className="panel">
        <div className="section-title">
          <span>Pending memory</span>
          <h2>待护工确认的陪伴记忆草稿</h2>
        </div>
        {storedDrafts.length === 0 ? <p className="muted-copy">暂无草稿。往事、偏好或孤独节律可能产生固定摘要草稿。</p> : (
          <ul className="voice-draft-list">
            {storedDrafts.map((draft) => (
              <li key={draft.id}>
                <strong>{draft.memoryType}</strong>
                <span>{draft.contentSummary}</span>
                <small>状态：pending｜可见范围将在 Stage 13 授权后执行</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MedicalDisclaimer />
    </div>
  );
};
