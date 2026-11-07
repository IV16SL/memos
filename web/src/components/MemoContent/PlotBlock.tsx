import type { ECharts } from "echarts/core";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buildPlotOption, DEFAULT_PLOT_HEIGHT, parsePlotConfig } from "./plot-utils";
import { extractCodeContent } from "./utils";

interface PlotBlockProps {
  children?: React.ReactNode;
  className?: string;
}

// ```plot blocks are drawn with ECharts, not stored as images: the chart is
// rebuilt from the JSON config on every view, exactly like ```mermaid blocks
// are rebuilt by Pele. ECharts itself is loaded lazily (dynamic import), so
// pages without a plot block never download it.
export const PlotBlock = ({ children, className }: PlotBlockProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>("");

  const codeContent = extractCodeContent(children);

  useEffect(() => {
    if (!codeContent) {
      setError("");
      return;
    }

    let cancelled = false;
    let chart: ECharts | null = null;
    let observer: ResizeObserver | null = null;

    const renderPlot = async () => {
      try {
        const config = parsePlotConfig(codeContent);
        const echarts = await import("echarts/core");
        const { LineChart } = await import("echarts/charts");
        const { GridComponent, TooltipComponent, DataZoomComponent, TitleComponent, MarkPointComponent } = await import(
          "echarts/components"
        );
        const { CanvasRenderer } = await import("echarts/renderers");
        await document.fonts?.ready;
        if (cancelled) return;
        // TitleComponent and MarkPointComponent are required: without them
        // ECharts silently ignores the `title` option and markPoint labels.
        echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, TitleComponent, MarkPointComponent, CanvasRenderer]);

        const container = containerRef.current;
        if (!container) return;
        // Inherit the theme foreground so axis lines and labels stay readable
        // in both light and dark mode; series colors come from the config.
        const ink = getComputedStyle(container).color || "#111111";
        chart = echarts.init(container);
        chart.setOption(buildPlotOption(config, ink));
        if (cancelled) {
          chart.dispose();
          chart = null;
          return;
        }
        observer = new ResizeObserver(() => chart?.resize());
        observer.observe(container);
        setError("");
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to render plot:", err);
        setError(err instanceof Error ? err.message : "Failed to render plot");
      }
    };

    renderPlot();

    return () => {
      cancelled = true;
      observer?.disconnect();
      chart?.dispose();
      chart = null;
    };
  }, [codeContent]);

  if (error) {
    return (
      <div className="w-full">
        <div className="text-sm text-destructive mb-2 whitespace-normal break-words">Plot Error: {error}</div>
        <code className="block language-plot whitespace-pre text-sm">{codeContent}</code>
      </div>
    );
  }

  // Height comes from the parsed config when valid; fall back to the default
  // so the container has a size before the chart initializes.
  let height = DEFAULT_PLOT_HEIGHT;
  try {
    height = parsePlotConfig(codeContent).height ?? DEFAULT_PLOT_HEIGHT;
  } catch {
    height = DEFAULT_PLOT_HEIGHT;
  }

  return <div ref={containerRef} className={cn("w-full my-0", className)} style={{ height }} />;
};
