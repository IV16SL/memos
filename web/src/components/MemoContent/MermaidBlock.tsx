import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { extractCodeContent } from "./utils";

interface MermaidBlockProps {
  children?: React.ReactNode;
  className?: string;
}

const formatErrorMessage = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : "Failed to render diagram";
  if (/no diagram type detected/i.test(msg)) {
    return `${msg} — check that the diagram type is valid (e.g. sequenceDiagram, classDiagram, erDiagram)`;
  }
  return msg;
};

// ```mermaid blocks are drawn by Pele, not mermaid.js: Pele emits SVG styled by
// the `.pele` CSS variables in index.css, so the diagram follows the app theme
// (including dark mode) with no re-render on theme change.
export const MermaidBlock = ({ children, className }: MermaidBlockProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [maxWidth, setMaxWidth] = useState<number | undefined>(undefined);

  const codeContent = extractCodeContent(children);

  // Measure the container so Pele's autoDirection can flip an over-wide
  // diagram on narrow screens. The container div is always mounted: if it
  // only appears once the SVG exists, the ref is null on first render,
  // maxWidth stays undefined, and the flip never triggers (it requires a
  // positive maxWidth). Measured in a layout effect so the first diagram
  // render already sees the width; re-measured on resize (e.g. phone
  // rotation) so the flip decision follows the actual container.
  useLayoutEffect(() => {
    const measure = () => {
      const w = containerRef.current?.clientWidth ?? 0;
      if (w > 0) {
        setMaxWidth((prev) => (prev === w ? prev : w));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Render diagram when content or container width changes. Theme changes need
  // no re-render: the SVG takes its colors from CSS variables.
  useEffect(() => {
    if (!codeContent) {
      setSvg("");
      setError("");
      return;
    }

    let cancelled = false;

    const renderDiagram = async () => {
      try {
        const { renderAsync } = await import("pele/lazy");
        // Text is measured against the final glyphs, so webfonts must be loaded
        // first. The Font Loading API is absent in some environments (jsdom).
        await document.fonts?.ready;
        if (cancelled) return;

        // Labels use the body font (the old mermaid.js block pinned the same
        // font so measurement and display agreed); --font-mono covers code-ish
        // parts. autoDirection flips an over-wide diagram to fit a narrow
        // container (below Pele's 640px breakpoint); on wide containers the
        // authored direction is kept.
        const bodyStyle = getComputedStyle(document.body);
        const { svg: renderedSvg } = await renderAsync(codeContent, {
          fontFamily: bodyStyle.fontFamily || "sans-serif",
          fontFamilyMono: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace",
          maxWidth,
          autoDirection: true,
          idPrefix: `diagram-${Math.random().toString(36).slice(2)}`,
        });
        if (cancelled) return;

        setSvg(renderedSvg);
        setError("");
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to render diagram:", err);
        setSvg("");
        setError(formatErrorMessage(err));
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [codeContent, maxWidth]);

  if (error) {
    return (
      <div className="w-full">
        <div className="text-sm text-destructive mb-2 whitespace-normal break-words">Mermaid Error: {error}</div>
        <code className="block language-mermaid whitespace-pre text-sm">{codeContent}</code>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("pele mermaid-diagram w-full flex justify-center items-center my-0 overflow-x-auto", svg && "mb-2", className)}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
};
