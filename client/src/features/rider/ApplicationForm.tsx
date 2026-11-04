import { Bike, Car, FileCheck2, Plus, Trash2, Upload } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { Card } from "../../components/ui";
import type { FormErrors } from "../../lib/errors";
import settings from "../account/settings.module.css";
import { shrinkImage } from "../profile/shrink-image";
import {
  submitApplication,
  type ApplicationDraft,
  type RiderLimits,
  type RiderOverview,
  type RiderVehicle,
  type VehicleDraft,
  type VehicleType,
} from "./rider-api";
import { applicationErrors } from "./rider-errors";
import styles from "./rider.module.css";

const DOCUMENT_TYPES = "image/jpeg,image/png,application/pdf";
const PHOTO_TYPES = "image/jpeg,image/png";
const noErrors: FormErrors = { fields: {} };

const emptyVehicle = (): VehicleDraft => ({
  type: "BIKE",
  brand: "",
  model: "",
  colour: "",
  registrationNumber: "",
  seatCapacity: 1,
  photo: null,
});

// Today in Asia/Dhaka, "YYYY-MM-DD" (the server checks the date again).
function dhakaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
}
function plusDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function plusYears(date: string, years: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() + years);
  return value.toISOString().slice(0, 10);
}

// The rider application (proposal section 6). A first application needs the
// NID; a re-verification sends the renewed licence and, optionally, vehicles
// to add. Rejected vehicles are offered again so the rider can fix them.
export function ApplicationForm({
  kind,
  limits,
  rejected,
  onSubmitted,
  onCancel,
}: {
  kind: "INITIAL" | "REVERIFICATION";
  limits: RiderLimits;
  rejected: RiderVehicle[];
  onSubmitted: (overview: RiderOverview) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const initial = kind === "INITIAL";
  const [draft, setDraft] = useState<ApplicationDraft>(() => ({
    licenceExpiresOn: "",
    nidFront: null,
    nidBack: null,
    carLicence: null,
    motorcycleLicence: null,
    vehicles: rejected.length
      ? rejected.map(({ type, brand, model, colour, registrationNumber, seatCapacity }) => ({
          type,
          brand,
          model,
          colour,
          registrationNumber,
          seatCapacity,
          photo: null,
        }))
      : initial
        ? [emptyVehicle()]
        : [],
  }));
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);
  const today = dhakaToday();

  const set = <K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setVehicle = (index: number, change: Partial<VehicleDraft>) =>
    setDraft((current) => ({
      ...current,
      vehicles: current.vehicles.map((vehicle, i) => (i === index ? { ...vehicle, ...change } : vehicle)),
    }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields: Record<string, string> = {};
    if (!draft.licenceExpiresOn) fields.licenceExpiresOn = t("errors.required");
    if (initial && !draft.nidFront) fields.nidFront = t("errors.required");
    if (initial && !draft.nidBack) fields.nidBack = t("errors.required");
    if (!draft.carLicence && !draft.motorcycleLicence) fields.licence = t("rider.fieldErrors.licence");
    draft.vehicles.forEach((vehicle, index) => {
      for (const name of ["brand", "model", "colour", "registrationNumber"] as const) {
        if (!vehicle[name].trim()) fields[`vehicles.${index}.${name}`] = t("errors.required");
      }
      if (!vehicle.photo) fields[`vehicles.${index}.photo`] = t("rider.fieldErrors.photo");
    });
    if (Object.keys(fields).length > 0) {
      setErrors({ fields, form: t("rider.form.fixErrors") });
      return;
    }

    setBusy(true);
    setErrors(noErrors);
    try {
      onSubmitted(await submitApplication(draft));
    } catch (failure) {
      const result = applicationErrors(failure, t);
      setErrors(Object.keys(result.fields).length > 0 ? { ...result, form: result.form ?? t("rider.form.fixErrors") } : result);
    } finally {
      setBusy(false);
    }
  };

  const canAdd = draft.vehicles.length < limits.maxVehiclesPerApplication;

  return (
    <form className={settings.stack} onSubmit={(event) => void submit(event)} noValidate>
      {errors.form && <FormAlert>{errors.form}</FormAlert>}

      {initial && (
        <Card className={settings.stack}>
          <h2 className={styles.cardTitle}>{t("rider.form.nid")}</h2>
          <FileField label={t("rider.form.nidFront")} accept={DOCUMENT_TYPES} file={draft.nidFront} onChange={(file) => set("nidFront", file)} error={errors.fields.nidFront} />
          <FileField label={t("rider.form.nidBack")} accept={DOCUMENT_TYPES} file={draft.nidBack} onChange={(file) => set("nidBack", file)} error={errors.fields.nidBack} />
        </Card>
      )}

      <Card className={settings.stack}>
        <h2 className={styles.cardTitle}>{t("rider.form.licence")}</h2>
        <p className={settings.caption}>{t(initial ? "rider.form.licenceHint" : "rider.form.renewHint")}</p>
        <FileField label={t("rider.form.motorcycleLicence")} accept={DOCUMENT_TYPES} file={draft.motorcycleLicence} onChange={(file) => set("motorcycleLicence", file)} />
        <FileField label={t("rider.form.carLicence")} accept={DOCUMENT_TYPES} file={draft.carLicence} onChange={(file) => set("carLicence", file)} />
        {errors.fields.licence && <p className={formStyles.error}>{errors.fields.licence}</p>}
        <TextField
          label={t("rider.form.expiry")}
          type="date"
          value={draft.licenceExpiresOn}
          onChange={(value) => set("licenceExpiresOn", value)}
          min={plusDays(today, 1)}
          max={plusYears(today, limits.licenceMaxYearsAhead)}
          error={errors.fields.licenceExpiresOn}
        />
      </Card>

      <section className={settings.stack} aria-label={t("rider.form.vehicles")}>
        <h2 className={styles.cardTitle}>{t("rider.form.vehicles")}</h2>
        {!initial && <p className={settings.caption}>{t("rider.form.addVehicleHint")}</p>}
        {errors.fields.vehicles && <p className={formStyles.error}>{errors.fields.vehicles}</p>}
        {draft.vehicles.map((vehicle, index) => (
          <VehicleFields
            key={index}
            index={index}
            vehicle={vehicle}
            limits={limits}
            errors={errors.fields}
            onChange={(change) => setVehicle(index, change)}
            onRemove={
              initial && draft.vehicles.length === 1
                ? undefined
                : () => setDraft((current) => ({ ...current, vehicles: current.vehicles.filter((_, i) => i !== index) }))
            }
          />
        ))}
        {canAdd && (
          <button type="button" className={`${styles.addButton}`} onClick={() => set("vehicles", [...draft.vehicles, emptyVehicle()])}>
            <Plus aria-hidden size={18} />
            {t("rider.form.addVehicle")}
          </button>
        )}
      </section>

      <p className={settings.caption}>{t("rider.form.privacy")}</p>
      <div className={styles.formButtons}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
      <SubmitButton busy={busy}>{t(initial ? "rider.form.submit" : "rider.form.submitRenewal")}</SubmitButton>
    </form>
  );
}

function VehicleFields({
  index,
  vehicle,
  limits,
  errors,
  onChange,
  onRemove,
}: {
  index: number;
  vehicle: VehicleDraft;
  limits: RiderLimits;
  errors: Record<string, string>;
  onChange: (change: Partial<VehicleDraft>) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const field = (name: string) => errors[`vehicles.${index}.${name}`];
  const seats = vehicle.type === "BIKE" ? limits.seats.bike : limits.seats.car;
  const seatOptions = Array.from({ length: seats.max - seats.min + 1 }, (_, i) => seats.min + i);

  const chooseType = (type: VehicleType) => {
    const range = type === "BIKE" ? limits.seats.bike : limits.seats.car;
    onChange({ type, seatCapacity: Math.min(Math.max(vehicle.seatCapacity, range.min), range.max) });
  };

  return (
    <Card className={settings.stack}>
      <div className={styles.vehicleHeader}>
        <h3 className={styles.vehicleTitle}>{t("rider.form.vehicleNumber", { number: index + 1 })}</h3>
        {onRemove && (
          <button type="button" className={settings.iconButton} aria-label={t("rider.form.removeVehicle", { number: index + 1 })} onClick={onRemove}>
            <Trash2 aria-hidden size={18} />
          </button>
        )}
      </div>
      <div role="radiogroup" aria-label={t("rider.form.vehicleType")} className={styles.typeChoice}>
        {(["BIKE", "CAR"] as const).map((type) => {
          const Icon = type === "BIKE" ? Bike : Car;
          return (
            <button key={type} type="button" role="radio" aria-checked={vehicle.type === type} className={settings.choiceOption} onClick={() => chooseType(type)}>
              <Icon aria-hidden size={18} /> {t(`rider.vehicleTypes.${type}`)}
            </button>
          );
        })}
      </div>
      <div className={styles.twoColumns}>
        <TextField label={t("rider.form.brand")} value={vehicle.brand} onChange={(brand) => onChange({ brand })} error={field("brand")} maxLength={50} />
        <TextField label={t("rider.form.model")} value={vehicle.model} onChange={(model) => onChange({ model })} error={field("model")} maxLength={50} />
        <TextField label={t("rider.form.colour")} value={vehicle.colour} onChange={(colour) => onChange({ colour })} error={field("colour")} maxLength={30} />
        <SeatSelect value={vehicle.seatCapacity} options={seatOptions} onChange={(seatCapacity) => onChange({ seatCapacity })} error={field("seatCapacity")} />
      </div>
      <TextField
        label={t("rider.form.registrationNumber")}
        value={vehicle.registrationNumber}
        onChange={(registrationNumber) => onChange({ registrationNumber })}
        placeholder={t("rider.form.registrationPlaceholder")}
        error={field("registrationNumber")}
        maxLength={30}
      />
      <FileField
        label={t("rider.form.vehiclePhoto")}
        accept={PHOTO_TYPES}
        file={vehicle.photo}
        onChange={async (file) => onChange({ photo: file ? await shrinkImage(file) : null })}
        error={field("photo")}
      />
    </Card>
  );
}

function SeatSelect({ value, options, onChange, error }: { value: number; options: number[]; onChange: (value: number) => void; error?: string }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className={formStyles.field}>
      <label htmlFor={id} className={formStyles.label}>
        {t("rider.form.seats")}
      </label>
      <div className={`${formStyles.control} ${error ? formStyles.invalid : ""}`}>
        <select id={id} className={formStyles.input} value={value} disabled={options.length === 1} onChange={(event) => onChange(Number(event.target.value))}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      {error && <p className={formStyles.error}>{error}</p>}
    </div>
  );
}

// A file picker that shows the chosen file's name.
function FileField({
  label,
  accept,
  file,
  onChange,
  error,
}: {
  label: string;
  accept: string;
  file: Blob | null;
  onChange: (file: File | null) => void | Promise<void>;
  error?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const name = file instanceof File ? file.name : file ? t("rider.form.photoChosen") : null;

  // The real file input is visually hidden but focusable; the visible "button"
  // is its <label>, so keyboard and screen readers work as usual.
  return (
    <div className={`${formStyles.field} ${styles.fileField}`}>
      <span className={formStyles.label} aria-hidden>
        {label}
      </span>
      <input
        id={id}
        type="file"
        accept={accept}
        className={styles.fileInput}
        aria-label={label}
        aria-describedby={`${id}-name`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          void onChange(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <label htmlFor={id} className={`${styles.fileButton} ${error ? styles.fileInvalid : ""}`}>
        {file ? <FileCheck2 aria-hidden size={18} /> : <Upload aria-hidden size={18} />}
        <span id={`${id}-name`} className={settings.ellipsis}>
          {name ?? t("rider.form.chooseFile")}
        </span>
      </label>
      {error && <p className={formStyles.error}>{error}</p>}
    </div>
  );
}
