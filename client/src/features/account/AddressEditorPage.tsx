import { MapPin, Search } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import { DEFAULT_CENTER, type LatLng } from "../../components/map-types";
import { useToast } from "../../components/toast";
import { checkRequired, formErrors, type FormErrors } from "../../lib/errors";
import { geocoder, type Place } from "../../lib/nominatim";
import { useDebounced } from "../../lib/use-debounced";
import { createAddress, listAddresses, updateAddress, type AddressLabel, type SavedAddress } from "./account-api";
import { SEARCH_DEBOUNCE_MS } from "./rules";
import styles from "./settings.module.css";
import { SkeletonList, SubPageHeader } from "./SubPage";

// Leaflet is large, so the map is loaded only when this page opens (B1).
const MapPicker = lazy(() => import("../../components/MapPicker").then((module) => ({ default: module.MapPicker })));

const LABELS: AddressLabel[] = ["HOME", "HALL", "WORK", "CUSTOM"];
const noErrors: FormErrors = { fields: {} };

const isLabel = (value: string | null): value is AddressLabel => LABELS.includes(value as AddressLabel);

// Add or edit one saved address: label, search, a map with the pin in the
// centre, and the address text (filled in from the map, editable).
export function AddressEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listAddresses()
      .then((result) => setAddresses(result.addresses))
      .catch(() => setFailed(true));
  }, []);

  const title = id ? t("addresses.editTitle") : t("addresses.newTitle");
  if (failed) {
    return (
      <div className={styles.page}>
        <SubPageHeader title={title} back="/account/addresses" />
        <FormAlert>{t("addresses.loadFailed")}</FormAlert>
      </div>
    );
  }
  if (!addresses) {
    return (
      <div className={styles.page}>
        <SubPageHeader title={title} back="/account/addresses" />
        <SkeletonList rows={3} />
      </div>
    );
  }

  const existing = id ? addresses.find((a) => a.id === id) : undefined;
  if (id && !existing) return <Navigate to="/account/addresses" replace />;

  // "Add Home" when Home is already saved: edit it instead.
  const wanted = params.get("label");
  const initialLabel: AddressLabel = existing?.label ?? (isLabel(wanted) ? wanted : "HOME");
  if (!id && initialLabel !== "CUSTOM") {
    const saved = addresses.find((a) => a.label === initialLabel);
    if (saved) return <Navigate to={`/account/addresses/${saved.id}`} replace />;
  }

  return <AddressForm existing={existing} initialLabel={initialLabel} addresses={addresses} title={title} />;
}

