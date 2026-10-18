import { useEffect, useRef } from "react";
import { getLocationDisplayText } from "@/components/MemoMetadata/Location/locationHelpers";
import { AMAP_MISSING_KEY_MESSAGE, type AmapMap, type AmapMarker, type AmapStatic } from "@/components/map/amap";
import { gcj02ToWgs84, wgs84ToGcj02 } from "@/components/map/gcj02";
import { faceIconHTML, faceKey, markerDotHTML } from "@/components/map/map-utils";
import { useAmapMap } from "@/components/map/useAmapMap";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { isDarkTheme } from "@/utils/theme";
import { type MapPin, type MapPinFace, type MapViewport, revealOffset } from "./model";

export interface MapController {
  fitMemos(memos: Memo[]): void;
  zoomIn(): void;
  zoomOut(): void;
}

interface Props {
  memos: Memo[];
  /** Each memo's face and label by name; a memo without one shows the plain dot and its place. */
  pins: ReadonlyMap<string, MapPin>;
  selected: string[];
  viewport?: MapViewport;
  complete: boolean;
  desktop: boolean;
  panelSize: { width: number; height: number };
  onSelect: (names: string[]) => void;
  /** A click on bare map, which reads as "put that away" the way it does on a place card. */
  onDismiss: () => void;
  onMove: (viewport: MapViewport) => void;
  onReady: (ctl: MapController | null) => void;
  onMapError: () => void;
}

// Amap's own POI dots are small; ours are bigger, colored and white-edged so they never blend in.
const markerDot = markerDotHTML({ size: 22, dot: 16 });
const selectedDot = markerDotHTML({ size: 36, dot: 20, halo: true });

/** Grid cell size (px) for manual clustering. */
const GRID_SIZE = 40;

interface ClusterMember {
  memo: Memo;
  /** GCJ-02, for the SDK. */
  lat: number;
  lng: number;
  face: MapPinFace;
  label: string;
}

function clusterBadgeHTML(count: number, active: boolean): string {
  return `<span class="${cn(
    "grid size-7 place-items-center rounded-full border-[1.5px] border-background bg-primary text-primary-foreground text-xs font-medium tabular-nums shadow-[0_1px_3px_rgba(15,23,42,0.35)]",
    active && "outline-[4px] outline-primary/20",
  )}">${count}</span>`;
}

