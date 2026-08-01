import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { renderRoute } from "../App";
import { doctorSummaryLabel } from "../components/profile/ConsentStatusCard";
import { canManagePrivacy } from "../pages/ConsentPrivacyPage";

const read = (relative: string) => fs.readFileSync(relative, "utf8");

describe("consent privacy surface", () => {
  it("exposes the #/elder/:elderId/privacy route and a profile entry", () => {
    const app = read("src/App.tsx");
    const profile = read("src/pages/ElderProfilePage.tsx");
    const consentCard = read("src/components/profile/ConsentStatusCard.tsx");
    expect(app).toContain("/privacy");
    expect(profile).toContain("/privacy");
    expect(consentCard).toContain("/privacy");
    const unknownRoute = renderRoute("/elder/UNKNOWN/privacy");
    expect(unknownRoute.props.elderId).toBe("UNKNOWN");
    expect(unknownRoute.props.viewerRole).toBe("elder");
    const familyRoute = renderRoute("/family/E001/privacy");
    expect(familyRoute.props.viewerRole).toBe("family");
    const caregiverRoute = renderRoute("/caregiver/elder/E001/privacy");
    expect(caregiverRoute.props.viewerRole).toBe("caregiver");
    expect(canManagePrivacy("elder")).toBe(false);
    expect(canManagePrivacy("family")).toBe(false);
    expect(canManagePrivacy("caregiver")).toBe(true);
  });

  it("privacy page explains the data boundary and marks session-only / connected-mode", () => {
    const page = read("src/pages/ConsentPrivacyPage.tsx");
    expect(page).toContain("角色可见范围");
    expect(page).toContain("语音原文不保存");
    expect(page).toContain("Apple Health XML 不送模型");
    expect(page).toContain("位置仅区域");
    expect(page).toContain("撤回");
    expect(page).toContain("数据不足不强行判断");
    expect(page).toContain("仅当前会话有效");
    expect(page).toContain("不开放本地授权");
    expect(page).toContain("长者与家属端为只读隐私说明");
    expect(page).not.toContain('actorRole: "caregiver"');
    expect(page).toContain("grantFamilyConsentByCaregiver");
    expect(page).toContain("revokeFamilyConsentByCaregiver");
    expect(page).toContain("reviewVoiceDraftByCaregiver");
    expect(page).toContain("模拟授权家属");
  });

  it("privacy page never auto-confirms and requires caregiver action", () => {
    const page = read("src/pages/ConsentPrivacyPage.tsx");
    expect(page).toContain("不会自动确认");
    expect(page).toContain("护工人工确认");
  });

  it("family page does not fall back to E001 for unknown elders", () => {
    const family = read("src/pages/FamilyPage.tsx");
    expect(family).not.toMatch(/profiles\.E001/);
    expect(family).not.toMatch(/\?\?\s*state\.profiles\.E001/);
    expect(family).toContain("未找到该长者");
    // the unknown elder must be the one passed in, not a redirect
    const unknownRoute = renderRoute("/family/NOPE");
    expect(unknownRoute.props.elderId).toBe("NOPE");
  });

  it("family page surface never leaks raw transcript, confidence, or attention level", () => {
    const family = read("src/pages/FamilyPage.tsx");
    const peaceCard = read("src/components/FamilyPeaceCard.tsx");
    const voiceCard = read("src/components/FamilyVoiceMemoryCard.tsx");
    for (const source of [family, peaceCard, voiceCard]) {
      expect(source).not.toMatch(/voiceSignalsByElderId/);
      expect(source).not.toMatch(/voiceMemoryDraftsByElderId/);
      expect(source).not.toMatch(/transcriptSummary/);
      expect(source).not.toMatch(/attentionLevel/);
      expect(source).not.toMatch(/\.confidence/);
      expect(source).not.toMatch(/rawText/);
    }
  });

  it("family voice card receives only summary strings, never draft objects", () => {
    const voiceCard = read("src/components/FamilyVoiceMemoryCard.tsx");
    expect(voiceCard).toContain("summaries");
    expect(voiceCard).not.toMatch(/VoiceMemoryDraft/);
    expect(voiceCard).not.toMatch(/contentSummary/);
  });

  it("family peace card gates location and medication by consent (fail closed)", () => {
    const peaceCard = read("src/components/FamilyPeaceCard.tsx");
    expect(peaceCard).toContain("familyCanViewLocationZone");
    expect(peaceCard).toContain('locationPrecision === "zone_only"');
    expect(peaceCard).toContain("familyCanViewMedicationStatus");
    expect(peaceCard).toContain("需授权");
    // precise coordinates are never surfaced
    expect(peaceCard).not.toMatch(/locationPrecision.*precise/);
  });

  it("family daily card fails closed on familyCanViewDailyStatus", () => {
    const family = read("src/pages/FamilyPage.tsx");
    expect(family).toContain("familyCanViewDailyStatus");
    expect(family).toContain("暂未授权可见");
  });

  it("consent status card shows the voice-summary consent field", () => {
    const consentCard = read("src/components/profile/ConsentStatusCard.tsx");
    expect(consentCard).toContain("familyCanViewVoiceSummary");
    expect(consentCard).toContain("语音摘要");
  });

  it("doctor summary consent label fails closed when consent is absent", () => {
    expect(doctorSummaryLabel(undefined)).toBe("未授权");
  });
});
