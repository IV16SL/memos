import type { EChartsOption } from "echarts";
import { Parser } from "expr-eval";

/**
 * Config format for ```plot code blocks, rendered with ECharts.
 *
 * {
 *   "data": [
 *     { "fn": "abs(x)", "color": "#2563eb" },
 *     { "fn": "x", "color": "#9ca3af", "dashed": true }
 *   ],
 *   "x": [-3, 3],
 *   "y": [-3, 3]
 * }
 *
 * Each series draws exactly one of:
 * - fn: y = f(x), sampled over the x-axis range (or the series range)
 * - x + y: parametric curve (x(t), y(t)), t over the series range (default [0, 2*pi])
 * - r: polar curve r(theta), theta over the series range (default [0, 2*pi])
 * - points: an explicit list of [x, y] pairs
 *
 * Expressions are evaluated with expr-eval (no eval()), with x / t / theta in
 * scope plus pi and e. A series that hits a non-finite value or jumps by more
 * than the full y-axis range in one step is split there, so asymptotes such
 * as 1/x do not draw a line across the gap.
 *
 * A series can also carry a `label` to show its formula beside the line
 * (an ECharts markPoint): { "text": "y = |x|", "at": [0, 0], "position": "top" }.
 * text defaults to the series name, at defaults to the last sampled point,
 * position defaults to "top". Omit label (or set it to false) for no label.
 */

export interface PlotSeriesLabelConfig {
  text?: string;
  at?: [number, number];
  position?: "top" | "bottom" | "left" | "right";
}

export interface PlotSeriesConfig {
  fn?: string;
  x?: string;
  y?: string;
  r?: string;
  points?: [number, number][];
  name?: string;
  color?: string;
  dashed?: boolean;
  width?: number;
  range?: [number, number];
  samples?: number;
  label?: PlotSeriesLabelConfig | false;
}

export interface PlotConfig {
  data: PlotSeriesConfig[];
  x?: [number, number];
  y?: [number, number];
  title?: string;
  height?: number;
}

export type SampledPoint = [number, number] | null;

export const DEFAULT_PLOT_HEIGHT = 400;
const DEFAULT_SAMPLES = 200;
const MIN_SAMPLES = 10;
const MAX_SAMPLES = 2000;
const DEFAULT_X_RANGE: [number, number] = [-10, 10];
const DEFAULT_Y_RANGE: [number, number] = [-10, 10];
const DEFAULT_PARAM_RANGE: [number, number] = [0, 2 * Math.PI];

const parser = new Parser();

const isRange = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "number" &&
  typeof value[1] === "number" &&
  Number.isFinite(value[0]) &&
  Number.isFinite(value[1]) &&
  value[0] < value[1];

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isPoint = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);

