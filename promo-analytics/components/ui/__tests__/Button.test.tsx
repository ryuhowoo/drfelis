import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("renders its label", () => {
    render(<Button>저장</Button>);
    expect(screen.getByRole("button", { name: "저장" })).toBeTruthy();
  });
  it("is disabled while loading", () => {
    render(<Button loading>저장</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
  it("asChild renders the child element (anchor) with href", () => {
    render(
      <Button asChild>
        <a href="/x">링크</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "링크" }).getAttribute("href")).toBe("/x");
  });
});
