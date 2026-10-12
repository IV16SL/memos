import { memo, useEffect, useRef, useState } from "react";
import { useContentSearchTerms } from "@/contexts/MemoFilterContext";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { MemoMarkdownRenderer } from "./MemoMarkdownRenderer";
import { useResolvedMentionUsernames } from "./MentionResolutionContext";
import type { MemoContentProps } from "./types";
import { useSearchMatchHighlight } from "./useSearchMatchHighlight";

// Stateless markdown renderer. Truncation is not this component's concern — compact cards
// are bounded by ClampedSection around the whole memo body; `compact` here only informs
// the renderer (e.g. footnote links navigate to the detail page instead of scrolling,
// since a collapsed card may hide the target).
const MemoContent = (props: MemoContentProps) => {
  const { className, contentClassName, content, attachments, onClick, onDoubleClick } = props;
  const resolvedMentionUsernames = useResolvedMentionUsernames(content);
  const t = useTranslate();
  // Whatever the page's search matched is painted here, without altering the rendered tree.
  const contentRef = useRef<HTMLDivElement>(null);
  useSearchMatchHighlight(contentRef, useContentSearchTerms());

  // `<!--more-->` support: the rehype plugin wraps post-marker content in [data-more-content].
  // Detail pages (/memos/:id) always show full content; list views collapse with an expand button.
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const isDetail = /^\/memos\/[^/]+/.test(window.location.pathname);
    setHasMore(!isDetail && !!contentRef.current?.querySelector("[data-more-marker]"));
    setExpanded(false);
  }, [content]);

  return (
    <div className={`w-full flex flex-col justify-start items-start text-foreground ${className || ""}`}>
      <div
        ref={contentRef}
        data-memo-content
        data-memo-name={props.memoName}
        className={cn(
          "relative w-full max-w-full wrap-break-word text-base leading-6",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          "[&_.katex-display]:max-w-full",
          "[&_.katex-display]:overflow-x-auto",
          "[&_.katex-display]:overflow-y-hidden",
          // Footnotes: quiet GitHub-style footer — thin separator, smaller muted text, unobtrusive links.
          "[&_.footnotes]:mt-4 [&_.footnotes]:border-t [&_.footnotes]:border-border [&_.footnotes]:pt-2",
          "[&_.footnotes]:text-sm [&_.footnotes]:text-muted-foreground",
          // GitHub renders footnote ref/backref links without an underline (underline on hover only).
          "[&_[data-footnote-ref]]:no-underline [&_[data-footnote-ref]:hover]:underline",
          "[&_.data-footnote-backref]:no-underline [&_.data-footnote-backref:hover]:underline",
          // `<!--more-->`: collapse post-marker content until expanded.
          hasMore && !expanded && "[&_[data-more-content]]:hidden",
          contentClassName,
        )}
        onMouseUp={onClick}
        onDoubleClick={onDoubleClick}
      >
        <MemoMarkdownRenderer
          content={content}
          attachments={attachments}
          resolvedMentionUsernames={resolvedMentionUsernames}
          memoName={props.memoName}
          parentPage={props.parentPage}
          compact={Boolean(props.compact)}
        />
      </div>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 rounded-lg border border-border bg-muted px-3 py-1 text-[13px] text-muted-foreground hover:bg-accent"
        >
          {t("memo.expand")}
        </button>
      )}
    </div>
  );
};

export default memo(MemoContent);
