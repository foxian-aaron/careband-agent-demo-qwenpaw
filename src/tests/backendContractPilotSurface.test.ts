import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { renderRoute } from "../App";
import { BackendContractPage } from "../pages/BackendContractPage";
import { PilotPlanPage } from "../pages/PilotPlanPage";
import {
  API_CONTRACTS,
  DOMAIN_CONTRACTS,
  PILOT_STEPS,
} from "../data/backendContract";

const read = (relative: string) => fs.readFileSync(relative, "utf8");

describe("backend contract & pilot plan — routing", () => {
  it("renders BackendContractPage for #/backend-contract", () => {
    const route = renderRoute("/backend-contract");
    expect(route.type).toBe(BackendContractPage);
  });

  it("renders PilotPlanPage for #/pilot-plan", () => {
    const route = renderRoute("/pilot-plan");
    expect(route.type).toBe(PilotPlanPage);
  });

  it("preserves all existing routes in App.tsx", () => {
    const app = read("src/App.tsx");
    expect(app).toContain("/institution");
    expect(app).toContain("/caregiver");
    expect(app).toContain("/event-simulator");
    expect(app).toContain("/demo-control");
    expect(app).toContain("/docs");
    expect(app).toContain("/medication/");
    expect(app).toContain("/family/");
    expect(app).toContain("/elder/");
    expect(app).toContain("/privacy");
    expect(app).toContain("/memory-intake");
    expect(app).toContain("/voice");
    expect(app).toContain("/wearable-import");
    expect(app).toContain("/backend-contract");
    expect(app).toContain("/pilot-plan");
  });

  it("navigation exposes both new links and keeps old ones", () => {
    const nav = read("src/components/Navigation.tsx");
    expect(nav).toContain("#/backend-contract");
    expect(nav).toContain("#/pilot-plan");
    expect(nav).toContain("后端契约");
    expect(nav).toContain("试点计划");
    expect(nav).toContain("#/institution");
    expect(nav).toContain("#/docs");
  });
});

describe("backend contract page — honest surface", () => {
  it("reads backend state read-only without dispatching or fetching", () => {
    const page = read("src/pages/BackendContractPage.tsx");
    expect(page).toContain("state.backend");
    expect(page).toContain("backend.status");
    expect(page).toContain("backend.mode");
    expect(page).toContain("lastSyncedAt");
    // read-only: must not dispatch or call any API action
    expect(page).not.toMatch(/dispatch\(/);
    expect(page).not.toMatch(/fetchDashboard/);
    expect(page).not.toMatch(/postEvent/);
    expect(page).not.toMatch(/patchTask/);
    expect(page).not.toMatch(/\bfetch\s*\(/);
    expect(page).not.toMatch(/localStorage/);
    expect(page).not.toMatch(/sessionStorage/);
  });

  it("states mock / static pages are not Express / SQLite / Agent", () => {
    const page = read("src/pages/BackendContractPage.tsx");
    expect(page).toContain("Express");
    expect(page).toContain("SQLite");
    expect(page).toContain("Agent");
    expect(page).toContain("Mock");
    expect(page).toContain("静态");
  });

  it("renders all six contract types via DOMAIN_CONTRACTS", () => {
    const page = read("src/pages/BackendContractPage.tsx");
    const data = read("src/data/backendContract.ts");
    expect(page).toContain("DOMAIN_CONTRACTS");
    for (const contract of DOMAIN_CONTRACTS) {
      expect(data).toContain(contract.name);
    }
  });

  it("renders the full API endpoint list via API_CONTRACTS", () => {
    const page = read("src/pages/BackendContractPage.tsx");
    const data = read("src/data/backendContract.ts");
    expect(page).toContain("API_CONTRACTS");
    for (const api of API_CONTRACTS) {
      expect(data).toContain(api);
    }
  });

  it("documents the four risk authority fields and Agent-only-summarizes note", () => {
    const page = read("src/pages/BackendContractPage.tsx");
    expect(page).toContain("后端规则引擎");
    expect(page).toContain("摘要");
  });

  it("includes the medical disclaimer", () => {
    const page = read("src/pages/BackendContractPage.tsx");
    expect(page).toContain("MedicalDisclaimer");
  });
});

describe("pilot plan page — honest future-only surface", () => {
  it("renders all five steps via PILOT_STEPS with not-started status", () => {
    const page = read("src/pages/PilotPlanPage.tsx");
    const data = read("src/data/backendContract.ts");
    expect(page).toContain("PILOT_STEPS");
    for (const step of PILOT_STEPS) {
      expect(data).toContain(step.title);
    }
    expect(page).toContain("计划中");
    expect(page).toContain("未开始");
  });

  it("displays steps in the required order", () => {
    const page = read("src/pages/PilotPlanPage.tsx");
    expect(page).toContain("PILOT_STEPS.map");
    expect(PILOT_STEPS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
    expect(PILOT_STEPS.map((s) => s.title)).toEqual([
      "团队成员测试",
      "工作人员或志愿者封闭测试",
      "机构访谈",
      "授权与安全审查",
      "评估真实长者试戴",
    ]);
  });

  it("never claims interviews, pilot, or deployment are done", () => {
    const page = read("src/pages/PilotPlanPage.tsx");
    expect(page).not.toMatch(/已访谈/);
    expect(page).not.toMatch(/已完成.*访谈/);
    expect(page).not.toMatch(/已部署/);
    expect(page).not.toMatch(/已试点/);
    expect(page).not.toMatch(/正在试点/);
  });

  it("includes the medical disclaimer and no-real-data notice", () => {
    const page = read("src/pages/PilotPlanPage.tsx");
    expect(page).toContain("MedicalDisclaimer");
    expect(page).toContain("虚构");
    expect(page).toMatch(/真实|长者健康/);
  });
});
