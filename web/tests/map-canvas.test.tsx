import { create } from "@bufbuild/protobuf";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wgs84ToGcj02 } from "@/components/map/gcj02";
import { MapCanvas } from "@/components/MapView/MapCanvas";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

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

    getX() {
      return this.x;
    }

    getY() {
      return this.y;
    }
  }
  class FakeMarker {
    handlers = new Map<string, (...args: never[]) => void>();
    position: FakeLngLat;
    content = "";
    title = "";
    zIndex = 0;
    extData: unknown = undefined;

    constructor(public opts: { position: FakeLngLat; content: string; title: string; zIndex: number }) {
      this.position = opts.position;
      this.content = opts.content;
      this.title = opts.title;
      this.zIndex = opts.zIndex;
      createdMarkers.push(this);
    }

    setPosition(p: FakeLngLat) {
      this.position = p;
    }

    getPosition() {
      return this.position;
    }

    setContent(c: string) {
      this.content = c;
    }

    setTitle(t: string) {
      this.title = t;
    }

    setzIndex(z: number) {
      this.zIndex = z;
    }

    setExtData(d: unknown) {
      this.extData = d;
    }

    getExtData() {
      return this.extData;
    }

    on(event: string, handler: (...args: never[]) => void) {
      this.handlers.set(event, handler);
    }

    off(event: string) {
      this.handlers.delete(event);
    }

    click() {
      this.handlers.get("click")?.();
    }
  }
  const createdMarkers: FakeMarker[] = [];
  // Spread markers across the viewport; same input coords land in the same cell.
  let pixelFn = (ll: FakeLngLat) => new FakePixel((ll.getLng() - 20) * 100, (ll.getLat() - 10) * 100);
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    getCenter: () => {
      const [lat, lng] = wgs84ToGcj02(35, 135);
      return new FakeLngLat(lng, lat);
    },
    getZoom: () => 12,
    getSize: () => ({ getWidth: () => 1000, getHeight: () => 800 }),
    lngLatToContainer: (ll: FakeLngLat) => pixelFn(ll),
    containerToLngLat: (px: FakePixel) => new FakeLngLat(px.getX(), px.getY()),
    setCenter: vi.fn(),
    setZoomAndCenter: vi.fn(),
    setFitView: vi.fn(),
    panBy: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    setMapStyle: vi.fn(),
  };
  const FakeAMap = { LngLat: FakeLngLat, Pixel: FakePixel, Marker: FakeMarker };
  return {
    map,
    FakeAMap,
    createdMarkers,
    setPixelFn: (fn: (ll: FakeLngLat) => FakePixel) => {
      pixelFn = fn;
    },
  };
});

vi.mock("@/components/map/useAmapMap", () => ({
  useAmapMap: () => ({ map: fakes.map, AMap: fakes.FakeAMap, error: null, loading: false }),
}));
vi.mock("@/hooks/useResolvedTheme", () => ({ useResolvedTheme: () => "default" }));

beforeEach(() => {
  fakes.createdMarkers.length = 0;
  fakes.map.setFitView.mockClear();
  fakes.map.panBy.mockClear();
  fakes.map.setZoomAndCenter.mockClear();
  fakes.map.setCenter.mockClear();
  fakes.setPixelFn((ll) => new fakes.FakeAMap.Pixel((ll.getLng() - 20) * 100, (ll.getLat() - 10) * 100));
});

// Outside China: GCJ-02 coincides with WGS-84, keeping the fake pixels predictable.
const memoAt = (name: string, lat: number, lng: number) =>
  create(MemoSchema, { name, location: { latitude: lat, longitude: lng } });

function props(): ComponentProps<typeof MapCanvas> {
  return {
    memos: [],
    pins: new Map(),
    selected: [],
    complete: false,
    desktop: true,
    panelSize: { width: 0, height: 0 },
    onSelect: vi.fn(),
    onDismiss: vi.fn(),
    onMove: vi.fn(),
    onReady: vi.fn(),
    onMapError: vi.fn(),
  };
}

const markerTitled = (title: string) => fakes.createdMarkers.find((m) => m.title === title)!;

