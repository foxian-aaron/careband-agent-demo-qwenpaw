import { useMemo, useState } from "react";
import { MedicalDisclaimer } from "../components/MedicalDisclaimer";
import {
  createMemoryDraft,
  isMemoryDraftFullyReviewed,
  MAX_MEMORY_INPUT_LENGTH,
} from "../lib/memoryIntake";
import { useDemo } from "../store/demoStore";
import type { MemorySourceType } from "../types";

interface MemoryIntakePageProps {
  elderId: string;
}

const sample = "陈伯平时习惯用粤语沟通，晚药需要提醒，夜间起床时要留意行动安全，女儿希望异常时收到通知。";

const sourceOptions: Array<{ value: MemorySourceType; label: string }> = [
  { value: "family_oral", label: "家属口述" },
  { value: "caregiver_input", label: "护工录入" },
  { value: "institution_record", label: "机构记录" },
];

const categoryLabels = {
  general_context: "一般照护背景",
  communication_preference: "沟通偏好",
  medication_routine: "用药提醒习惯",
  safety_observation: "安全观察重点",
  family_preference: "家属联系偏好",
};

const statusLabels = {
  pending: "待确认",
  confirmed: "已确认",
  rejected: "已拒绝",
};

export const MemoryIntakePage = ({ elderId }: MemoryIntakePageProps) => {
  const { state, dispatch } = useDemo();
  const profile = state.profiles[elderId];
  const draft = state.memoryDraftsByElderId[elderId];
  const savedMemory = state.careMemoriesByElderId[elderId];
  const [sourceType, setSourceType] = useState<MemorySourceType>("family_oral");
  const [input, setInput] = useState(sample);
  const [feedback, setFeedback] = useState("");
  const canSave = useMemo(
    () => Boolean(draft && isMemoryDraftFullyReviewed(draft)),
    [draft],
  );
  const mockMode = state.backend.mode === "mock";

  if (!profile) {
    return (
      <div className="page">
        <section className="panel empty-state">
          <strong>未找到长者档案</strong>
          <p>请从机构端选择有效的虚构长者后再初始化照护记忆。</p>
        </section>
      </div>
    );
  }

  const generateDraft = () => {
    if (!mockMode || !input.trim()) return;
    dispatch({
      type: "CREATE_MEMORY_DRAFT",
      draft: createMemoryDraft(elderId, input, sourceType, new Date().toISOString()),
    });
    setFeedback("已生成结构化待确认草稿；原始录入文字未写入 Demo Store。 ");
  };

  const review = (itemId: string, status: "confirmed" | "rejected") => {
    dispatch({
      type: "REVIEW_MEMORY_ITEM",
      elderId,
      itemId,
      status,
      updatedAt: new Date().toISOString(),
    });
    setFeedback("");
  };

  const save = () => {
    if (!canSave || !mockMode) return;
    dispatch({ type: "SAVE_CARE_MEMORY", elderId, confirmedAt: new Date().toISOString() });
    setFeedback("正式照护记忆已保存；仅保留人工确认条目。 ");
  };

  return (
    <div className="page memory-intake-page">
      <header className="page-header">
        <div>
          <span>Care Memory Intake</span>
          <h1>{profile.name}的长者记忆初始化</h1>
          <p>将虚构照护资料整理成草稿，并由护工逐条确认后保存。</p>
        </div>
        <a className="primary-link" href={`#/elder/${elderId}/profile`}>返回长者档案</a>
      </header>

      <section className="panel memory-privacy-notice">
        <strong>Mock 结构化草稿</strong>
        <p>当前不调用真实 Agent。原始文字只存在本页面会话，不进入 localStorage、SQLite、事件或 Agent 日志。</p>
        {!mockMode ? <p className="import-feedback import-feedback--error">后端连接模式暂不开放此 Mock 写入流程。</p> : null}
      </section>

      <section className="panel memory-intake-form">
        <div className="section-title">
          <span>资料输入</span>
          <h2>生成待确认草稿</h2>
        </div>
        <label>
          <span>资料来源</span>
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value as MemorySourceType)}>
            {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>虚构照护资料（最多 {MAX_MEMORY_INPUT_LENGTH} 字）</span>
          <textarea
            aria-label="虚构照护资料"
            maxLength={MAX_MEMORY_INPUT_LENGTH}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <div className="memory-input-footer">
          <span>{input.length}/{MAX_MEMORY_INPUT_LENGTH}</span>
          <div className="button-row">
            <button type="button" onClick={() => setInput(sample)}>填入虚构示例</button>
            <button className="primary" type="button" disabled={!mockMode || !input.trim()} onClick={generateDraft}>生成草稿</button>
          </div>
        </div>
      </section>

      {draft ? (
        <section className="panel">
          <div className="section-title">
            <span>人工确认</span>
            <h2>逐条确认或拒绝</h2>
          </div>
          <div className="memory-review-list">
            {draft.items.map((item) => (
              <article className="memory-review-item" key={item.id}>
                <div>
                  <strong>{categoryLabels[item.category]}</strong>
                  <p>{item.content}</p>
                  <small>来源：{sourceOptions.find((option) => option.value === item.sourceType)?.label} · 置信度：{Math.round(item.confidence * 100)}% · 家属默认不可见</small>
                </div>
                <div className="memory-review-actions">
                  <span className={`memory-status memory-status--${item.reviewStatus}`}>{statusLabels[item.reviewStatus]}</span>
                  <button type="button" onClick={() => review(item.id, "confirmed")}>确认</button>
                  <button type="button" onClick={() => review(item.id, "rejected")}>拒绝</button>
                </div>
              </article>
            ))}
          </div>
          <div className="memory-save-row">
            <p>{canSave ? "全部条目已复核，可以保存。" : "仍有待确认条目，暂不能保存。"}</p>
            <button className="primary" type="button" disabled={!mockMode || !canSave} onClick={save}>保存正式照护记忆</button>
          </div>
          {feedback ? <p className="import-feedback import-feedback--success" role="status" aria-live="polite">{feedback}</p> : null}
        </section>
      ) : null}

      {savedMemory ? (
        <section className="panel">
          <div className="section-title">
            <span>已确认资料</span>
            <h2>正式照护记忆（{savedMemory.items.length} 条）</h2>
          </div>
          {savedMemory.items.length > 0 ? (
            <ul className="memory-confirmed-list">
              {savedMemory.items.map((item) => <li key={item.id}>{item.content}</li>)}
            </ul>
          ) : <p className="muted-copy">本轮所有草稿均被拒绝，正式记忆为空。</p>}
          <p className="muted-copy">仅护工与机构可见；不会改变任何风险等级或建议动作。</p>
        </section>
      ) : null}

      <MedicalDisclaimer />
    </div>
  );
};
