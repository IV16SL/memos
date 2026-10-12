import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BasemapLayer } from "@/components/map/BasemapLayer";

vi.mock("react-leaflet", () => ({ useMap: () => ({}) }));
vi.mock("@/hooks/useResolvedTheme", () => ({ useResolvedTheme: () => "default" }));
vi.mock("@/components/map/map-utils", () => ({
  AmapTileLayer: ({ dark, eventHandlers }: { dark?: boolean; eventHandlers: { tileerror: () => void } }) => (
    <button type="button" data-dark={String(Boolean(dark))} onClick={eventHandlers.tileerror}>
      Amap tiles
    </button>
  ),
}));

describe("BasemapLayer", () => {
  it("renders the Amap tile layer and forwards tile errors", () => {
    const onTileError = vi.fn();
    render(<BasemapLayer onTileError={onTileError} />);
    const button = screen.getByRole("button", { name: "Amap tiles" });
    expect(button).toBeInTheDocument();
    button.click();
    expect(onTileError).toHaveBeenCalledTimes(1);
  });

  it("passes dark mode through to the tile layer", () => {
    render(<BasemapLayer />);
    expect(screen.getByRole("button", { name: "Amap tiles" })).toHaveAttribute("data-dark", "false");
  });
});
