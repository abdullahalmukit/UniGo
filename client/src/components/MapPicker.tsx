import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { LocateFixed, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../app/theme-provider";
import { mapStyle } from "../lib/map-config";
import type { LatLng } from "./map-types";
import styles from "./MapPicker.module.css";

// Barikoi map tiles (OpenStreetMap without a Barikoi key) drawn with MapLibre.
// Loaded on demand (React.lazy), so the map library is only downloaded by
// pages that show a map (B1). The pin stays in the centre and the user moves
// the map under it; `onMove` gets the centre after each move. A new `center`
// from outside (a search result) moves the map there.
const createMap = (options: maplibregl.MapOptions) => new maplibregl.Map(options);

export function MapPicker({
  center,
  zoom = 16,
  onMove,
}: {
  center: LatLng;
  zoom?: number;
  onMove: (point: LatLng) => void;
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const initial = useRef({ center, zoom, theme: resolved });
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    if (!element.current) return;
    let cancelled = false;
    let instance: maplibregl.Map | null = null;
    void mapStyle(initial.current.theme).then((style) => {
      if (cancelled || !element.current) return;
      try {
        instance = createMap({
        container: element.current,
        style,
        center: [initial.current.center.lng, initial.current.center.lat],
        zoom: initial.current.zoom,
        attributionControl: { compact: true },
      });
      } catch {
        // No WebGL (old device or browser): show the fallback instead of a map.
        setUnsupported(true);
        return;
      }
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      instance.on("moveend", () => {
        const { lat, lng } = instance!.getCenter();
        onMoveRef.current({ lat, lng });
      });
      map.current = instance;
    });
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
    };
    // The map is created once; later centres and themes are applied below.
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || resolved === initial.current.theme) return;
    initial.current.theme = resolved;
    void mapStyle(resolved).then((style) => instance.setStyle(style));
  }, [resolved]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) {
      initial.current.center = center;
      return;
    }
    const current = instance.getCenter();
    if (Math.abs(current.lat - center.lat) > 1e-6 || Math.abs(current.lng - center.lng) > 1e-6) {
      instance.jumpTo({ center: [center.lng, center.lat], zoom: Math.max(instance.getZoom(), zoom) });
    }
  }, [center.lat, center.lng, zoom]);

  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => map.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 17 }),
      () => {},
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className={styles.wrap}>
      {unsupported ? (
        <div className={styles.unsupported}>{t("trip.mapUnsupported")}</div>
      ) : (
        <div ref={element} className={styles.map} role="application" aria-label={t("addresses.mapLabel")} />
      )}
      <MapPin aria-hidden className={styles.pin} size={36} strokeWidth={2.25} />
      {"geolocation" in navigator && (
        <button type="button" className={styles.locate} onClick={locate} aria-label={t("addresses.useMyLocation")}>
          <LocateFixed aria-hidden size={20} />
        </button>
      )}
    </div>
  );
}
