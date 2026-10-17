import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemosLogo from "@/components/MemosLogo";

const mockInstance = {
  generalSetting: {} as { customProfile?: { title?: string; logoUrl?: string } },
};

vi.mock("@/contexts/InstanceContext", () => ({
  useInstance: () => mockInstance,
}));

describe("<MemosLogo>", () => {
  beforeEach(() => {
    mockInstance.generalSetting = {};
  });

  it("uses the bundled SVG mark when the instance has no custom logo", () => {
    const { container } = render(<MemosLogo />);

    const mark = container.querySelector("svg.huan-mark");
    expect(mark).toBeInTheDocument();
    // Light theme: black glyph; dark theme: Bitwarden blue. The theme rule is
    // a class on the mark itself so it follows data-theme automatically.
    expect(mark).toHaveClass("text-black");
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("Memos")).toBeInTheDocument();
  });

  it("uses custom instance branding when configured", () => {
    mockInstance.generalSetting = { customProfile: { title: "Team Notes", logoUrl: "/custom-logo.png" } };
    const { container } = render(<MemosLogo />);

    expect(container.querySelector("img")).toHaveAttribute("src", "/custom-logo.png");
    expect(screen.getByText("Team Notes")).toBeInTheDocument();
  });
});
