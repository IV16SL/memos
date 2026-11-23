import { DirectionProvider } from "@base-ui/react/direction-provider";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_SECTION_ACTION_ICON_CLASSES } from "@/components/AppSidebar/SidebarSection";
import MemoDisplaySettingMenu from "@/components/MemoDisplaySettingMenu";
import { ViewProvider } from "@/contexts/ViewContext";

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, params?: Record<string, number>) => {
    const labels: Record<string, string> = {
      "common.timeline": "Timeline",
      "common.created-at": "Created",
      "common.last-updated-at": "Last updated",
      "memo.compact-mode": "Compact mode",
      "memo.full-width": "Full width",
      "memo.direction": "Direction",
      "memo.layout": "Layout",
      "memo.layout-auto": "Auto",
      "memo.layout-auto-description": "As many columns as fit",
      "memo.layout-columns-description": `Up to ${params?.n ?? ""} columns`,
      "memo.layout-list": "List",
      "memo.layout-list-description": "A single column",
      "memo.link-preview": "Link preview",
      "memo.newest-first": "Newest first",
      "memo.oldest-first": "Oldest first",
      "memo.order": "Order",
      "memo.order-by": "Order by",
      "memo.view-options": "View options",
    };
    if (key === "memo.layout-columns") return `${params?.n ?? ""} columns`;
    return labels[key] ?? key;
  },
}));

describe("MemoDisplaySettingMenu", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens from an accessible trigger and holds only the Timeline's own options", () => {
    render(
      <ViewProvider>
        <MemoDisplaySettingMenu />
      </ViewProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Timeline · View options" });
    expect(trigger).toHaveClass("size-7", "w-auto", "px-1.5", "rounded-s-none");
    expect(trigger.querySelector(".lucide-chevron-down")).toBeInTheDocument();
    expect(trigger.querySelector("svg")).toHaveClass(SIDEBAR_SECTION_ACTION_ICON_CLASSES);

    fireEvent.click(trigger);

    // Compact mode and link preview moved to Settings > Preferences > This device.
    expect(screen.queryByRole("switch", { name: "Compact mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Link preview" })).not.toBeInTheDocument();

    const fullWidth = screen.getByRole("switch", { name: "Full width" });
    expect(fullWidth).not.toBeChecked();
    expect(fullWidth).toBeEnabled();

    fireEvent.click(screen.getByRole("radio", { name: "Auto" }));

    expect(fullWidth).toBeChecked();
    expect(fullWidth).toHaveAttribute("aria-disabled", "true");
  });

  it("opens only from the arrow, not the adjacent Timeline link", () => {
    render(
      <ViewProvider>
        <div>
          <a href="#timeline">Timeline</a>
          <MemoDisplaySettingMenu />
        </div>
      </ViewProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Timeline · View options" });
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radiogroup", { name: "Layout" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radiogroup", { name: "Layout" })).toBeInTheDocument();
  });

  it("moves horizontally in the visual direction for RTL layouts", () => {
    render(
      <DirectionProvider direction="rtl">
        <ViewProvider>
          <MemoDisplaySettingMenu />
        </ViewProvider>
      </DirectionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Timeline · View options" }));
    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Layout" }), { key: "ArrowLeft" });

    expect(screen.getByRole("radio", { name: "2 columns" })).toBeChecked();
  });
});
