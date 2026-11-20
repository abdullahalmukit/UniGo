import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng } from "../../lib/map-config";
import { chatSocket, type AckError } from "../../lib/socket";

// Live location during a ride. Sharing is turned on by the user for this
// activity only; positions go over the socket to the other participant and
// are never stored. The other participant's position arrives the same way.

export type LivePosition = LatLng & { at: number; accuracy?: number; heading?: number | null };

const SEND_EVERY_MS = 3000;
// A position older than this is shown as "last seen"
export const STALE_AFTER_MS = 60_000;

type Update = { activityId: string; userId: string; lat: number; lng: number; accuracy?: number; heading?: number | null; at: string };

export function useLiveLocation(activityId: string, allowed: boolean) {
  const [sharing, setSharing] = useState(false);
  const [mine, setMine] = useState<LivePosition | null>(null);
  const [peer, setPeer] = useState<LivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    const offUpdate = chatSocket.on("location:update", ((update: Update) => {
      if (update.activityId !== activityId) return;
      setPeer({ lat: update.lat, lng: update.lng, accuracy: update.accuracy, heading: update.heading, at: Date.parse(update.at) || Date.now() });
    }) as never);
    const offStop = chatSocket.on("location:stopped", ((event: { activityId: string }) => {
      if (event.activityId === activityId) setPeer(null);
    }) as never);
    return () => {
      offUpdate();
      offStop();
    };
  }, [activityId]);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    lastSent.current = 0;
    setSharing(false);
    setMine(null);
    chatSocket.emit("location:stop", { activityId });
  }, [activityId]);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("UNSUPPORTED");
      return;
    }
    setError(null);
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const position: LivePosition = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          heading: coords.heading,
          at: Date.now(),
        };
        setMine(position);
        if (Date.now() - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = Date.now();
        chatSocket
          .emitWithAck<{ ok: true }>("location:share", {
            activityId,
            lat: position.lat,
            lng: position.lng,
            accuracy: Math.min(100_000, Math.round(coords.accuracy)),
            heading: coords.heading !== null && Number.isFinite(coords.heading) ? coords.heading : null,
            speed: coords.speed !== null && Number.isFinite(coords.speed) ? Math.min(200, coords.speed) : null,
          })
          .then((response) => {
            const failure = (response as AckError).error;
            if (failure) {
              setError(failure.code);
              stop();
            }
          })
          .catch(() => {
            // Offline for a moment: the next position tries again.
          });
      },
      (failure) => {
        setError(failure.code === failure.PERMISSION_DENIED ? "PERMISSION_DENIED" : "UNAVAILABLE");
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
  }, [activityId, stop]);

  // Sharing ends when the ride can no longer share or the page closes.
  useEffect(() => {
    if (!allowed && watchId.current !== null) stop();
  }, [allowed, stop]);
  useEffect(() => () => {
    if (watchId.current !== null) {
      navigator.geolocation?.clearWatch(watchId.current);
      chatSocket.emit("location:stop", { activityId });
    }
  }, [activityId]);

  return { sharing, mine, peer, error, start, stop };
}
