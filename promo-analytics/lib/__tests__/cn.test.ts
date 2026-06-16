import { describe, it, expect } from "vitest";
import { cn } from "@/lib/cn";

describe("cn", () => {
  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
  it("drops falsy conditionals", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
});
