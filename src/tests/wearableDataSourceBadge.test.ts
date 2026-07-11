import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WearableDataSourceBadge } from "../components/WearableDataSourceBadge";

describe("WearableDataSourceBadge source provenance", () => {
  it("shows canonical CSV Import data as connected rather than simulated", () => {
    const markup = renderToStaticMarkup(
      createElement(WearableDataSourceBadge, { source: "CSV Import" }),
    );

    expect(markup).toContain("CSV Import（已接入）");
    expect(markup).not.toContain("（模拟）");
  });
});
