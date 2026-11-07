import { MapPin, Search } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import formStyles from "../../components/form.module.css";
import { BottomSheet, TextField } from "../../components/form";
import { buttonStyles } from "../../components/ui";
import { DEFAULT_CENTER, type LatLng } from "../../components/map-types";
import { geocoder } from "../../lib/nominatim";
import { useDebounced } from "../../lib/use-debounced";
import { searchSubAreas } from "../account/account-api";
import { SEARCH_DEBOUNCE_MS } from "../account/rules";
import type { Place } from "./ride-api";
import styles from "./ride.module.css";

// Leaflet loads only when a picker opens (B1).
const MapPicker = lazy(() => import("../../components/MapPicker").then((module) => ({ default: module.MapPicker })));

// A place field: shows the chosen address; opens a sheet with search and a
// map whose centre pin picks the point. The address fills in from the map.
export function PlaceField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className={formStyles.field}>
      <span className={formStyles.label}>{label}</span>
      <button type="button" className={styles.placeButton} onClick={() => setOpen(true)} aria-invalid={error ? true : undefined}>
        <MapPin aria-hidden size={18} />
        <span className={value ? undefined : styles.placeEmpty}>{value?.address ?? t("ride.place.choose")}</span>
      </button>
      {error && <p className={formStyles.error}>{error}</p>}
      {open && <PlaceSheet title={label} initial={value} onClose={close} onPick={(place) => (onChange(place), close())} />}
    </div>
  );
}

function PlaceSheet({ title, initial, onClose, onPick }: { title: string; initial: Place | null; onClose: () => void; onPick: (place: Place) => void }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "bn" ? "bn" : "en";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [point, setPoint] = useState<LatLng>(initial ?? DEFAULT_CENTER);
  const [center, setCenter] = useState<LatLng>(initial ?? DEFAULT_CENTER);
  const [address, setAddress] = useState(initial?.address ?? "");
  const [failed, setFailed] = useState(false);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const keepAddressOnce = useRef(false);
  const lookupId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    geocoder
      .search(debounced, language)
      .then((places) => !cancelled && (setResults(places), setFailed(false)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [debounced, language]);

  const onMove = useCallback(
    (next: LatLng) => {
      setPoint(next);
      if (keepAddressOnce.current) {
        keepAddressOnce.current = false;
        return;
      }
      const current = ++lookupId.current;
      geocoder
        .reverse(next.lat, next.lng, language)
        .then((name) => name && current === lookupId.current && setAddress(name))
        .catch(() => undefined);
    },
    [language],
  );

  const choose = (place: { label: string; lat: number; lng: number }) => {
    keepAddressOnce.current = true;
    lookupId.current += 1;
    setAddress(place.label);
    setCenter({ lat: place.lat, lng: place.lng });
    setPoint({ lat: place.lat, lng: place.lng });
    setResults([]);
    setQuery("");
  };

  return (
    <BottomSheet title={title} open onClose={onClose}>
      <TextField
        label={t("ride.place.search")}
        value={query}
        onChange={setQuery}
        trailing={<Search aria-hidden size={18} />}
        hint={failed ? t("errors.GEO_UNAVAILABLE") : undefined}
      />
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((place) => (
            <li key={`${place.lat},${place.lng}`}>
              <button type="button" className={styles.result} onClick={() => choose(place)}>
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.pickerMap}>
        <Suspense fallback={<p className={styles.muted}>{t("app.loading")}</p>}>
          <MapPicker center={center} onMove={onMove} />
        </Suspense>
      </div>
      <TextField label={t("ride.place.address")} value={address} onChange={setAddress} maxLength={255} />
      <button
        type="button"
        className={buttonStyles.primary}
        disabled={!address.trim()}
        onClick={() => onPick({ address: address.trim(), lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) })}
      >
        {t("ride.place.use")}
      </button>
    </BottomSheet>
  );
}

// One sub-area from the admin list (users cannot create sub-areas).
export function SubAreaField({
  label,
  value,
  onChange,
  error,
  optional = false,
}: {
  label: string;
  value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void;
  error?: string;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    searchSubAreas(debounced.trim())
      .then((list) => !cancelled && setItems(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, debounced]);

  return (
    <div className={formStyles.field}>
      <span className={formStyles.label}>{label}</span>
      <button type="button" className={styles.placeButton} onClick={() => setOpen(true)} aria-invalid={error ? true : undefined}>
        <span className={value ? undefined : styles.placeEmpty}>{value?.name ?? t("ride.subArea.choose")}</span>
      </button>
      {error && <p className={formStyles.error}>{error}</p>}
      <BottomSheet title={label} open={open} onClose={close}>
        <TextField label={t("ride.subArea.search")} value={query} onChange={setQuery} trailing={<Search aria-hidden size={18} />} />
        <ul className={styles.results}>
          {optional && (
            <li>
              <button type="button" className={styles.result} onClick={() => (onChange(null), close())}>
                {t("ride.subArea.none")}
              </button>
            </li>
          )}
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.result} onClick={() => (onChange(item), close())}>
                {item.name}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}
