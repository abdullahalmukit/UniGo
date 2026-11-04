import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { LocateFixed, MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { LatLng } from "./map-types";
import styles from "./MapPicker.module.css";

// OpenStreetMap + Leaflet (CLAUDE.md 2). Loaded on demand (React.lazy), so
// Leaflet is only downloaded by pages that show a map (B1). The pin stays in
// the centre and the user moves the map under it; `onMove` gets the centre after each move. A new
// `center` from outside (a search result) moves the map there.
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
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: true, attributionControl: true }).setView(
      [center.lat, center.lng],
      zoom,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    instance.on("moveend", () => {
      const { lat, lng } = instance.getCenter();
      onMoveRef.current({ lat, lng });
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
    // The map is created once; later centres move it below.
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const current = instance.getCenter();
    if (Math.abs(current.lat - center.lat) > 1e-6 || Math.abs(current.lng - center.lng) > 1e-6) {
      instance.setView([center.lat, center.lng], Math.max(instance.getZoom(), zoom));
    }
  }, [center.lat, center.lng, zoom]);

  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => map.current?.setView([coords.latitude, coords.longitude], 17),
      () => {},
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className={styles.wrap}>
      <div ref={element} className={styles.map} role="application" aria-label={t("addresses.mapLabel")} />
      <MapPin aria-hidden className={styles.pin} size={36} strokeWidth={2.25} />
      {"geolocation" in navigator && (
        <button type="button" className={styles.locate} onClick={locate} aria-label={t("addresses.useMyLocation")}>
          <LocateFixed aria-hidden size={20} />
        </button>
      )}
    </div>
  );
}
