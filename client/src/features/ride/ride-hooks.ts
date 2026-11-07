import { useEffect, useState } from "react";
import { useMe } from "../account/account-api";
import { getRiderOverview, type RiderVehicle } from "../rider/rider-api";
import { getRideConfig, type RideConfig } from "./ride-api";

export type RiderStatus = {
  // Verified & Active Rider: can offer rides and accept requests
  canOffer: boolean;
  // Approved vehicles (the rider's own view, full registration number)
  vehicles: RiderVehicle[];
};

// The logged-in user's rider state; null while loading.
export function useRiderStatus(): RiderStatus | null {
  const me = useMe();
  const [status, setStatus] = useState<RiderStatus | null>(null);
  const isRider = me?.isVerifiedRider ?? false;

  useEffect(() => {
    if (!isRider) {
      setStatus({ canOffer: false, vehicles: [] });
      return;
    }
    let cancelled = false;
    getRiderOverview()
      .then((overview) => {
        if (cancelled) return;
        setStatus({
          canOffer: overview.riderActive && !overview.activeBlocker,
          vehicles: overview.vehicles.filter((vehicle) => vehicle.status === "APPROVED"),
        });
      })
      .catch(() => !cancelled && setStatus({ canOffer: false, vehicles: [] }));
    return () => {
      cancelled = true;
    };
  }, [isRider]);

  return status;
}

let configCache: Promise<RideConfig> | null = null;

// Limits from the server (rules.ts), never hard-coded here.
export function useRideConfig() {
  const [config, setConfig] = useState<RideConfig | null>(null);
  useEffect(() => {
    configCache ??= getRideConfig().catch((error) => {
      configCache = null;
      throw error;
    });
    let cancelled = false;
    configCache.then((value) => !cancelled && setConfig(value)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
