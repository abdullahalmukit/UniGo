import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router";
import formStyles from "../../components/form.module.css";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { fromDhakaInput, toDhakaInput } from "../../lib/dates";
import { formErrors, type FormErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import {
  createOffer,
  createRequest,
  estimateFare,
  getOffer,
  getRequest,
  updateOffer,
  updateRequest,
  type FareEstimate,
  type Place,
  type RideOffer,
  type RideRequest,
} from "./ride-api";
import { useRideConfig, useRiderStatus } from "./ride-hooks";
import { PlaceField, SubAreaField } from "./Pickers";
import { taka } from "./RideCard";
import styles from "./ride.module.css";

const noErrors: FormErrors = { fields: {} };
const inOneHour = () => toDhakaInput(new Date(Date.now() + 60 * 60 * 1000));

// Suggested fare (proposal 8.2): shown when both places are set; a
// recommendation only. Nothing is shown when the route server does not answer.
function useSuggestedFare(pickup: Place | null, destination: Place | null) {
  const [estimate, setEstimate] = useState<FareEstimate | null>(null);
  useEffect(() => {
    setEstimate(null);
    if (!pickup || !destination) return;
    let cancelled = false;
    estimateFare(pickup, destination)
      .then((value) => !cancelled && setEstimate(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pickup, destination]);
  return estimate;
}

function SuggestedFare({ estimate, onUse, perSeat }: { estimate: FareEstimate | null; onUse: (value: number) => void; perSeat: boolean }) {
  const { t, i18n } = useTranslation();
  if (!estimate?.suggested) return null;
  return (
    <p className={styles.muted}>
      {t(perSeat ? "ride.form.suggestedPerSeat" : "ride.form.suggested", {
        amount: taka(estimate.suggested, i18n.language),
        km: taka(estimate.distanceKm ?? 0, i18n.language),
      })}{" "}
      <button type="button" className={buttonStyles.secondary} onClick={() => onUse(estimate.suggested!)}>
        {t("ride.form.useSuggested")}
      </button>
    </p>
  );
}

function NotesField({ value, onChange, max }: { value: string; onChange: (value: string) => void; max: number }) {
  const { t } = useTranslation();
  return (
    <label className={formStyles.field}>
      <span className={formStyles.label}>{t("ride.form.notes")}</span>
      <textarea className={styles.textarea} value={value} maxLength={max} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

// --- Need a Ride (new and edit)

export function RequestFormPage() {
  const { id } = useParams();
  const [existing, setExisting] = useState<RideRequest | null | undefined>(id ? undefined : null);
  useEffect(() => {
    if (id) getRequest(id).then((r) => setExisting(r.request)).catch(() => setExisting(null));
  }, [id]);
  if (existing === undefined) return <SkeletonList rows={4} />;
  if (id && (!existing || !existing.mine || existing.status !== "OPEN")) return <Navigate to={id ? `/ride/requests/${id}` : "/ride"} replace />;
  return <RequestForm existing={existing} />;
}

function RequestForm({ existing }: { existing: RideRequest | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const config = useRideConfig();
  const [pickup, setPickup] = useState<Place | null>(existing?.pickup ?? null);
  const [destination, setDestination] = useState<Place | null>(existing?.destination ?? null);
  const [time, setTime] = useState(existing ? toDhakaInput(existing.startTime) : inOneHour());
  const [amount, setAmount] = useState(existing ? String(existing.offeredAmount) : "");
  const [passengers, setPassengers] = useState(existing ? String(existing.passengerCount) : "1");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [subArea, setSubArea] = useState(existing?.subArea ?? null);
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);
  const estimate = useSuggestedFare(pickup, destination);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields: Record<string, string> = {};
    if (!pickup) fields.pickup = t("errors.required");
    if (!destination) fields.destination = t("errors.required");
    if (!subArea) fields.subAreaId = t("errors.required");
    if (!amount.trim()) fields.offeredAmount = t("errors.required");
    if (Object.keys(fields).length > 0) return setErrors({ fields });

    const body = {
      pickup: pickup!,
      destination: destination!,
      startTime: fromDhakaInput(time),
      offeredAmount: Number(amount),
      passengerCount: Number(passengers),
      notes: notes.trim() || null,
      subAreaId: subArea!.id,
    };
    setBusy(true);
    setErrors(noErrors);
    try {
      const saved = existing ? await updateRequest(existing.id, body) : await createRequest(body);
      toast.show(existing ? t("ride.form.saved") : t("ride.form.requestCreated"));
      void navigate(`/ride/requests/${saved.request.id}`, { replace: true });
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.narrow} onSubmit={(event) => void submit(event)} noValidate>
      <SubPageHeader title={existing ? t("ride.form.editRequest") : t("ride.needRide")} back={existing ? `/ride/requests/${existing.id}` : "/ride"} />
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      <PlaceField label={t("ride.pickup")} value={pickup} onChange={setPickup} error={errors.fields.pickup} />
      <PlaceField label={t("ride.destination")} value={destination} onChange={setDestination} error={errors.fields.destination} />
      <TextField label={t("ride.form.pickupTime")} type="datetime-local" value={time} onChange={setTime} hint={t("ride.form.timeHint")} error={errors.fields.startTime} />
      <div className={styles.grid2}>
        <TextField
          label={t("ride.form.offeredAmount")}
          type="number"
          inputMode="decimal"
          min={config?.amount.min}
          max={config?.amount.max}
          value={amount}
          onChange={setAmount}
          hint={config ? t("ride.form.amountHint", { min: config.amount.min, max: config.amount.max }) : undefined}
          error={errors.fields.offeredAmount}
        />
        <TextField
          label={t("ride.form.passengers")}
          type="number"
          min={config?.passengers.min ?? 1}
          max={config?.passengers.max ?? 4}
          value={passengers}
          onChange={setPassengers}
          error={errors.fields.passengerCount}
        />
      </div>
      <SuggestedFare estimate={estimate} perSeat={false} onUse={(value) => setAmount(String(value))} />
      <SubAreaField label={t("ride.subArea.label")} value={subArea} onChange={setSubArea} error={errors.fields.subAreaId} />
      <NotesField value={notes} onChange={setNotes} max={config?.notesMaxLength ?? 500} />
      <div className={styles.sticky}>
        <SubmitButton busy={busy}>{existing ? t("ride.form.save") : t("ride.form.postRequest")}</SubmitButton>
      </div>
    </form>
  );
}

// --- Offer a Ride (new and edit)

export function OfferFormPage() {
  const { id } = useParams();
  const [existing, setExisting] = useState<RideOffer | null | undefined>(id ? undefined : null);
  useEffect(() => {
    if (id) getOffer(id).then((r) => setExisting(r.offer)).catch(() => setExisting(null));
  }, [id]);
  if (existing === undefined) return <SkeletonList rows={4} />;
  if (id && (!existing || !existing.mine || existing.status === "CLOSED")) return <Navigate to={id ? `/ride/offers/${id}` : "/ride"} replace />;
  return <OfferForm existing={existing} />;
}

function OfferForm({ existing }: { existing: RideOffer | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const config = useRideConfig();
  const rider = useRiderStatus();
  // After the first booking only seats can be added (B3a Q3)
  const locked = (existing?.bookings ?? []).some((b) => ["ACCEPTED", "IN_PROGRESS", "DISPUTED"].includes(b.status));
  const [pickup, setPickup] = useState<Place | null>(existing?.pickup ?? null);
  const [destination, setDestination] = useState<Place | null>(existing?.destination ?? null);
  const [time, setTime] = useState(existing ? toDhakaInput(existing.departureTime) : inOneHour());
  const [fare, setFare] = useState(existing ? String(existing.farePerSeat) : "");
  const [vehicleId, setVehicleId] = useState(existing?.vehicle.id ?? "");
  const [seats, setSeats] = useState(existing ? String(existing.totalSeats) : "1");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [subArea, setSubArea] = useState(existing?.subArea ?? null);
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);
  const estimate = useSuggestedFare(locked ? null : pickup, destination);

  useEffect(() => {
    if (!vehicleId && rider?.vehicles.length) setVehicleId(rider.vehicles[0].id);
  }, [rider, vehicleId]);

  if (!rider) return <SkeletonList rows={4} />;
  if (!existing && !rider.canOffer) {
    return (
      <div className={styles.narrow}>
        <SubPageHeader title={t("ride.offerRide")} back="/ride" />
        <FormAlert>{t("ride.form.notActiveRider")}</FormAlert>
      </div>
    );
  }
  const vehicle = rider.vehicles.find((v) => v.id === vehicleId);
  const maxSeats = vehicle ? Math.min(vehicle.seatCapacity, vehicle.type === "BIKE" ? 1 : 4) : 4;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields: Record<string, string> = {};
    if (!pickup) fields.pickup = t("errors.required");
    if (!destination) fields.destination = t("errors.required");
    if (!fare.trim()) fields.farePerSeat = t("errors.required");
    if (!vehicleId) fields.vehicleId = t("errors.required");
    if (Object.keys(fields).length > 0) return setErrors({ fields });

    const body = locked
      ? { seats: Number(seats) }
      : {
          pickup: pickup!,
          destination: destination!,
          departureTime: fromDhakaInput(time),
          farePerSeat: Number(fare),
          vehicleId,
          seats: Number(seats),
          notes: notes.trim() || null,
          subAreaId: subArea?.id ?? null,
        };
    setBusy(true);
    setErrors(noErrors);
    try {
      const saved = existing ? await updateOffer(existing.id, body) : await createOffer(body as Parameters<typeof createOffer>[0]);
      toast.show(existing ? t("ride.form.saved") : t("ride.form.offerCreated"));
      void navigate(`/ride/offers/${saved.offer.id}`, { replace: true });
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.narrow} onSubmit={(event) => void submit(event)} noValidate>
      <SubPageHeader title={existing ? t("ride.form.editOffer") : t("ride.offerRide")} back={existing ? `/ride/offers/${existing.id}` : "/ride"} />
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      {locked && <FormAlert tone="info">{t("ride.form.lockedHint")}</FormAlert>}
      {!locked && (
        <>
          <PlaceField label={t("ride.pickup")} value={pickup} onChange={setPickup} error={errors.fields.pickup} />
          <PlaceField label={t("ride.destination")} value={destination} onChange={setDestination} error={errors.fields.destination} />
          <TextField label={t("ride.form.departure")} type="datetime-local" value={time} onChange={setTime} hint={t("ride.form.timeHint")} error={errors.fields.departureTime} />
          <label className={formStyles.field}>
            <span className={formStyles.label}>{t("ride.form.vehicle")}</span>
            <select className={styles.select} value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
              {rider.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {t(`ride.vehicleType.${v.type}`)} · {v.brand} {v.model} · {v.registrationNumber}
                </option>
              ))}
            </select>
            {errors.fields.vehicleId && <p className={formStyles.error}>{errors.fields.vehicleId}</p>}
          </label>
          <TextField
            label={t("ride.form.farePerSeat")}
            type="number"
            inputMode="decimal"
            min={config?.amount.min}
            max={config?.amount.max}
            value={fare}
            onChange={setFare}
            hint={config ? t("ride.form.amountHint", { min: config.amount.min, max: config.amount.max }) : undefined}
            error={errors.fields.farePerSeat}
          />
          <SuggestedFare estimate={estimate} perSeat onUse={(value) => setFare(String(value))} />
        </>
      )}
      <TextField
        label={t("ride.form.seats")}
        type="number"
        min={locked ? existing?.totalSeats : 1}
        max={maxSeats}
        value={seats}
        onChange={setSeats}
        hint={t("ride.form.seatsHint", { count: maxSeats })}
        error={errors.fields.seats}
      />
      {!locked && (
        <>
          <SubAreaField label={t("ride.subArea.optionalLabel")} value={subArea} optional onChange={setSubArea} error={errors.fields.subAreaId} />
          <NotesField value={notes} onChange={setNotes} max={config?.notesMaxLength ?? 500} />
        </>
      )}
      <div className={styles.sticky}>
        <SubmitButton busy={busy}>{existing ? t("ride.form.save") : t("ride.form.postOffer")}</SubmitButton>
      </div>
    </form>
  );
}
