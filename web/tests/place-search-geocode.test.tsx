import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaceSearch } from "@/components/map/usePlaceSearch";
import { useReverseGeocoding } from "@/components/map/useReverseGeocoding";

const mocks = vi.hoisted(() => {
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
  const state = {
    configured: true,
    nearbyCalls: [] as { keywords: string; center: FakeLngLat; radius: number }[],
    textCalls: [] as string[],
    geocodeCalls: [] as FakeLngLat[],
    // "complete" with pois, "no_data", or "error".
    nearbyStatus: "complete",
    nearbyPois: [] as { name: string; address: string; lng: number; lat: number }[],
    textStatus: "complete",
    textPois: [] as { name: string; address: string; lng: number; lat: number }[],
    geocodeStatus: "complete",
    geocodeAddress: "",
  };
  const toPoi = (p: { name: string; address: string; lng: number; lat: number }) => ({
    name: p.name,
    address: p.address,
    location: new FakeLngLat(p.lng, p.lat),
  });
  class FakePlaceSearch {
    search(keywords: string, cb: (s: string, r: unknown) => void) {
      state.textCalls.push(keywords);
      cb(state.textStatus, { poiList: { pois: state.textPois.map(toPoi) } });
    }
    searchNearBy(keywords: string, center: FakeLngLat, radius: number, cb: (s: string, r: unknown) => void) {
      state.nearbyCalls.push({ keywords, center, radius });
      cb(state.nearbyStatus, { poiList: { pois: state.nearbyPois.map(toPoi) } });
    }
  }
  class FakeGeocoder {
    getAddress(lnglat: FakeLngLat, cb: (s: string, r: unknown) => void) {
      state.geocodeCalls.push(lnglat);
      cb(state.geocodeStatus, { regeocode: { formattedAddress: state.geocodeAddress } });
    }
  }
  const fakeAMap = {
    LngLat: FakeLngLat,
    PlaceSearch: FakePlaceSearch,
    Geocoder: FakeGeocoder,
    plugin: (_plugins: string[], cb: () => void) => cb(),
  };
  return { state, fakeAMap, FakeLngLat };
});

vi.mock("@/components/map/amap", () => ({
  isAmapConfigured: () => mocks.state.configured,
  loadAmap: () => Promise.resolve(mocks.fakeAMap),
  loadAmapPlugins: () => Promise.resolve(),
}));

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper };
};

beforeEach(() => {
  const s = mocks.state;
  s.configured = true;
  s.nearbyCalls = [];
  s.textCalls = [];
  s.geocodeCalls = [];
  s.nearbyStatus = "complete";
  s.nearbyPois = [];
  s.textStatus = "complete";
  s.textPois = [];
  s.geocodeStatus = "complete";
  s.geocodeAddress = "";
});

describe("usePlaceSearch via the JS API plugin", () => {
  it("searches nearby first, converts GCJ-02 to WGS-84, and sorts by distance", async () => {
    // Outside China GCJ-02 coincides with WGS-84, keeping the math predictable.
    mocks.state.nearbyPois = [
      { name: "Far", address: "far", lng: 20.01, lat: 10 },
      { name: "Near", address: "near", lng: 20.001, lat: 10 },
    ];
    const { wrapper } = setup();
    const { result } = renderHook(() => usePlaceSearch("mall", { lat: 10, lng: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.state.nearbyCalls).toHaveLength(1);
    expect(mocks.state.nearbyCalls[0].keywords).toBe("mall");
    expect(mocks.state.nearbyCalls[0].radius).toBe(50000);
    expect(mocks.state.textCalls).toHaveLength(0);

    const names = result.current.data!.map((p) => p.name);
    expect(names).toEqual(["Near", "Far"]);
    expect(result.current.data![0]).toMatchObject({ lat: 10, lng: 20.001 });
  });

  it("falls back to the nationwide search when nothing is nearby", async () => {
    mocks.state.nearbyStatus = "no_data";
    mocks.state.textPois = [{ name: "Beijing Mall", address: "beijing", lng: 116.4, lat: 39.9 }];
    const { wrapper } = setup();
    const { result } = renderHook(() => usePlaceSearch("mall", { lat: 10, lng: 20 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.state.textCalls).toEqual(["mall"]);
    expect(result.current.data!.map((p) => p.name)).toEqual(["Beijing Mall"]);
  });

  it("searches nationwide without a bias center", async () => {
    mocks.state.textPois = [{ name: "Mall", address: "", lng: 20, lat: 10 }];
    const { wrapper } = setup();
    const { result } = renderHook(() => usePlaceSearch("mall"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.state.nearbyCalls).toHaveLength(0);
    expect(mocks.state.textCalls).toEqual(["mall"]);
  });
});

describe("useReverseGeocoding via the JS API plugin", () => {
  it("returns the formatted address", async () => {
    mocks.state.geocodeAddress = "江苏省苏州市虎丘区";
    const { wrapper } = setup();
    const { result } = renderHook(() => useReverseGeocoding(31.357496, 120.54316), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("江苏省苏州市虎丘区");
    // GCJ-02 offset applied before the lookup.
    const lookedUp = mocks.state.geocodeCalls[0];
    expect(lookedUp.getLat()).not.toBeCloseTo(31.357496, 6);
  });

  it("falls back to the coordinate string when the lookup fails", async () => {
    mocks.state.geocodeStatus = "error";
    const { wrapper } = setup();
    const { result } = renderHook(() => useReverseGeocoding(31.357496, 120.54316), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("31.357496, 120.543160");
  });
});