describe("map viewport", () => {
  it("reveals a deep-linked marker when its page arrives without changing zoom", () => {
    const memo = memoAt("memos/selected", 10, 20);
    const initial = {
      ...props(),
      viewport: { lat: 10, lng: 20, zoom: 12 },
      selected: [memo.name],
      panelSize: { width: 400, height: 776 },
    };
    // The mock center already matches the viewport (no GCJ-02 shift outside China).
    fakes.map.getCenter = () => new fakes.FakeAMap.LngLat(20, 10);
    try {
      const { rerender } = render(<MapCanvas {...initial} />);
      expect(fakes.map.panBy).not.toHaveBeenCalled();
      rerender(<MapCanvas {...initial} memos={[memo]} complete />);
      // Marker at container (0, 0): x < 32 and y < 96, so pan by (-32, -96).
      expect(fakes.map.panBy).toHaveBeenCalledWith(-32, -96);
      expect(fakes.map.setFitView).not.toHaveBeenCalled();
      expect(fakes.map.setZoomAndCenter).not.toHaveBeenCalled();
    } finally {
      const [lat, lng] = wgs84ToGcj02(35, 135);
      fakes.map.getCenter = () => new fakes.FakeAMap.LngLat(lng, lat);
    }
  });

  it("fits once after complete loading and never refits on a later refresh or panel change", () => {
    const memo = memoAt("memos/a", 10, 20);
    const initial = props();
    const { rerender } = render(<MapCanvas {...initial} memos={[memo]} />);
    expect(fakes.map.setFitView).not.toHaveBeenCalled();
    rerender(<MapCanvas {...initial} memos={[memo]} complete />);
    expect(fakes.map.setFitView).toHaveBeenCalledOnce();
    rerender(
      <MapCanvas {...initial} memos={[memo, memoAt("memos/b", 11, 21)]} complete panelSize={{ width: 400, height: 776 }} />,
    );
    expect(fakes.map.setFitView).toHaveBeenCalledOnce();
  });

  it("exposes a controller for fit and zoom", () => {
    const onReady = vi.fn();
    render(<MapCanvas {...props()} onReady={onReady} />);

    const ctl = onReady.mock.calls[0][0];
    expect(ctl).toMatchObject({ fitMemos: expect.any(Function), zoomIn: expect.any(Function), zoomOut: expect.any(Function) });
    ctl.fitMemos([memoAt("memos/a", 10, 20)]);
    expect(fakes.map.setFitView).toHaveBeenCalledOnce();
    ctl.zoomIn();
    ctl.zoomOut();
    expect(fakes.map.zoomIn).toHaveBeenCalledTimes(1);
    expect(fakes.map.zoomOut).toHaveBeenCalledTimes(1);
  });
});

describe("map pins", () => {
  const place = (name: string, lat: number, lng: number) =>
    create(MemoSchema, { name, location: { placeholder: "Kyoto", latitude: lat, longitude: lng } });

  it("draws the calendar's marks at map scale: photo square, author avatar, or the plain dot", () => {
    const pins = new Map([
      ["memos/photo", { face: { kind: "photo" as const, url: "/thumb.jpg" }, label: "photo" }],
      ["memos/author", { face: { kind: "author" as const, avatarUrl: "/bob.png", name: "Bob" }, label: "author" }],
      ["memos/dot", { face: { kind: "dot" as const }, label: "dot" }],
    ]);
    render(
      <MapCanvas {...props()} memos={[place("memos/photo", 10, 20), place("memos/author", 11, 21), place("memos/dot", 12, 22)]} pins={pins} />,
    );

    expect(markerTitled("photo").content).toContain("/thumb.jpg");
    expect(markerTitled("author").content).toContain("/bob.png");
    expect(markerTitled("dot").content).toContain("rounded-full");
  });

  it("labels a pin with its place and author, and falls back to the place alone", () => {
    const pins = new Map([["memos/a", { face: { kind: "dot" as const }, label: "Kyoto · Bob" }]]);
    render(<MapCanvas {...props()} memos={[place("memos/a", 10, 20), place("memos/b", 11, 21)]} pins={pins} />);

    expect(markerTitled("Kyoto · Bob")).toBeDefined();
    expect(markerTitled("Kyoto")).toBeDefined();
  });

  it("grows a selected pin and raises it above the rest", () => {
    const face = { kind: "author" as const, avatarUrl: "/bob.png", name: "Bob" };
    const pins = new Map([
      ["memos/a", { face, label: "a" }],
      ["memos/b", { face, label: "b" }],
    ]);
    const memos = [place("memos/a", 10, 20), place("memos/b", 11, 21)];
    const { rerender } = render(<MapCanvas {...props()} memos={memos} pins={pins} />);

    const before = markerTitled("a").content;
    expect(before).not.toContain("bg-primary/20");

    rerender(<MapCanvas {...props()} memos={memos} pins={pins} selected={["memos/a"]} />);

    const selected = markerTitled("a");
    expect(selected.content).toContain("bg-primary/20");
    expect(selected.content).not.toBe(markerTitled("b").content);
    expect(selected.zIndex).toBe(1000);
  });

  it("writes a label that resolves after the first draw onto the live marker", () => {
    const memos = [place("memos/a", 10, 20)];
    const { rerender } = render(<MapCanvas {...props()} memos={memos} />);
    const marker = markerTitled("Kyoto");

    rerender(
      <MapCanvas {...props()} memos={memos} pins={new Map([["memos/a", { face: { kind: "dot" as const }, label: "Kyoto · Bob" }]])} />,
    );

    expect(marker.title).toBe("Kyoto · Bob");
  });

  it("selects a single memo on marker click", () => {
    const onSelect = vi.fn();
    render(<MapCanvas {...props()} memos={[place("memos/a", 10, 20)]} onSelect={onSelect} />);

    markerTitled("Kyoto").click();

    expect(onSelect).toHaveBeenCalledWith(["memos/a"]);
  });

  it("clusters nearby memos and selects them all on cluster click", () => {
    const onSelect = vi.fn();
    render(<MapCanvas {...props()} memos={[place("memos/a", 10, 20), place("memos/b", 10, 20)]} onSelect={onSelect} />);

    const cluster = markerTitled("2 memos");
    expect(cluster.content).toContain(">2<");
    cluster.click();

    expect(onSelect).toHaveBeenCalledWith(["memos/a", "memos/b"]);
  });
});
