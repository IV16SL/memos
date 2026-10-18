import { ExternalLinkIcon, MinusIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { isDarkTheme } from "@/utils/theme";
import { AMAP_MISSING_KEY_MESSAGE, type AmapMapEvent, type AmapMarker, type AmapStatic } from "./amap";
import { gcj02ToWgs84, wgs84ToGcj02 } from "./gcj02";
import { defaultMarkerDot } from "./map-utils";
import type { MapPoint } from "./types";
import { useAmapMap } from "./useAmapMap";

// MapPoint is WGS-84 (stored); the Amap SDK renders GCJ-02. Convert at the boundary.
const toAmapLngLat = (AMap: AmapStatic, point: MapPoint) => {
  const [lat, lng] = wgs84ToGcj02(point.lat, point.lng);
  return new AMap.LngLat(lng, lat);
};

// Reusable glass-style button component
interface GlassButtonProps {
  icon: ReactNode;
  onClick: () => void;
  ariaLabel: string;
  title: string;
}

const GlassButton = ({ icon, onClick, ariaLabel, title }: GlassButtonProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        "inline-flex items-center justify-center h-8 w-8 rounded-lg",
        "border border-border/80 bg-background/88 text-foreground shadow-sm backdrop-blur-md",
        "hover:scale-105 hover:bg-background hover:shadow-md active:scale-95",
        "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
      )}
    >
      {icon}
    </button>
  );
};

interface LocationPickerProps {
  readonly?: boolean;
  latlng?: MapPoint;
  onChange?: (position: MapPoint) => void;
  onCenterChange?: (center: MapPoint) => void;
  className?: string;
}

const DEFAULT_CENTER: MapPoint = { lat: 39.9042, lng: 116.4074 }; // Beijing
const noopOnLocationChange = () => {};

const LocationPicker = ({
  readonly: readOnly = false,
  latlng,
  onChange = noopOnLocationChange,
  onCenterChange,
  className,
}: LocationPickerProps) => {
  const t = useTranslate();
  const dark = isDarkTheme(useResolvedTheme());
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, AMap, error } = useAmapMap(containerRef, {
    center: latlng ?? DEFAULT_CENTER,
    zoom: 13,
    dark,
    // Wheel zoom in the editable dialog; keep it off for read-only previews
    // so wheeling over them scrolls the page instead of trapping the zoom.
    scrollWheel: !readOnly,
  });

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCenterChangeRef = useRef(onCenterChange);
  onCenterChangeRef.current = onCenterChange;
  const markerRef = useRef<AmapMarker | null>(null);

  // Click on the map places the marker.
  useEffect(() => {
    if (!map || readOnly) return;
    const handleClick = (e: AmapMapEvent) => {
      const [lat, lng] = gcj02ToWgs84(e.lnglat.getLat(), e.lnglat.getLng());
      onChangeRef.current({ lat, lng });
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map, readOnly]);

  // Keep the marker in sync with the latlng prop; recenter on change.
  useEffect(() => {
    if (!map || !AMap) return;
    if (!latlng) {
      if (markerRef.current) {
        map.remove(markerRef.current);
        markerRef.current = null;
      }
      return;
    }
    const position = toAmapLngLat(AMap, latlng);
    if (!markerRef.current) {
      markerRef.current = new AMap.Marker({
        position,
        content: defaultMarkerDot.html,
        offset: new AMap.Pixel(-defaultMarkerDot.size / 2, -defaultMarkerDot.size / 2),
      });
      map.add(markerRef.current);
    } else {
      markerRef.current.setPosition(position);
    }
    map.setCenter(position);
  }, [map, AMap, latlng?.lat, latlng?.lng]);

  // Report the map center for nearby-biased place search.
  useEffect(() => {
    if (!map) return;
    const handleMoveEnd = () => {
      const center = map.getCenter();
      const [lat, lng] = gcj02ToWgs84(center.getLat(), center.getLng());
      onCenterChangeRef.current?.({ lat, lng });
    };
    map.on("moveend", handleMoveEnd);
    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [map]);

  const handleOpenInAmap = () => {
    if (!latlng) return;
    // Amap URI API: position is lng,lat in GCJ-02. Convert from stored WGS-84.
    const [gLat, gLng] = wgs84ToGcj02(latlng.lat, latlng.lng);
    const url = `https://uri.amap.com/marker?position=${gLng},${gLat}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const statusLabel = latlng ? t("map.location-selected") : t("map.location-choose");

  return (
    <div
      className={cn(
        "memo-location-map relative isolate h-72 w-full overflow-hidden rounded-xl border border-border bg-background shadow-sm",
        className,
      )}
    >
      <div ref={containerRef} className="h-full w-full bg-muted" />
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-muted p-4 text-center text-sm text-muted-foreground">
          {AMAP_MISSING_KEY_MESSAGE}
        </div>
      )}

      {!readOnly && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
          <div className="rounded-full border border-border bg-background/92 px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] text-foreground/80 shadow-sm backdrop-blur-sm">
            {statusLabel}
          </div>
        </div>
      )}

      {map && (
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
          {latlng && (
            <GlassButton
              icon={<ExternalLinkIcon size={16} className="text-foreground" />}
              onClick={handleOpenInAmap}
              ariaLabel={t("map.open-in-amap-aria")}
              title={t("map.open-in-amap")}
            />
          )}
          <GlassButton
            icon={<PlusIcon size={16} className="text-foreground" />}
            onClick={() => map.zoomIn()}
            ariaLabel={t("map.zoom-in")}
            title={t("map.zoom-in")}
          />
          <GlassButton
            icon={<MinusIcon size={16} className="text-foreground" />}
            onClick={() => map.zoomOut()}
            ariaLabel={t("map.zoom-out")}
            title={t("map.zoom-out")}
          />
        </div>
      )}
    </div>
  );
};

export default LocationPicker;
