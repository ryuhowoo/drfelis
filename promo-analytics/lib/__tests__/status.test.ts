import { describe, it, expect } from "vitest";
import { MATCH_STATUS, TONE_CLASSES, WORKFLOW_TONE } from "@/lib/status";

describe("status registry", () => {
  it("every match source has label/hint and a valid tone", () => {
    for (const k of ["routed", "recommended", "manual", "sku", "none"] as const) {
      const s = MATCH_STATUS[k];
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.hint.length).toBeGreaterThan(0);
      expect(TONE_CLASSES[s.tone]).toBeDefined();
    }
  });
  it("workflow statuses map to defined tone classes", () => {
    for (const tone of Object.values(WORKFLOW_TONE)) {
      expect(TONE_CLASSES[tone]).toBeDefined();
    }
  });
});
