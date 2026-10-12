import { DivIcon } from "leaflet";
import ReactDOMServer from "react-dom/server";
import { AttributionControl, TileLayer, type TileLayerProps } from "react-leaflet";

const OPENSTREETMAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const OPENSTREETMAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const OpenStreetMapTileLayer = ({ eventHandlers }: Pick<TileLayerProps, "eventHandlers"> = {}) => (
  <TileLayer url={OPENSTREETMAP_TILE_URL} attribution={OPENSTREETMAP_ATTRIBUTION} maxZoom={19} eventHandlers={eventHandlers} />
);

// Amap (高德) standard tiles. Public tile endpoint, no API key required.
// Tiles are in GCJ-02; convert WGS-84 coordinates with gcj02.ts before placing markers.
const AMAP_TILE_URL = "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}";

const AMAP_ATTRIBUTION = '&copy; <a href="https://www.amap.com/">高德地图</a>';

interface AmapTileLayerProps extends Pick<TileLayerProps, "eventHandlers"> {
  /** Apply dark-mode CSS filter to tiles (Amap publishes no dark tile style). */
  dark?: boolean;
}

export const AmapTileLayer = ({ dark, eventHandlers }: AmapTileLayerProps = {}) => (
  <TileLayer
    url={AMAP_TILE_URL}
    subdomains={["1", "2", "3", "4"]}
    attribution={AMAP_ATTRIBUTION}
    maxZoom={18}
    eventHandlers={eventHandlers}
    className={dark ? "amap-tiles-dark" : undefined}
  />
);

export const MinimalAttributionControl = () => <AttributionControl prefix={false} />;

interface MarkerIconOptions {
  /** The box the dot is centered in; with a halo the tinted disc fills it. */
  size?: number;
  /** Dot diameter. Defaults to the box minus 4px, the bare dot's breathing room. */
  dot?: number;
  /** A translucent disc behind the dot marks the selected point without a heavier dot. */
  halo?: boolean;
}

export const createMarkerIcon = (options?: MarkerIconOptions): DivIcon => {
  const { size = 24, dot = size - 4, halo = false } = options || {};
  return new DivIcon({
    className: "relative border-none bg-transparent",
    html: ReactDOMServer.renderToString(
      <div
        aria-hidden="true"
        className={`grid place-items-center rounded-full ${halo ? "bg-primary/20" : ""}`.trim()}
        style={{ width: size, height: size }}
      >
        <span
          className="rounded-full border-2 border-white shadow-[0_1px_4px_rgba(15,23,42,0.4)]"
          style={{ width: dot, height: dot, backgroundColor: "var(--primary)" }}
        />
      </div>,
    ),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 6)],
  });
};

export const defaultMarkerIcon = createMarkerIcon();
