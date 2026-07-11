import { describe, expect, it } from "vitest";

import { normalizedHardwareEvent } from "../store/demoStore";

describe("frontend event provenance", () => {
  it("marks the software hardware simulator as mock rather than a physical ESP32", () => {
    const event = normalizedHardwareEvent("E001", "sos_long_press");

    expect(event.event_type).toBe("sos");
    expect(event.source).toBe("mock");
    expect(event.payload).toMatchObject({
      simulated_device: "esp32",
      action: "long_press",
      button_pattern: "long_press",
    });
  });
});
