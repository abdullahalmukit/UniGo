import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_CENTER } from "../../components/map-types";
import type { RideItem } from "./ride-api";

// The Ride page map (proposal 8.1): a pin at the pickup of every request and
// offer in the list. Tapping a pin opens that ride. Loaded on demand.
export function RideMap({ items, onOpen }: { items: RideItem[]; onOpen: (path: string) => void }) {
  const { t } = useTranslation();
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: true }).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layer.current;
    const instance = map.current;
    if (!group || !instance) return;
    group.clearLayers();
    // Theme colours, read from the tokens so light and dark both work
    const styles = getComputedStyle(document.documentElement);
    const offerColour = styles.getPropertyValue("--color-accent").trim() || "#0a6fd6";
    const requestColour = styles.getPropertyValue("--color-text").trim() || "#0f1b2d";
    const points: L.LatLngExpression[] = [];
    for (const item of items) {
      const isOffer = item.kind === "OFFER";
      const latLng: L.LatLngExpression = [item.pickup.lat, item.pickup.lng];
      points.push(latLng);
      L.circleMarker(latLng, { radius: 9, weight: 2, color: isOffer ? offerColour : requestColour, fillOpacity: 0.6 })
        .bindTooltip(`${isOffer ? t("ride.kind.offer") : t("ride.kind.request")}: ${item.pickup.address}`)
        .on("click", () => openRef.current(isOffer ? `/ride/offers/${item.id}` : `/ride/requests/${item.id}`))
        .addTo(group);
    }
    if (points.length > 0) instance.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 15 });
  }, [items, t]);

  return <div ref={element} style={{ height: "100%" }} role="region" aria-label={t("ride.mapLabel")} />;
}
