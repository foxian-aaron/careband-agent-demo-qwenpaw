import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  API_CONTRACTS,
  DOMAIN_CONTRACTS,
  PILOT_STEPS,
} from "../data/backendContract";

const CONTRACT_NAMES = DOMAIN_CONTRACTS.map((c) => c.name);

describe("backend contract — six domain contract types", () => {
  it("exposes exactly six contract types with canonical names", () => {
    expect(DOMAIN_CONTRACTS).toHaveLength(6);
    expect(CONTRACT_NAMES).toEqual([
      "DailySnapshot",
      "CareEvent",
      "RiskResult",
      "CareTask",
      "AgentInput",
      "AgentOutput",
    ]);
  });

  it("every contract type has an authority and at least one core field", () => {
    for (const contract of DOMAIN_CONTRACTS) {
      expect(contract.authority.length).toBeGreaterThan(0);
      expect(contract.fields.length).toBeGreaterThanOrEqual(1);
      for (const field of contract.fields) {
        expect(field.name.length).toBeGreaterThan(0);
        expect(field.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("RiskResult authority delegates risk to the backend rule engine", () => {
    const risk = DOMAIN_CONTRACTS.find((c) => c.name === "RiskResult")!;
    expect(risk.authority).toContain("后端");
    expect(risk.authority).toContain("规则引擎");
  });

  it("AgentOutput authority only summarizes and never decides risk", () => {
    const output = DOMAIN_CONTRACTS.find((c) => c.name === "AgentOutput")!;
    expect(output.authority).toContain("摘要");
    // must reference schema validation or locked risk — never claim to decide risk
    expect(output.authority).toMatch(/Schema|锁定|原样复制|无权/);
  });

  it("uses the authoritative backend field names", () => {
    const snapshots = DOMAIN_CONTRACTS.find((c) => c.name === "DailySnapshot")!;
    const input = DOMAIN_CONTRACTS.find((c) => c.name === "AgentInput")!;
    const output = DOMAIN_CONTRACTS.find((c) => c.name === "AgentOutput")!;
    expect(snapshots.fields.map((field) => field.name).join(" ")).toContain("sleep_duration");
    expect(input.fields.map((field) => field.name)).toEqual([
      "daily_snapshot / personal_baseline",
      "active_events",
      "risk_result",
    ]);
    expect(output.fields.map((field) => field.name).join(" ")).toContain("caregiver_summary");
    expect(output.fields.map((field) => field.name).join(" ")).toContain("institution_summary");
  });
});

describe("backend contract — API endpoint list", () => {
  it("lists only the existing API contracts", () => {
    expect(API_CONTRACTS).toContain("GET /api/health");
    expect(API_CONTRACTS).toContain("GET /api/elders");
    expect(API_CONTRACTS).toContain("GET /api/elders/:id");
    expect(API_CONTRACTS).toContain("GET /api/dashboard");
    expect(API_CONTRACTS).toContain("GET /api/elders/:id/dashboard");
    expect(API_CONTRACTS).toContain("POST /api/events");
    expect(API_CONTRACTS).toContain("PATCH /api/tasks/:id");
    expect(API_CONTRACTS).toContain("POST /api/import/daily-snapshots-csv/preview");
    expect(API_CONTRACTS).toContain("POST /api/import/daily-snapshots-csv");
    expect(API_CONTRACTS).toContain("GET /api/import/daily-snapshots-csv/history");
  });
});

describe("backend contract — risk authority fields (page-level)", () => {
  // The BackendContractPage documents four risk fields owned exclusively by
  // the backend rule engine. They are rendered as inline <code> in the page.
  it("the four backend-owned risk fields are documented", () => {
    const page = fs.readFileSync(
      "src/pages/BackendContractPage.tsx",
      "utf8",
    );
    expect(page).toContain("status_level");
    expect(page).toContain("risk_score");
    expect(page).toContain("key_reasons");
    expect(page).toContain("recommended_action");
    expect(page).toContain("后端规则引擎");
  });
});

describe("pilot plan — five ordered steps all not started", () => {
  it("exposes exactly five steps in sequential order", () => {
    expect(PILOT_STEPS).toHaveLength(5);
    expect(PILOT_STEPS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it("step order matches the required sequence", () => {
    expect(PILOT_STEPS[0].title).toContain("团队成员测试");
    expect(PILOT_STEPS[1].title).toContain("工作人员或志愿者");
    expect(PILOT_STEPS[2].title).toContain("机构访谈");
    expect(PILOT_STEPS[3].title).toContain("授权与安全审查");
    expect(PILOT_STEPS[4].title).toContain("评估真实长者试戴");
  });

  it("every step is marked as not started", () => {
    for (const step of PILOT_STEPS) {
      expect(step.status).toBe("未开始");
    }
  });

  it("no step claims interviews, pilot, or deployment are done", () => {
    for (const step of PILOT_STEPS) {
      const text = `${step.title} ${step.evidenceNeeded} ${step.status}`;
      expect(text).not.toMatch(/已访谈/);
      expect(text).not.toMatch(/已完成.*访谈/);
      expect(text).not.toMatch(/已部署/);
      expect(text).not.toMatch(/已试点/);
    }
  });
});
