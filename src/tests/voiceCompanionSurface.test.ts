import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { renderRoute } from "../App";

describe("voice companion surface", () => {
  it("exposes the route and profile entry with privacy copy", () => {
    const app = fs.readFileSync("src/App.tsx", "utf8");
    const profile = fs.readFileSync("src/pages/ElderProfilePage.tsx", "utf8");
    const page = fs.readFileSync("src/pages/ElderVoiceCompanionPage.tsx", "utf8");
    expect(app).toContain("/voice");
    expect(profile).toContain("/voice");
    expect(page).toContain("原话仅保留在当前页面会话");
    expect(page).toContain("不使用麦克风、ASR 或 TTS");
    expect(page).toContain("Connected 模式仅在本页生成本地 Mock 建议");
    expect(page).toContain("建议人工通知");
    expect(page).toContain("if (!connectedMode)");
    const unknownRoute = renderRoute("/elder/UNKNOWN/voice");
    expect(unknownRoute.props.elderId).toBe("UNKNOWN");
    const family = fs.readFileSync("src/pages/FamilyPage.tsx", "utf8");
    expect(family).not.toMatch(/voiceSignalsByElderId|voiceMemoryDraftsByElderId|transcriptSummary/);
  });
});
