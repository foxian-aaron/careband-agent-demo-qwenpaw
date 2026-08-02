import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(file, "utf8");

describe("role-specific Agent summary surfaces", () => {
  it("labels real QwenPaw IO separately from deterministic Mock IO", () => {
    const panel = read("src/components/AgentIOPanel.tsx");
    expect(panel).toContain('summaries.agentSource === "qwenpaw"');
    expect(panel).toContain("QwenPaw / GLM-5.2 Agent IO");
    expect(panel).toContain("安全合同摘要（非原始 Prompt）");
    expect(panel).toContain("原始 Prompt/Response 不持久化、不回传前端");
    expect(panel).toContain("const io = isRealQwenPaw");
    expect(panel).not.toContain("服务端 Agent 上下文预览");
    expect(panel).not.toContain("<span>Mock QwenPaw Agent IO</span>");
  });

  it("shows the caregiver-specific summary on the caregiver page", () => {
    const page = read("src/pages/CaregiverPage.tsx");
    expect(page).toContain("getAgentSummariesForElder");
    expect(page).toContain("caregiverSummary.caregiverSummary");
    expect(page).toContain("QwenPaw / GLM-5.2 护工摘要");
  });

  it("identifies the elder attached to the institution summary", () => {
    const page = read("src/pages/InstitutionPage.tsx");
    expect(page).toContain("topAgentElder");
    expect(page).toContain("重点个案摘要：");
  });
});
