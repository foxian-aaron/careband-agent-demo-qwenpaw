import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { renderRoute } from "../App";
import { EventSimulatorPage } from "../pages/EventSimulatorPage";

const read = (file: string) => fs.readFileSync(file, "utf8");

describe("event simulator surface", () => {
  it("exposes the dedicated route without replacing the old demo control", () => {
    expect(renderRoute("/event-simulator").type).toBe(EventSimulatorPage);
    expect(read("src/App.tsx")).toContain('path === "/demo-control"');
    expect(read("src/components/Navigation.tsx")).toContain("#/event-simulator");
  });

  it("states the software-only and server-authority boundary", () => {
    const page = read("src/pages/EventSimulatorPage.tsx");
    expect(page).toContain("当前为软件事件模拟");
    expect(page).toContain("不代表实体硬件已经完成");
    expect(page).toContain("客户端不提交风险字段");
    expect(page).toContain("只由后端规则引擎生成");
    expect(page).toContain("静态 Pages");
    expect(page).toContain("原样重放当前请求");
  });

  it("never claims a real Agent call or HardwareMode", () => {
    const sources = [read("src/lib/eventSimulator.ts"), read("src/pages/EventSimulatorPage.tsx")].join("\n");
    expect(sources).toContain("real_agent_called: false");
    expect(sources).not.toContain("HardwareMode");
    expect(sources).not.toMatch(/esp32|apple_watch|nrf/i);
  });
});