function AddressForm({
  existing,
  initialLabel,
  addresses,
  title,
}: {
  existing?: SavedAddress;
  initialLabel: AddressLabel;
  addresses: SavedAddress[];
  title: string;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const language = i18n.language === "bn" ? "bn" : "en";

  const [label, setLabel] = useState<AddressLabel>(initialLabel);
  const [customLabel, setCustomLabel] = useState(existing?.customLabel ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [point, setPoint] = useState<LatLng>(existing ? { lat: existing.lat, lng: existing.lng } : DEFAULT_CENTER);
  const [center, setCenter] = useState<LatLng>(point);
  const [moved, setMoved] = useState(Boolean(existing));
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);

  // Labels saved on another address cannot be picked again.
  const taken = new Set(addresses.filter((a) => a.id !== existing?.id && a.label !== "CUSTOM").map((a) => a.label));

  // The map moved: fill in the address there. A move made by picking a search
  // result keeps that result's name.
  const keepAddressOnce = useRef(false);
  const lookupId = useRef(0);
  const onMove = useCallback(
    (next: LatLng) => {
      setPoint(next);
      setMoved(true);
      if (keepAddressOnce.current) {
        keepAddressOnce.current = false;
        return;
      }
      const current = ++lookupId.current;
      geocoder
        .reverse(next.lat, next.lng, language)
        .then((name) => {
          if (name && current === lookupId.current) setAddress(name);
        })
        .catch(() => {});
    },
    [language],
  );

  const choosePlace = (place: Place) => {
    keepAddressOnce.current = true;
    lookupId.current += 1;
    setAddress(place.label);
    setCenter({ lat: place.lat, lng: place.lng });
    setPoint({ lat: place.lat, lng: place.lng });
    setMoved(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields = checkRequired({ address, customLabel: label === "CUSTOM" ? customLabel : "x" }, ["address", "customLabel"], t);
    if (!moved) fields.map = t("addresses.pickOnMap");
    if (Object.keys(fields).length > 0) {
      setErrors({ fields });
      return;
    }
    const body = {
      label,
      customLabel: label === "CUSTOM" ? customLabel.trim() : null,
      address: address.trim(),
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
    };
    setBusy(true);
    setErrors(noErrors);
    try {
      if (existing) await updateAddress(existing.id, body);
      else await createAddress(body);
      toast.show(t("addresses.saved"));
      navigate("/account/addresses");
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <SubPageHeader title={title} back="/account/addresses" />
      <form className={styles.stack} onSubmit={(event) => void submit(event)} noValidate>
        {errors.form && <FormAlert>{errors.form}</FormAlert>}

        <div role="radiogroup" aria-label={t("addresses.label")} className={styles.choice}>
          {LABELS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={label === value}
              className={styles.choiceOption}
              disabled={taken.has(value)}
              onClick={() => setLabel(value)}
            >
              {t(`addresses.labels.${value}`)}
            </button>
          ))}
        </div>
        {errors.fields.label && <FormAlert>{errors.fields.label}</FormAlert>}

        {label === "CUSTOM" && (
          <TextField
            label={t("addresses.customLabel")}
            value={customLabel}
            onChange={setCustomLabel}
            error={errors.fields.customLabel}
            placeholder={t("addresses.customLabelPlaceholder")}
            maxLength={50}
          />
        )}

        <PlaceSearch language={language} onChoose={choosePlace} />

        <Suspense fallback={<span className={styles.mapPlaceholder} role="status" aria-label={t("app.loading")} />}>
          <MapPicker center={center} zoom={existing ? 17 : 13} onMove={onMove} />
        </Suspense>
        <p className={styles.caption}>{errors.fields.map ?? t("addresses.mapHint")}</p>

        <TextField
          label={t("addresses.address")}
          value={address}
          onChange={setAddress}
          error={errors.fields.address}
          maxLength={255}
        />
        <SubmitButton busy={busy}>{t("addresses.save")}</SubmitButton>
      </form>
    </div>
  );
}

// Debounced place search (Nominatim, Bangladesh only).
function PlaceSearch({ language, onChoose }: { language: "bn" | "en"; onChoose: (place: Place) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState<Place[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (debounced.trim().length < 3) {
      setResults(null);
      setState("idle");
      return;
    }
    let active = true;
    setState("loading");
    geocoder
      .search(debounced, language)
      .then((places) => {
        if (!active) return;
        setResults(places);
        setState("idle");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [debounced, language]);

  return (
    <div className={styles.stack}>
      <TextField
        label={t("addresses.search")}
        value={query}
        onChange={setQuery}
        placeholder={t("addresses.searchPlaceholder")}
        type="search"
        autoComplete="off"
        trailing={<Search aria-hidden size={18} className={styles.searchIcon} />}
      />
      {state === "loading" && <p className={styles.caption} role="status">{t("addresses.searching")}</p>}
      {state === "error" && <p className={styles.caption} role="status">{t("addresses.searchFailed")}</p>}
      {results && state === "idle" && (
        <ul className={styles.results} aria-label={t("addresses.results")}>
          {results.length === 0 && (
            <li>
              <span className={styles.result}>{t("addresses.noResults")}</span>
            </li>
          )}
          {results.map((place) => (
            <li key={`${place.lat},${place.lng}`}>
              <button
                type="button"
                className={styles.result}
                onClick={() => {
                  onChoose(place);
                  setResults(null);
                  setQuery("");
                }}
              >
                <MapPin aria-hidden size={18} />
                <span>{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
