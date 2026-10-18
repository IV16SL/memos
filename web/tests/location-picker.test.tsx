import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocationPicker from "@/components/map/LocationPicker";

const fakes = vi.hoisted(() => {
  class FakeLngLat {
    constructor(
      public lng: number,
      public lat: number,
    ) {}

    getLng() {
      return this.lng;
    }

    getLat() {
      return this.lat;
    }
  }
  class FakePixel {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }
  class FakeMarker {
    constructor(public opts: unknown) {}

    setPosition() {}

    setContent() {}

    setMap() {}
  }
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    setCenter: vi.fn(),
    getCenter: () => new FakeLngLat(2, 1),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  };
  const FakeAMap = { LngLat: FakeLngLat, Pixel: FakePixel, Marker: FakeMarker };
  return { map, FakeAMap, FakeMarker };
});

let mockError: Error | null = null;
vi.mock("@/components/map/useAmapMap", () => ({
  useAmapMap: () => ({ map: fakes.map, AMap: fakes.FakeAMap, error: mockError, loading: false }),
}));
vi.mock("@/hooks/useResolvedTheme", () => ({ useResolvedTheme: () => "default" }));

const mapClick = () => fakes.map.on.mock.calls.find(([event]) => event === "click")?.[1] as ((e: unknown) => void) | undefined;

describe("LocationPicker", () => {
  it("shows the choose-a-location status with no position", () => {
    render(<LocationPicker />);

    expect(screen.getByText("Choose a location")).toBeInTheDocument();
  });

  it("places a marker on map click and reports WGS-84", () => {
    const onChange = vi.fn();
    // Outside China: GCJ-02 coincides with WGS-84.
    render(<LocationPicker latlng={undefined} onChange={onChange} />);

    mapClick()?.({ lnglat: { getLat: () => 10, getLng: () => 20 } });

    expect(onChange).toHaveBeenCalledWith({ lat: 10, lng: 20 });
  });

  it("does not attach a click handler when readonly", () => {
    fakes.map.on.mockClear();
    render(<LocationPicker readonly />);

    expect(fakes.map.on.mock.calls.some(([event]) => event === "click")).toBe(false);
  });

  it("recenters only when the coordinates change", () => {
    fakes.map.setCenter.mockClear();
    const { rerender } = render(<LocationPicker latlng={{ lat: 1, lng: 2 }} />);

    expect(fakes.map.setCenter).toHaveBeenCalledTimes(1);

    rerender(<LocationPicker latlng={{ lat: 1, lng: 2 }} />);

    expect(fakes.map.setCenter).toHaveBeenCalledTimes(1);

    rerender(<LocationPicker latlng={{ lat: 3, lng: 4 }} />);

    expect(fakes.map.setCenter).toHaveBeenCalledTimes(2);
  });

  it("zooms with the glass buttons", () => {
    render(<LocationPicker />);

    screen.getByRole("button", { name: "Zoom in" }).click();
    screen.getByRole("button", { name: "Zoom out" }).click();

    expect(fakes.map.zoomIn).toHaveBeenCalledTimes(1);
    expect(fakes.map.zoomOut).toHaveBeenCalledTimes(1);
  });

  it("shows a fallback when the Amap key is missing", () => {
    mockError = new Error("no key");
    try {
      render(<LocationPicker />);

      expect(screen.getByText(/VITE_AMAP_API_KEY/)).toBeInTheDocument();
    } finally {
      mockError = null;
    }
  });
});
