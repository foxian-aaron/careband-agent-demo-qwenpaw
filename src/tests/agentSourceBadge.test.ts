import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentSourceBadge } from "../components/AgentSourceBadge";

describe("AgentSourceBadge output provenance", () => {
  it("exposes the exact persisted output id and validation metadata without changing the label", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentSourceBadge, {
        summaries: {
          outputId: "OUT-SOS-001",
          caregiverSummary: "caregiver",
          familySummary: "family",
          institutionSummary: "institution",
          decisionTrace: [],
          agentSource: "mock",
          fallbackUsed: true,
          validationStatus: "fallback_valid",
        },
      }),
    );

    expect(markup).toContain('data-agent-output-id="OUT-SOS-001"');
    expect(markup).toContain('data-agent-source="mock"');
    expect(markup).toContain('data-agent-validation="fallback_valid"');
    expect(markup).toContain("Mock fallback");
  });
});
