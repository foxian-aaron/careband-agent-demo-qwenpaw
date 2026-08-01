interface FamilyVoiceMemoryCardProps {
  /** Pre-gated, family-safe fixed summary strings only — no raw transcript,
   * no confidence, no internal attention level. Empty array renders nothing. */
  summaries: string[];
}

/**
 * Stage 13 — the only voice content a family member can ever see. It receives
 * the already-gated fixed summary strings (never the underlying draft objects),
 * so the original words, the model confidence, and the internal attention level
 * can never leak through this surface.
 */
export const FamilyVoiceMemoryCard = ({ summaries }: FamilyVoiceMemoryCardProps) => {
  if (summaries.length === 0) return null;
  return (
    <section className="panel family-voice-summary">
      <div className="section-title">
        <span>陪伴摘要</span>
        <h2>语音陪伴的家属可见摘要</h2>
      </div>
      <ul className="family-voice-list">
        {summaries.map((summary) => (
          <li key={summary}>{summary}</li>
        ))}
      </ul>
      <p className="muted-copy">
        仅展示经授权并由护工人工确认后的固定摘要，不含原话、置信度或内部照护判断。
      </p>
    </section>
  );
};
