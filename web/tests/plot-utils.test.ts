import { describe, expect, it } from "vitest";
import { buildPlotOption, parsePlotConfig, sampleSeries } from "@/components/MemoContent/plot-utils";

const ABS_EXAMPLE =
  '{"data": [{"fn": "abs(x)", "color": "#2563eb"}, {"fn": "x", "color": "#9ca3af", "dashed": true}], "x": [-3, 3], "y": [-3, 3]}';

describe("parsePlotConfig", () => {
  it("parses the abs(x) example", () => {
    const config = parsePlotConfig(ABS_EXAMPLE);
    expect(config.data).toHaveLength(2);
    expect(config.data[0].fn).toBe("abs(x)");
    expect(config.data[1].dashed).toBe(true);
    expect(config.x).toEqual([-3, 3]);
    expect(config.y).toEqual([-3, 3]);
  });

  it("rejects invalid JSON", () => {
    expect(() => parsePlotConfig("{not json")).toThrow();
  });

  it("rejects a missing data array", () => {
    expect(() => parsePlotConfig('{"x": [-3, 3]}')).toThrow();
  });

  it("rejects an empty data array", () => {
    expect(() => parsePlotConfig('{"data": []}')).toThrow();
  });

  it("rejects a series with no function", () => {
    expect(() => parsePlotConfig('{"data": [{"color": "red"}]}')).toThrow();
  });

  it("rejects a parametric series missing y", () => {
    expect(() => parsePlotConfig('{"data": [{"x": "cos(t)"}]}')).toThrow();
  });

  it("rejects a reversed axis range", () => {
    expect(() => parsePlotConfig('{"data": [{"fn": "x"}], "x": [3, -3]}')).toThrow();
  });
});

describe("sampleSeries", () => {
  it("samples abs(x) with the corner at the origin", () => {
    const pts = sampleSeries({ fn: "abs(x)" }, [-3, 3], [-3, 3]);
    expect(pts).not.toContain(null);
    expect(pts[0]).toEqual([-3, 3]);
    expect(pts[pts.length - 1]).toEqual([3, 3]);
    const origin = pts.find((p) => p !== null && p[0] === 0);
    expect(origin).toEqual([0, 0]);
  });

  it("samples x^2", () => {
    const pts = sampleSeries({ fn: "x^2", samples: 10 }, [-2, 2], [-10, 10]);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual([-2, 4]);
    expect(pts[5]).toEqual([0, 0]);
    expect(pts[10]).toEqual([2, 4]);
  });

  it("breaks the line at the 1/x asymptote", () => {
    const pts = sampleSeries({ fn: "1/x" }, [-3, 3], [-3, 3]);
    expect(pts).toContain(null);
    expect(pts.filter((p) => p !== null && p[0] < 0).length).toBeGreaterThan(0);
    expect(pts.filter((p) => p !== null && p[0] > 0).length).toBeGreaterThan(0);
  });

  it("samples a parametric circle", () => {
    const pts = sampleSeries({ x: "cos(t)", y: "sin(t)", samples: 100 }, [-10, 10], [-10, 10]);
    expect(pts).toHaveLength(101);
    expect(pts[0]).toEqual([1, 0]);
    expect(pts[25]?.[0]).toBeCloseTo(0);
    expect(pts[25]?.[1]).toBeCloseTo(1);
    expect(pts[50]?.[0]).toBeCloseTo(-1);
    expect(pts[50]?.[1]).toBeCloseTo(0);
    expect(pts[100]?.[0]).toBeCloseTo(1);
    expect(pts[100]?.[1]).toBeCloseTo(0);
  });

  it("samples a polar circle", () => {
    const pts = sampleSeries({ r: "1", samples: 100 }, [-10, 10], [-10, 10]);
    expect(pts).toHaveLength(101);
    expect(pts[0]).toEqual([1, 0]);
    expect(pts[25]?.[0]).toBeCloseTo(0);
    expect(pts[25]?.[1]).toBeCloseTo(1);
    expect(pts[50]?.[0]).toBeCloseTo(-1);
    expect(pts[50]?.[1]).toBeCloseTo(0);
  });

  it("passes points through unchanged", () => {
    const pts = sampleSeries(
      {
        points: [
          [1, 2],
          [3, 4],
        ],
      },
      [-10, 10],
      [-10, 10],
    );
    expect(pts).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("buildPlotOption", () => {
  it("builds two line series for the abs(x) example", () => {
    const option = buildPlotOption(parsePlotConfig(ABS_EXAMPLE), "#111111");
    expect(option.series).toHaveLength(2);
    expect(option.xAxis).toMatchObject({ min: -3, max: 3 });
    expect(option.yAxis).toMatchObject({ min: -3, max: 3 });
    expect(option.xAxis).toMatchObject({ axisLine: { lineStyle: { color: "#111111" } } });
  });

  it("defaults to a [-10, 10] range", () => {
    const option = buildPlotOption(parsePlotConfig('{"data": [{"fn": "x"}]}'), "#111111");
    expect(option.xAxis).toMatchObject({ min: -10, max: 10 });
    expect(option.yAxis).toMatchObject({ min: -10, max: 10 });
  });
});
