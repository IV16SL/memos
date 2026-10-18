import { Loader2Icon, MapPinIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { MapPoint } from "./types";
import { usePlaceSearch } from "./usePlaceSearch";

interface PlaceSearchBoxProps {
  onSelect: (point: MapPoint, name: string) => void;
  /** Bias center for nearby-first ranking, read at search time. */
  getBiasCenter?: () => MapPoint | undefined;
}

export const PlaceSearchBox = ({ onSelect, getBiasCenter }: PlaceSearchBoxProps) => {
  const t = useTranslate();
  const [input, setInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [biasCenter, setBiasCenter] = useState<MapPoint | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const getBiasCenterRef = useRef(getBiasCenter);
  getBiasCenterRef.current = getBiasCenter;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(input);
      // Snapshot the map center for this search so drags don't refetch it.
      setBiasCenter(getBiasCenterRef.current?.());
    }, 400);
    return () => clearTimeout(timer);
  }, [input]);

  const { data: results, isFetching, isError } = usePlaceSearch(debouncedQuery, biasCenter);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const queryActive = debouncedQuery.trim().length >= 2;
  const showDropdown = open && queryActive;
  const showEmptyState = showDropdown && !isFetching && (isError || (results?.length ?? 0) === 0);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <SearchIcon size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={t("map.search-places")}
          className="h-9 pl-8 pr-8"
          aria-label={t("map.search-places")}
        />
        {input && (
          <button
            type="button"
            onClick={() => {
              setInput("");
              setDebouncedQuery("");
            }}
            aria-label={t("map.search-clear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute inset-x-0 top-full z-[1000] mt-1.5 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {isFetching && (
            <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2Icon size={14} className="animate-spin" />
              {t("map.searching")}
            </div>
          )}
          {!isFetching &&
            results?.map((result, index) => (
              <button
                key={`${result.lat},${result.lng},${index}`}
                type="button"
                onClick={() => {
                  onSelect({ lat: result.lat, lng: result.lng }, result.name);
                  setInput(result.name);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                )}
              >
                <MapPinIcon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{result.name}</span>
                  {result.address && <span className="block truncate text-xs text-muted-foreground">{result.address}</span>}
                </span>
              </button>
            ))}
          {showEmptyState && <div className="px-3 py-2.5 text-sm text-muted-foreground">{t("map.search-no-results")}</div>}
        </div>
      )}
    </div>
  );
};
