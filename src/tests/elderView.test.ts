import { describe, expect, it } from "vitest";
import { getRuntimeStatusText } from "../components/AppShell";
import { getElderViewModel } from "../lib/elderView";
import { createInitialDemoState } from "../store/demoStore";

describe("elder view routing safeguards", () => {
  it("resolves TEST001 to team Apple Watch mock data in static fallback mode", () => {
    const state = createInitialDemoState();
    const view = getElderViewModel(state, "TEST001");

    expect(view.found).toBe(true);
    if (!view.found) return;
    expect(view.profile.elderId).toBe("TEST001");
    expect(view.profile.subjectKind).toBe("team_test");
    expect(view.profile.name).toBe("團隊 Apple Watch 測試資料");
    expect(view.profile.riskTags).toContain("非真實長者");
    expect(view.snapshot.dataSource).toBe("Apple Health Export");
    expect(view.snapshot.dataQuality).toBeGreaterThan(0);
    expect(view.baseline.baselineLabel).toBe("7日基線");
  });

  it("does not fallback to E001 when an unknown elderId is requested", () => {
    const state = createInitialDemoState();
    const view = getElderViewModel(state, "UNKNOWN");

    expect(view.found).toBe(false);
    expect(state.profiles.E001.name).toBe("陈伯");
  });

  it("keeps TEST001 separate from Chen's care-loop story", () => {
    const state = createInitialDemoState();
    const testView = getElderViewModel(state, "TEST001");
    const chenView = getElderViewModel(state, "E001");

    expect(testView.found && testView.profile.name).toBe("團隊 Apple Watch 測試資料");
    expect(chenView.found && chenView.profile.name).toBe("陈伯");
    expect(
      state.tasks.some((task) => task.elderId === "TEST001" && task.title.includes("陈伯")),
    ).toBe(false);
  });

  it("labels GitHub Pages as a static preview using mock fallback", () => {
    const runtime = getRuntimeStatusText("unavailable", {
      hostname: "foxian-aaron.github.io",
      pathname: "/careband-agent-demo/v0.2/",
    });

    expect(runtime.isGitHubPagesPreview).toBe(true);
    expect(runtime.previewText).toContain("GitHub Pages 靜態預覽版");
    expect(runtime.backendText).toContain("後端未連接");
  });
});
