import { Clock, LocateFixed, LocateOff, Route as RouteIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchRoute, metresBetween, type LatLng, type Route } from "../../lib/map-config";
import { FullscreenButton } from "../FullscreenButton";
import { buttonStyles } from "../ui";
import type { TripMarker } from "./TripMapCanvas";
import styles from "./TripMap.module.css";
import { STALE_AFTER_MS, useLiveLocation, type LivePosition } from "./use-live-location";

const TripMapCanvas = lazy(() => import("./TripMapCanvas").then((module) => ({ default: module.TripMapCanvas })));

// Ride route map: the road from pickup to destination with its distance and
// driving time. For the two participants of an accepted or started ride it
// also offers live location: each one can share their position with the
// other, and the time to the pickup (accepted) or to the destination
// (started) follows the shared position.

// A new arrival time is asked for when the position moved this far, at most this often.
const ETA_MOVE_METRES = 150;
const ETA_EVERY_MS = 30_000;

export type TripStatus = "OPEN" | "ACCEPTED" | "IN_PROGRESS" | "DISPUTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "NOT_MARKED";

export function formatDuration(seconds: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return t("trip.minutes", { count: minutes });
  return t("trip.hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function formatKm(metres: number, language: string) {
  return (metres / 1000).toLocaleString(language === "bn" ? "bn-BD" : "en-US", { maximumFractionDigits: 1 });
}

export function TripMap({
  pickup,
  destination,
  activityId,
  status,
  participant = false,
  peerName,
}: {
  pickup: LatLng;
  destination: LatLng;
  // With an activity and a participant viewer: live location
  activityId?: string;
  status?: TripStatus;
  participant?: boolean;
  peerName?: string;
}) {
  const { t, i18n } = useTranslation();
  const mapWrap = useRef<HTMLDivElement>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routeFailed, setRouteFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRouteFailed(false);
    fetchRoute(pickup, destination).then(
      (value) => !cancelled && setRoute(value),
      () => !cancelled && setRouteFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [pickup.lat, pickup.lng, destination.lat, destination.lng]);

  const liveAllowed = Boolean(activityId && participant && (status === "ACCEPTED" || status === "IN_PROGRESS"));
  const live = useLiveLocation(activityId ?? "", liveAllowed);

  // Re-render every 15 s so "last seen" stays right.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live.peer) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [live.peer]);

  const peerStale = live.peer ? now - live.peer.at > STALE_AFTER_MS : false;
  const markers = useMemo<TripMarker[]>(() => {
    const list: TripMarker[] = [];
    if (live.mine) list.push({ id: "me", kind: "me", lat: live.mine.lat, lng: live.mine.lng, label: t("trip.you") });
    if (live.peer) list.push({ id: "peer", kind: "peer", lat: live.peer.lat, lng: live.peer.lng, label: peerName ?? t("trip.otherPerson"), stale: peerStale });
    return list;
  }, [live.mine, live.peer, peerStale, peerName, t]);

  // Arrival time from the moving person: my shared position, else the other's.
  const moving: LivePosition | null = live.mine ?? (live.peer && !peerStale ? live.peer : null);
  const target = status === "IN_PROGRESS" ? destination : pickup;
  const eta = useLiveEta(liveAllowed ? moving : null, target);

  return (
    <section className={styles.card} aria-label={t("trip.title")}>
      <div ref={mapWrap} className={styles.mapWrap}>
        <FullscreenButton target={mapWrap} className={styles.expand} />
        <Suspense fallback={<div className={styles.map} aria-hidden />}>
          <TripMapCanvas pickup={pickup} destination={destination} route={route?.coordinates.length ? route.coordinates : null} markers={markers} />
        </Suspense>
      </div>
      <div className={styles.summary}>
        {route ? (
          <>
            <span className={styles.fact}>
              <RouteIcon aria-hidden size={16} />
              {t("trip.distance", { km: formatKm(route.distanceMeters, i18n.language) })}
            </span>
            <span className={styles.fact}>
              <Clock aria-hidden size={16} />
              {t("trip.driveTime", { time: formatDuration(route.durationSeconds, t) })}
            </span>
          </>
        ) : (
          <span className={styles.muted}>{routeFailed ? t("trip.routeUnavailable") : t("trip.loadingRoute")}</span>
        )}
      </div>

      {liveAllowed && (
        <div className={styles.live}>
          {eta && (
            <p className={styles.eta} aria-live="polite">
              {status === "IN_PROGRESS"
                ? t("trip.etaDestination", { time: formatDuration(eta.durationSeconds, t), km: formatKm(eta.distanceMeters, i18n.language) })
                : t("trip.etaPickup", { time: formatDuration(eta.durationSeconds, t), km: formatKm(eta.distanceMeters, i18n.language) })}
            </p>
          )}
          {live.peer && (
            <p className={styles.muted}>
              {peerStale
                ? t("trip.peerLastSeen", { name: peerName ?? t("trip.otherPerson"), minutes: Math.round((now - live.peer.at) / 60_000) })
                : t("trip.peerSharing", { name: peerName ?? t("trip.otherPerson") })}
            </p>
          )}
          {live.sharing ? (
            <button type="button" className={buttonStyles.secondary} onClick={live.stop}>
              <LocateOff aria-hidden size={18} /> {t("trip.stopSharing")}
            </button>
          ) : (
            <button type="button" className={buttonStyles.primary} onClick={live.start}>
              <LocateFixed aria-hidden size={18} /> {t("trip.shareLocation")}
            </button>
          )}
          <p className={styles.muted}>{t("trip.privacy")}</p>
          {live.error && (
            <p className={styles.error} role="alert">
              {t(`trip.errors.${live.error}`, { defaultValue: t(`errors.${live.error}`, { defaultValue: t("trip.errors.UNAVAILABLE") }) })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function useLiveEta(from: LatLng | null, to: LatLng) {
  const [eta, setEta] = useState<Route | null>(null);
  const last = useRef<{ point: LatLng; at: number; to: LatLng } | null>(null);

  useEffect(() => {
    if (!from) {
      setEta(null);
      last.current = null;
      return;
    }
    const previous = last.current;
    const sameTarget = previous && previous.to.lat === to.lat && previous.to.lng === to.lng;
    if (sameTarget && (metresBetween(previous.point, from) < ETA_MOVE_METRES || Date.now() - previous.at < ETA_EVERY_MS)) return;
    last.current = { point: from, at: Date.now(), to };
    let cancelled = false;
    fetchRoute(from, to).then(
      (value) => !cancelled && setEta(value),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [from?.lat, from?.lng, to.lat, to.lng]);

  return eta;
}
