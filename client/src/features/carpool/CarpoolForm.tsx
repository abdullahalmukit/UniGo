import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router";
import { TimeSelect } from "../../components/DateTimeInput";
import formStyles from "../../components/form.module.css";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import { useToast } from "../../components/toast";
import { formErrors, type FormErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import type { Place } from "../ride/ride-api";
import { useRiderStatus } from "../ride/ride-hooks";
import { PlaceField } from "../ride/Pickers";
import styles from "../ride/ride.module.css";
import {
  addSeats,
  createPost,
  dhakaDate,
  getPost,
  minuteToTime,
  timeToMinute,
  updatePost,
  type CarpoolPostDetail,
  type PostInput,
} from "./carpool-api";
import { DaysPicker, useCarpoolConfig } from "./carpool-shared";
import carpoolStyles from "./carpool.module.css";

const noErrors: FormErrors = { fields: {} };
const HOLDING = ["ACCEPTED", "DISPUTED"];

// Create Schedule and edit (proposal 9.2, B6a). While nobody holds a seat
// everything can change (pending requests are then declined by the server);
// after that only seats can be added (Q6, Q7).
export function CarpoolFormPage() {
  const { id } = useParams();
  const [existing, setExisting] = useState<CarpoolPostDetail | null | undefined>(id ? undefined : null);
  useEffect(() => {
    if (id) getPost(id).then((r) => setExisting(r.post)).catch(() => setExisting(null));
  }, [id]);
  if (existing === undefined) return <SkeletonList rows={4} />;
  if (id && (!existing || !existing.mine || existing.status === "CLOSED")) return <Navigate to={id ? `/carpool/posts/${id}` : "/carpool"} replace />;
  return <CarpoolForm existing={existing} />;
}

function CarpoolForm({ existing }: { existing: CarpoolPostDetail | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const config = useCarpoolConfig();
  const rider = useRiderStatus();
  const locked = (existing?.bookings ?? []).some((b) => HOLDING.includes(b.status));
  const pending = (existing?.bookings ?? []).filter((b) => b.status === "OPEN").length;
  const [days, setDays] = useState(existing?.daysOfWeek ?? 0);
  const [time, setTime] = useState(existing ? minuteToTime(existing.departureMinute) : "08:00");
  const [pickup, setPickup] = useState<Place | null>(existing?.pickup ?? null);
  const [destination, setDestination] = useState<Place | null>(existing?.destination ?? null);
  const [vehicleId, setVehicleId] = useState(existing?.vehicle.id ?? "");
  const [seats, setSeats] = useState(existing ? String(existing.totalSeats) : "1");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [validFrom, setValidFrom] = useState(existing?.validFrom ?? dhakaDate(0));
  const [validUntil, setValidUntil] = useState(existing?.validUntil ?? "");
  const durations = config?.durationMonths ?? [1, 2, 3, 4];
  const [prices, setPrices] = useState<Record<number, string>>(
    Object.fromEntries((existing?.prices ?? []).map((p) => [p.durationMonths, String(p.monthlyPrice)])),
  );
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rider && !rider.vehicles.some((v) => v.id === vehicleId)) setVehicleId(rider.vehicles[0]?.id ?? "");
  }, [rider, vehicleId]);

  if (!rider) return <SkeletonList rows={4} />;
  if (!existing && !rider.canOffer) {
    return (
      <div className={styles.narrow}>
        <SubPageHeader title={t("carpool.newPost")} back="/carpool" />
        <FormAlert>{t("carpool.form.notActiveRider")}</FormAlert>
      </div>
    );
  }
  const vehicle = rider.vehicles.find((v) => v.id === vehicleId);
  const maxSeats = vehicle ? Math.min(vehicle.seatCapacity, vehicle.type === "BIKE" ? 1 : 4) : 4;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked && existing) {
      setBusy(true);
      setErrors(noErrors);
      try {
        await addSeats(existing.id, Number(seats));
        toast.show(t("ride.form.saved"));
        void navigate(`/carpool/posts/${existing.id}`, { replace: true });
      } catch (failure) {
        setErrors(formErrors(failure, t));
      } finally {
        setBusy(false);
      }
      return;
    }

    const fields: Record<string, string> = {};
    if (!days) fields.daysOfWeek = t("carpool.form.chooseDay");
    if (!time) fields.departureMinute = t("errors.required");
    if (!pickup) fields.pickup = t("errors.required");
    if (!destination) fields.destination = t("errors.required");
    if (!vehicleId) fields.vehicleId = t("errors.required");
    const priceList = durations.filter((d) => prices[d]?.trim()).map((d) => ({ durationMonths: d, monthlyPrice: Number(prices[d]) }));
    if (priceList.length === 0) fields.prices = t("carpool.form.choosePrice");
    if (Object.keys(fields).length > 0) return setErrors({ fields });

    const body: PostInput = {
      daysOfWeek: days,
      departureMinute: timeToMinute(time),
      pickup: pickup!,
      destination: destination!,
      vehicleId,
      seats: Number(seats),
      notes: notes.trim() || null,
      prices: priceList,
      validFrom,
      validUntil: validUntil || null,
    };
    setBusy(true);
    setErrors(noErrors);
    try {
      const saved = existing ? await updatePost(existing.id, body) : await createPost(body);
      toast.show(existing ? t("ride.form.saved") : t("carpool.form.created"));
      void navigate(`/carpool/posts/${saved.post.id}`, { replace: true });
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.narrow} onSubmit={(event) => void submit(event)} noValidate>
      <SubPageHeader title={existing ? t("carpool.form.edit") : t("carpool.newPost")} back={existing ? `/carpool/posts/${existing.id}` : "/carpool"} />
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      {locked && <FormAlert tone="info">{t("carpool.form.lockedHint")}</FormAlert>}
      {!locked && pending > 0 && <FormAlert tone="info">{t("carpool.form.pendingHint", { count: pending })}</FormAlert>}
      {!locked && (
        <>
          <DaysPicker value={days} onChange={setDays} error={errors.fields.daysOfWeek} />
          <TimeSelect label={t("carpool.form.time")} value={time} onChange={setTime} />
          {errors.fields.departureMinute && <p className={formStyles.error}>{errors.fields.departureMinute}</p>}
          <PlaceField label={t("ride.pickup")} value={pickup} onChange={setPickup} error={errors.fields.pickup} />
          <PlaceField label={t("ride.destination")} value={destination} onChange={setDestination} error={errors.fields.destination} />
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
          <fieldset className={carpoolStyles.prices}>
            <legend className={formStyles.label}>{t("carpool.form.prices")}</legend>
            <p className={formStyles.hint}>
              {config ? t("carpool.form.pricesHint", { min: config.monthlyPrice.min, max: config.monthlyPrice.max }) : t("carpool.form.pricesHintShort")}
            </p>
            {durations.map((months) => (
              <label key={months} className={carpoolStyles.priceRow}>
                <span>{t("carpool.months", { count: months })}</span>
                <input
                  className={styles.select}
                  type="number"
                  inputMode="decimal"
                  placeholder={t("carpool.form.notOffered")}
                  value={prices[months] ?? ""}
                  onChange={(event) => setPrices((current) => ({ ...current, [months]: event.target.value }))}
                />
              </label>
            ))}
            {errors.fields.prices && <p className={formStyles.error}>{errors.fields.prices}</p>}
          </fieldset>
          <TextField label={t("carpool.form.validFrom")} type="date" value={validFrom} onChange={setValidFrom} error={errors.fields.validFrom} />
          <TextField
            label={t("carpool.form.validUntil")}
            type="date"
            value={validUntil}
            onChange={setValidUntil}
            hint={t("carpool.form.validUntilHint")}
            error={errors.fields.validUntil}
          />
          <label className={formStyles.field}>
            <span className={formStyles.label}>{t("ride.form.notes")}</span>
            <textarea className={styles.textarea} value={notes} maxLength={config?.notesMaxLength ?? 500} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </>
      )}
      <div className={styles.sticky}>
        <SubmitButton busy={busy}>{existing ? t("ride.form.save") : t("carpool.form.post")}</SubmitButton>
      </div>
    </form>
  );
}