const parseSeries = (item: unknown, index: number): PlotSeriesConfig => {
  const label = "plot series " + (index + 1);
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error(label + " must be an object");
  }
  const obj = item as Record<string, unknown>;
  const hasFn = typeof obj.fn === "string";
  const hasParam = typeof obj.x === "string" || typeof obj.y === "string";
  const hasPolar = typeof obj.r === "string";
  const hasPoints = obj.points !== undefined;
  const kindCount = [hasFn, hasParam, hasPolar, hasPoints].filter(Boolean).length;
  if (kindCount !== 1) {
    throw new Error(label + " needs exactly one of fn, x + y, r, or points");
  }
  if (hasFn && (typeof obj.fn !== "string" || obj.fn.trim().length === 0)) {
    throw new Error(label + " fn must be a non-empty expression");
  }
  if (hasParam && (typeof obj.x !== "string" || typeof obj.y !== "string")) {
    throw new Error(label + " parametric series needs both x and y");
  }
  if (hasPolar && (typeof obj.r !== "string" || obj.r.trim().length === 0)) {
    throw new Error(label + " r must be a non-empty expression");
  }
  if (hasPoints) {
    if (
      !Array.isArray(obj.points) ||
      obj.points.some((p) => !Array.isArray(p) || p.length !== 2 || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1]))
    ) {
      throw new Error(label + " points must be [x, y] pairs of finite numbers");
    }
  }
  if (obj.name !== undefined && typeof obj.name !== "string") {
    throw new Error(label + " name must be a string");
  }
  if (obj.color !== undefined && typeof obj.color !== "string") {
    throw new Error(label + " color must be a string");
  }
  if (obj.dashed !== undefined && typeof obj.dashed !== "boolean") {
    throw new Error(label + " dashed must be a boolean");
  }
  if (obj.width !== undefined && (!isFiniteNumber(obj.width) || obj.width <= 0)) {
    throw new Error(label + " width must be a positive number");
  }
  if (obj.range !== undefined && !isRange(obj.range)) {
    throw new Error(label + " range must be [min, max] with min < max");
  }
  if (obj.samples !== undefined && !isFiniteNumber(obj.samples)) {
    throw new Error(label + " samples must be a number");
  }
  if (obj.label !== undefined && obj.label !== false) {
    if (typeof obj.label !== "object" || obj.label === null || Array.isArray(obj.label)) {
      throw new Error(label + " label must be an object");
    }
    const lab = obj.label as Record<string, unknown>;
    if (lab.text !== undefined && (typeof lab.text !== "string" || lab.text.trim().length === 0)) {
      throw new Error(label + " label text must be a non-empty string");
    }
    if (lab.at !== undefined && !isPoint(lab.at)) {
      throw new Error(label + " label at must be [x, y]");
    }
    if (lab.position !== undefined && (typeof lab.position !== "string" || !["top", "bottom", "left", "right"].includes(lab.position))) {
      throw new Error(label + " label position must be top, bottom, left, or right");
    }
  }
  return obj as unknown as PlotSeriesConfig;
};

export const parsePlotConfig = (code: string): PlotConfig => {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    throw new Error("plot block is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("plot config must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.data) || obj.data.length === 0) {
    throw new Error("plot config needs a non-empty data array");
  }
  const config: PlotConfig = { data: obj.data.map((item, index) => parseSeries(item, index)) };
  if (obj.x !== undefined) {
    if (!isRange(obj.x)) {
      throw new Error("plot x must be [min, max] with min < max");
    }
    config.x = obj.x;
  }
  if (obj.y !== undefined) {
    if (!isRange(obj.y)) {
      throw new Error("plot y must be [min, max] with min < max");
    }
    config.y = obj.y;
  }
  if (obj.title !== undefined) {
    if (typeof obj.title !== "string") {
      throw new Error("plot title must be a string");
    }
    config.title = obj.title;
  }
  if (obj.height !== undefined) {
    if (!isFiniteNumber(obj.height) || obj.height < 100 || obj.height > 1200) {
      throw new Error("plot height must be a number between 100 and 1200");
    }
    config.height = obj.height;
  }
  return config;
};

const sampleCount = (series: PlotSeriesConfig): number => {
  const n = series.samples ?? DEFAULT_SAMPLES;
  if (!Number.isFinite(n)) {
    return DEFAULT_SAMPLES;
  }
  return Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(n)));
};