export function MapCanvas(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dark = isDarkTheme(useResolvedTheme());
  const initialViewport = useRef(props.viewport);
  // Default to a China-centered view; the canvas fits memos once they load.
  const initCenter = initialViewport.current ?? { lat: 35, lng: 105, zoom: 4 };

  const { map, AMap, error } = useAmapMap(containerRef, {
    center: { lat: initCenter.lat, lng: initCenter.lng },
    zoom: initCenter.zoom,
    dark,
  });

  const latest = useRef(props);
  latest.current = props;
  const mapRef = useRef<AmapMap | null>(null);
  const apiRef = useRef<AmapStatic | null>(null);
  const markerPool = useRef(new Map<string, AmapMarker>());
  const initialFit = useRef(Boolean(props.viewport));
  // Suppress the map click that follows a marker/cluster click.
  const suppressMapClickUntil = useRef(0);

  useEffect(() => {
    mapRef.current = map;
    apiRef.current = AMap;
  }, [map, AMap]);

  useEffect(() => {
    if (error) latest.current.onMapError();
  }, [error]);

  // Icon for a memo pin: one per face and selection state.
  const iconCache = useRef(new Map<string, { html: string; size: number }>());
  const iconFor = (face: MapPinFace, isSelected: boolean): { html: string; size: number } => {
    if (face.kind === "dot") return isSelected ? selectedDot : markerDot;
    const key = `${faceKey(face)}:${isSelected}`;
    let icon = iconCache.current.get(key);
    if (!icon) {
      icon = faceIconHTML(face, isSelected);
      iconCache.current.set(key, icon);
    }
    return icon;
  };

  const refreshClusters = useRef(() => {});
  refreshClusters.current = () => {
    const map = mapRef.current;
    const AMap = apiRef.current;
    if (!map || !AMap) return;
    const { memos, pins, selected } = latest.current;
    const selection = new Set(selected);
    const size = map.getSize();
    const width = size.getWidth();
    const height = size.getHeight();

    interface Desired {
      id: string;
      lat: number;
      lng: number;
      html: string;
      iconSize: number;
      title: string;
      zIndex: number;
      onClick: () => void;
    }
    const desired = new Map<string, Desired>();

    // Grid-cluster the memos visible in the viewport (with one cell of padding).
    const groups = new Map<string, { x: number; y: number; members: ClusterMember[] }>();
    for (const memo of memos) {
      if (!memo.location) continue;
      const [lat, lng] = wgs84ToGcj02(memo.location.latitude, memo.location.longitude);
      const px = map.lngLatToContainer(new AMap.LngLat(lng, lat));
      const x = px.getX();
      const y = px.getY();
      if (x < -GRID_SIZE || x > width + GRID_SIZE || y < -GRID_SIZE || y > height + GRID_SIZE) continue;
      const key = `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;
      let group = groups.get(key);
      if (!group) {
        group = { x: 0, y: 0, members: [] };
        groups.set(key, group);
      }
      const pin = pins.get(memo.name);
      group.members.push({
        memo,
        lat,
        lng,
        face: pin?.face ?? { kind: "dot" },
        label: pin?.label ?? getLocationDisplayText(memo.location),
      });
      group.x += x;
      group.y += y;
    }

    for (const [key, group] of groups) {
      if (group.members.length === 1) {
        const member = group.members[0];
        const isSelected = selection.has(member.memo.name);
        const icon = iconFor(member.face, isSelected);
        desired.set(`memo:${member.memo.name}`, {
          id: `memo:${member.memo.name}`,
          lat: member.lat,
          lng: member.lng,
          html: icon.html,
          iconSize: icon.size,
          title: member.label,
          zIndex: isSelected ? 1000 : 0,
          onClick: () => {
            suppressMapClickUntil.current = Date.now() + 300;
            latest.current.onSelect([member.memo.name]);
          },
        });
      } else {
        const names = group.members.map((m) => m.memo.name);
        const active = names.some((n) => selection.has(n));
        const cx = group.x / group.members.length;
        const cy = group.y / group.members.length;
        const lnglat = map.containerToLngLat(new AMap.Pixel(cx, cy));
        desired.set(`cluster:${key}`, {
          id: `cluster:${key}`,
          lat: lnglat.getLat(),
          lng: lnglat.getLng(),
          html: clusterBadgeHTML(group.members.length, active),
          iconSize: 28,
          title: `${group.members.length} memos`,
          zIndex: active ? 1000 : 0,
          onClick: () => {
            suppressMapClickUntil.current = Date.now() + 300;
            latest.current.onSelect(names);
          },
        });
      }
    }

    // Reconcile the marker pool with the desired set.
    const pool = markerPool.current;
    for (const [id, marker] of pool) {
      if (!desired.has(id)) {
        map.remove(marker);
        pool.delete(id);
      }
    }
    for (const [id, d] of desired) {
      let marker = pool.get(id);
      if (!marker) {
        marker = new AMap.Marker({
          position: new AMap.LngLat(d.lng, d.lat),
          content: d.html,
          offset: new AMap.Pixel(-d.iconSize / 2, -d.iconSize / 2),
          title: d.title,
          zIndex: d.zIndex,
        });
        marker.on("click", d.onClick);
        // Stash the click handler so a refresh with the same id keeps one listener.
        marker.setExtData(d.onClick);
        pool.set(id, marker);
        map.add(marker);
      } else {
        marker.setPosition(new AMap.LngLat(d.lng, d.lat));
        marker.setContent(d.html);
        marker.setTitle(d.title);
        marker.setzIndex(d.zIndex);
        const prevOnClick = marker.getExtData() as (() => void) | undefined;
        if (prevOnClick !== d.onClick) {
          if (prevOnClick) marker.off("click", prevOnClick);
          marker.on("click", d.onClick);
          marker.setExtData(d.onClick);
        }
      }
    }
  };

  // Re-cluster when the view settles, when data changes, or when selection changes.
  useEffect(() => {
    if (!map) return;
    const refresh = () => refreshClusters.current();
    map.on("moveend", refresh);
    map.on("zoomend", refresh);
    return () => {
      map.off("moveend", refresh);
      map.off("zoomend", refresh);
    };
  }, [map]);
  useEffect(() => {
    refreshClusters.current();
  }, [map, props.memos, props.pins, props.selected]);

  // Report viewport moves (stored in the URL as WGS-84).
  useEffect(() => {
    if (!map) return;
    const handleMoveEnd = () => {
      const center = map.getCenter();
      const [lat, lng] = gcj02ToWgs84(center.getLat(), center.getLng());
      latest.current.onMove({ lat, lng, zoom: map.getZoom() });
    };
    map.on("moveend", handleMoveEnd);
    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [map]);

  // A click on bare map dismisses the selection; marker clicks suppress it.
  useEffect(() => {
    if (!map) return;
    const handleClick = () => {
      if (Date.now() < suppressMapClickUntil.current) return;
      latest.current.onDismiss();
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map]);

  // Follow an external viewport (deep link / back button).
  useEffect(() => {
    if (!map || !AMap) return;
    const viewport = props.viewport;
    if (!viewport) return;
    const [vLat, vLng] = wgs84ToGcj02(viewport.lat, viewport.lng);
    const center = map.getCenter();
    if (Math.abs(center.getLat() - vLat) > 0.00002 || Math.abs(center.getLng() - vLng) > 0.00002 || map.getZoom() !== viewport.zoom) {
      map.setZoomAndCenter(viewport.zoom, new AMap.LngLat(vLng, vLat));
    }
  }, [map, AMap, props.viewport?.lat, props.viewport?.lng, props.viewport?.zoom]);

  const fitMemosToMap = (memos: Memo[]) => {
    const map = mapRef.current;
    const AMap = apiRef.current;
    if (!map || !AMap || memos.length === 0) return;
    const markers = memos.flatMap((memo) => {
      if (!memo.location) return [];
      const [lat, lng] = wgs84ToGcj02(memo.location.latitude, memo.location.longitude);
      return [new AMap.Marker({ position: new AMap.LngLat(lng, lat) })];
    });
    // setFitView with padding [top, right, bottom, left] and a max zoom.
    map.setFitView(markers, false, [64, 96, 64, 96], 15);
  };

  // Expose the controller (fitMemos for the "show all" button, zoom for the +/- stack).
  useEffect(() => {
    if (!map) return;
    const ctl: MapController = {
      fitMemos: fitMemosToMap,
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
    };
    latest.current.onReady(ctl);
    return () => {
      latest.current.onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Fit once all memos arrive.
  useEffect(() => {
    if (!map || !props.complete || initialFit.current) return;
    initialFit.current = true;
    fitMemosToMap(props.memos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, props.complete, props.memos]);

  // Pan a selected memo clear of the side panel.
  const selectedName = props.selected[0];
  const selectedLocation = props.memos.find((item) => item.name === selectedName)?.location;
  useEffect(() => {
    if (!map || !AMap || !selectedLocation || !props.panelSize.width) return;
    const [sLat, sLng] = wgs84ToGcj02(selectedLocation.latitude, selectedLocation.longitude);
    const point = map.lngLatToContainer(new AMap.LngLat(sLng, sLat));
    const size = map.getSize();
    const offset = revealOffset(
      { x: point.getX(), y: point.getY() },
      { x: size.getWidth(), y: size.getHeight() },
      props.panelSize,
      props.desktop,
    );
    if (offset[0] || offset[1]) map.panBy(offset[0], offset[1]);
  }, [
    map,
    AMap,
    selectedName,
    props.panelSize.width,
    props.panelSize.height,
    props.desktop,
    selectedLocation?.latitude,
    selectedLocation?.longitude,
  ]);

  return (
    <div className="absolute! inset-0 z-0 bg-muted">
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-muted p-4 text-center text-sm text-muted-foreground">
          {AMAP_MISSING_KEY_MESSAGE}
        </div>
      )}
    </div>
  );
}
