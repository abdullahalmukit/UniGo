import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../app/theme-provider";
import { mapStyle, type LatLng } from "../../lib/map-config";
import styles from "./TripMap.module.css";

// The map part of TripMap, loaded on demand (React.lazy) so MapLibre is only
// downloaded by pages that show a trip. Draws the road route, the pickup and
// destination pins and the live positions.

export type TripMarker = LatLng & { id: string; kind: "me" | "peer"; label: string; stale?: boolean };

const createMap = (options: maplibregl.MapOptions) => new maplibregl.Map(options);

const ROUTE_SOURCE = "trip-route";

// Map paint needs real colours: read them from the theme tokens.
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function pinElement(className: string, label: string) {
  const element = document.createElement("div");
  element.className = className;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", label);
  return element;
}

export function TripMapCanvas({
  pickup,
  destination,
  route,
  markers,
}: {
  pickup: LatLng;
  destination: LatLng;
  route: [number, number][] | null;
  markers: TripMarker[];
}) {
  const { t } = useTranslation();
  const { resolved } = useTheme();
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const liveMarkers = useRef(new Map<string, maplibregl.Marker>());
  const themeRef = useRef(resolved);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const drawRoute = (instance: maplibregl.Map) => {
    const coordinates = routeRef.current ?? [
      [pickup.lng, pickup.lat],
      [destination.lng, destination.lat],
    ];
    const data = { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } };
    const source = instance.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      instance.addSource(ROUTE_SOURCE, { type: "geojson", data });
      instance.addLayer({
        id: "trip-route-casing",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": token("--color-surface") || "white", "line-width": 8, "line-opacity": 0.9 },
      });
      instance.addLayer({
        id: "trip-route-line",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": token("--color-accent") || "blue",
          "line-width": 5,
          ...(routeRef.current ? {} : { "line-dasharray": [1, 2] }),
        },
      });
    }
  };

  // Created once per pickup and destination.
  useEffect(() => {
    if (!element.current) return;
    let cancelled = false;
    let instance: maplibregl.Map | null = null;
    fitted.current = false;
    setReady(false);
    void mapStyle(themeRef.current).then((style) => {
      if (cancelled || !element.current) return;
      try {
        instance = createMap({
        container: element.current,
        style,
        center: [(pickup.lng + destination.lng) / 2, (pickup.lat + destination.lat) / 2],
        zoom: 12,
        attributionControl: { compact: true },
      });
      } catch {
        // No WebGL (old device or browser): show the fallback instead of a map.
        setUnsupported(true);
        return;
      }
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      new maplibregl.Marker({ element: pinElement(styles.pickupPin, t("ride.pickup")) })
        .setLngLat([pickup.lng, pickup.lat])
        .addTo(instance);
      new maplibregl.Marker({ element: pinElement(styles.destinationPin, t("ride.destination")) })
        .setLngLat([destination.lng, destination.lat])
        .addTo(instance);
      // A theme change replaces the style, which removes the route layers.
      instance.on("style.load", () => drawRoute(instance!));
      instance.once("load", () => setReady(true));
      map.current = instance;
    });
    return () => {
      cancelled = true;
      for (const marker of liveMarkers.current.values()) marker.remove();
      liveMarkers.current.clear();
      instance?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup.lat, pickup.lng, destination.lat, destination.lng]);

  // The route line, and the view fitted to it once.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const apply = () => {
      drawRoute(instance);
      if (fitted.current && !route) return;
      const points = route ?? [
        [pickup.lng, pickup.lat],
        [destination.lng, destination.lat],
      ];
      const bounds = points.reduce(
        (box, point) => box.extend(point as [number, number]),
        new maplibregl.LngLatBounds(points[0] as [number, number], points[0] as [number, number]),
      );
      instance.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: fitted.current ? 600 : 0 });
      fitted.current = true;
    };
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || resolved === themeRef.current) return;
    themeRef.current = resolved;
    void mapStyle(resolved).then((style) => instance.setStyle(style));
  }, [resolved]);

  // Live positions
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const seen = new Set<string>();
    for (const marker of markers) {
      seen.add(marker.id);
      const className = `${marker.kind === "me" ? styles.mePin : styles.peerPin} ${marker.stale ? styles.stale : ""}`;
      const existing = liveMarkers.current.get(marker.id);
      if (existing) {
        existing.setLngLat([marker.lng, marker.lat]);
        existing.getElement().className = className;
        existing.getElement().setAttribute("aria-label", marker.label);
      } else {
        liveMarkers.current.set(marker.id, new maplibregl.Marker({ element: pinElement(className, marker.label) }).setLngLat([marker.lng, marker.lat]).addTo(instance));
      }
    }
    for (const [id, marker] of liveMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        liveMarkers.current.delete(id);
      }
    }
  }, [markers, ready]);

  if (unsupported) return <div className={styles.unsupported}>{t("trip.mapUnsupported")}</div>;
  return <div ref={element} className={styles.map} role="application" aria-label={t("trip.mapLabel")} />;
}
