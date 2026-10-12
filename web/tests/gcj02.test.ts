import { describe, expect, it } from "vitest";
import { gcj02ToWgs84, wgs84ToGcj02 } from "@/components/map/gcj02";

describe("gcj02", () => {
  it("leaves coordinates outside China unchanged", () => {
    // Paris
    expect(wgs84ToGcj02(48.8584, 2.2945)).toEqual([48.8584, 2.2945]);
    expect(gcj02ToWgs84(48.8584, 2.2945)).toEqual([48.8584, 2.2945]);
  });

  it("offsets coordinates within China (GCJ-02 != WGS-84)", () => {
    // Tiananmen Square, Beijing
    const [gLat, gLng] = wgs84ToGcj02(39.9087, 116.3975);
    // Offset is on the order of hundreds of meters, not zero and not huge.
    expect(Math.abs(gLat - 39.9087)).toBeGreaterThan(0.0001);
    expect(Math.abs(gLat - 39.9087)).toBeLessThan(0.01);
    expect(Math.abs(gLng - 116.3975)).toBeGreaterThan(0.0001);
    expect(Math.abs(gLng - 116.3975)).toBeLessThan(0.01);
  });

  it("round-trips within a few meters", () => {
    const cases: [number, number][] = [
      [39.9087, 116.3975], // Beijing
      [31.2304, 121.4737], // Shanghai
      [23.1291, 113.2644], // Guangzhou
    ];
    for (const [lat, lng] of cases) {
      const [gLat, gLng] = wgs84ToGcj02(lat, lng);
      const [rLat, rLng] = gcj02ToWgs84(gLat, gLng);
      // ~1e-6 degrees ≈ 0.1m
      expect(Math.abs(rLat - lat)).toBeLessThan(1e-6);
      expect(Math.abs(rLng - lng)).toBeLessThan(1e-6);
    }
  });
});