const evaluate = (expr: ReturnType<Parser["parse"]>, scope: Record<string, number>): number => {
  try {
    const value = expr.evaluate(scope);
    return typeof value === "number" ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
};

/** Sample one series into chart points; null breaks the line (asymptotes, gaps). */
export const sampleSeries = (series: PlotSeriesConfig, xRange: [number, number], yRange: [number, number]): SampledPoint[] => {
  if (series.points !== undefined) {
    return series.points.map(([px, py]): SampledPoint => [px, py]);
  }
  const n = sampleCount(series);
  const ySpan = yRange[1] - yRange[0];
  if (series.fn !== undefined) {
    const expr = parser.parse(series.fn);
    const [x0, x1] = series.range ?? xRange;
    const points: SampledPoint[] = [];
    let prevY: number | null = null;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = evaluate(expr, { x, pi: Math.PI, e: Math.E });
      if (!Number.isFinite(y) || (prevY !== null && Math.abs(y - prevY) > ySpan)) {
        points.push(null);
        prevY = null;
      } else {
        points.push([x, y]);
        prevY = y;
      }
    }
    return points;
  }
  if (series.x !== undefined && series.y !== undefined) {
    const exprX = parser.parse(series.x);
    const exprY = parser.parse(series.y);
    const [t0, t1] = series.range ?? DEFAULT_PARAM_RANGE;
    const points: SampledPoint[] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const x = evaluate(exprX, { t, pi: Math.PI, e: Math.E });
      const y = evaluate(exprY, { t, pi: Math.PI, e: Math.E });
      points.push(Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null);
    }
    return points;
  }
  if (series.r !== undefined) {
    const expr = parser.parse(series.r);
    const [t0, t1] = series.range ?? DEFAULT_PARAM_RANGE;
    const points: SampledPoint[] = [];
    for (let i = 0; i <= n; i++) {
      const theta = t0 + ((t1 - t0) * i) / n;
      const r = evaluate(expr, { theta, pi: Math.PI, e: Math.E });
      points.push(Number.isFinite(r) ? [r * Math.cos(theta), r * Math.sin(theta)] : null);
    }
    return points;
  }
  throw new Error("plot series needs exactly one of fn, x + y, r, or points");
};

const lastFinitePoint = (points: SampledPoint[]): [number, number] | null => {
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i];
    if (point !== null) {
      return point;
    }
  }
  return null;
};

/** Line-side label for one series, rendered as an ECharts markPoint. */
const buildSeriesLabel = (series: PlotSeriesConfig, data: SampledPoint[], seriesName: string) => {
  if (series.label === undefined || series.label === false) {
    return null;
  }
  const anchor = series.label.at ?? lastFinitePoint(data);
  if (anchor === null) {
    return null;
  }
  const text = series.label.text ?? seriesName;
  // Note: symbol "none" hides the whole markPoint including its label in
  // ECharts 5.5.1, so use a transparent circle instead: the dot is invisible
  // but the element (and its label) still renders.
  return {
    symbol: "circle",
    symbolSize: 10,
    itemStyle: { color: "transparent" },
    silent: true,
    label: {
      show: true,
      formatter: text,
      color: series.color,
      fontStyle: "italic" as const,
      fontSize: 14,
      position: series.label.position ?? "top",
    },
    data: [{ name: text, coord: anchor }],
  };
};

/** Build the ECharts option for a parsed config. `ink` is the axis/label color. */
export const buildPlotOption = (config: PlotConfig, ink: string): EChartsOption => {
  const xRange = config.x ?? DEFAULT_X_RANGE;
  const yRange = config.y ?? DEFAULT_Y_RANGE;
  return {
    animation: false,
    ...(config.title ? { title: { text: config.title, left: "center", textStyle: { color: ink } } } : {}),
    grid: { left: 48, right: 48, top: config.title ? 48 : 36, bottom: 36 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "value",
      min: xRange[0],
      max: xRange[1],
      name: "x",
      nameLocation: "end",
      nameTextStyle: { fontStyle: "italic", color: ink },
      axisLine: { onZero: true, symbol: ["none", "arrow"], lineStyle: { color: ink } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: ink },
    },
    yAxis: {
      type: "value",
      min: yRange[0],
      max: yRange[1],
      name: "y",
      nameLocation: "end",
      nameTextStyle: { fontStyle: "italic", color: ink },
      axisLine: { onZero: true, symbol: ["none", "arrow"], lineStyle: { color: ink } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: ink },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0 },
      { type: "inside", yAxisIndex: 0 },
    ],
    series: config.data.map((s) => {
      const data = sampleSeries(s, xRange, yRange);
      const seriesName = s.name ?? s.fn ?? s.r ?? "series";
      const markPoint = buildSeriesLabel(s, data, seriesName);
      return {
        type: "line",
        name: seriesName,
        showSymbol: false,
        data,
        lineStyle: { width: s.width ?? 2, color: s.color, type: s.dashed ? "dashed" : "solid" },
        ...(markPoint ? { markPoint } : {}),
      };
    }),
  };
};
