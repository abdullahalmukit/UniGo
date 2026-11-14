import { AlertTriangle, Clock, MapPin, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { useToast } from "../../components/toast";
import { formErrors, type FormErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import { TextAreaField } from "../food/food-shared";
import { PlaceField, SubAreaField } from "../ride/Pickers";
import type { Place } from "../ride/ride-api";
import styles from "../ride/ride.module.css";
import {
  createServiceRequest,
  getServiceRequest,
  listServiceCategories,
  updateServiceRequest,
  type CreateServiceInput,
  type ServiceCategory,
  type ServiceCategoryCode,
  type ServiceRequest,
} from "./service-api";
import { categoryLabel, categorySafetyWarning } from "./ServiceCard";

const noErrors: FormErrors = { fields: {} };

const todayDhaka = () => {
  const now = new Date();
  return now.toISOString().slice(0, 10);
};

export function ServiceFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = id ? null : params.get("from");
  const [existing, setExisting] = useState<ServiceRequest | null | undefined>(id ? undefined : null);
  const [template, setTemplate] = useState<ServiceRequest | null | undefined>(from ? undefined : null);

  useEffect(() => {
    if (id) getServiceRequest(id).then((r) => setExisting(r.request)).catch(() => setExisting(null));
  }, [id]);

  useEffect(() => {
    if (from) getServiceRequest(from).then((r) => setTemplate(r.request)).catch(() => setTemplate(null));
  }, [from]);

  if (existing === undefined || template === undefined) return <SkeletonList rows={4} />;
  if (id && (!existing || !existing.mine || existing.status !== "OPEN")) return <Navigate to={`/service/requests/${id}`} replace />;

  return <ServiceForm existing={existing} template={template} />;
}

function ServiceForm({ existing, template }: { existing: ServiceRequest | null; template: ServiceRequest | null }) {
  const source = existing ?? template;
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoryId, setCategoryId] = useState(source?.categoryId ?? "");
  const [serviceTitle, setServiceTitle] = useState(source?.serviceTitle ?? "");
  const [taskTitle, setTaskTitle] = useState(source?.taskTitle ?? "");
  const [description, setDescription] = useState(source?.description ?? "");
  const [destination, setDestination] = useState<Place | null>(source?.destination ?? null);
  const [pickup, setPickup] = useState<Place | null>(source?.pickup ?? null);
  const [hasPickup, setHasPickup] = useState(Boolean(source?.pickup));
  const [subArea, setSubArea] = useState(source?.subArea ?? null);
  const [preferredDate, setPreferredDate] = useState(source?.preferredDate ?? todayDhaka());
  const [hasPreferredTime, setHasPreferredTime] = useState(Boolean(source?.hasPreferredTime));
  const [preferredTime, setPreferredTime] = useState(
    source?.hasPreferredTime && source?.startTime ? new Date(source.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "14:00"
  );
  const [offeredAmount, setOfferedAmount] = useState(source ? String(source.offeredAmount) : "100");
  const [estimatedBudget, setEstimatedBudget] = useState(source?.estimatedBudget ? String(source.estimatedBudget) : "");
  const [hasBudget, setHasBudget] = useState(Boolean(source?.estimatedBudget));
  const [itemDetails, setItemDetails] = useState(source?.itemDetails ?? "");
  const [quantity, setQuantity] = useState(source?.quantity ? String(source.quantity) : "");
  const [instructions, setInstructions] = useState(source?.instructions ?? "");

  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listServiceCategories().then((res) => {
      setCategories(res.categories);
      if (!categoryId && res.categories.length > 0) {
        setCategoryId(res.categories[0].id);
      }
    }).catch(() => undefined);
  }, []);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const safetyWarning = selectedCategory ? categorySafetyWarning(selectedCategory.code, t) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields: Record<string, string> = {};
    if (!categoryId) fields.categoryId = t("errors.required");
    if (!serviceTitle.trim()) fields.serviceTitle = t("errors.required");
    if (!taskTitle.trim()) fields.taskTitle = t("errors.required");
    if (!description.trim()) fields.description = t("errors.required");
    if (!destination) fields.destination = t("errors.required");
    if (!preferredDate) fields.preferredDate = t("errors.required");
    if (!offeredAmount.trim() || Number(offeredAmount) < 10) fields.offeredAmount = t("service.errors.minAmount");
    if (hasBudget && (!estimatedBudget.trim() || Number(estimatedBudget) < 10)) fields.estimatedBudget = t("service.errors.minAmount");
    if (Object.keys(fields).length > 0) return setErrors({ fields });

    const body: CreateServiceInput = {
      categoryId,
      serviceTitle: serviceTitle.trim(),
      taskTitle: taskTitle.trim(),
      description: description.trim(),
      destination: destination!,
      preferredDate,
      preferredTime: hasPreferredTime && preferredTime ? preferredTime : undefined,
      offeredAmount: Number(offeredAmount),
      itemDetails: itemDetails.trim() || undefined,
      quantity: quantity.trim() ? Number(quantity) : undefined,
      pickup: hasPickup && pickup ? pickup : undefined,
      subAreaId: subArea?.id ?? undefined,
      estimatedBudget: hasBudget && estimatedBudget.trim() ? Number(estimatedBudget) : undefined,
      instructions: instructions.trim() || undefined,
    };

    setBusy(true);
    setErrors(noErrors);
    try {
      const saved = existing ? await updateServiceRequest(existing.id, body) : await createServiceRequest(body);
      toast.show(existing ? t("service.form.saved") : t("service.form.created"));
      navigate(`/service/requests/${saved.request.id}`);
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.narrow} onSubmit={(e) => void submit(e)}>
      <SubPageHeader
        title={existing ? t("service.form.editTitle") : t("service.form.newTitle")}
        back={existing ? `/service/requests/${existing.id}` : "/service"}
      />
      {errors.form && <FormAlert>{errors.form}</FormAlert>}

      <section className={styles.section}>
        <label className={formStyles.field}>
          <span className={formStyles.label}>{t("service.form.category")}</span>
          <select
            className={formStyles.input}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={Boolean(existing)}
            aria-invalid={errors.fields.categoryId ? true : undefined}
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {categoryLabel(cat.code, t, cat.name)}
              </option>
            ))}
          </select>
          {errors.fields.categoryId && <span className={formStyles.error}>{errors.fields.categoryId}</span>}
        </label>

        {/* Safety Warnings for Pharmacy & Financial categories */}
        {safetyWarning && (
          <FormAlert tone="info">
            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <safetyWarning.icon size={20} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ display: "block", marginBottom: 2 }}>{safetyWarning.title}</strong>
                <span>{safetyWarning.message}</span>
              </div>
            </div>
          </FormAlert>
        )}

        <TextField
          label={t("service.form.serviceTitle")}
          placeholder={t("service.form.serviceTitleHint")}
          value={serviceTitle}
          onChange={setServiceTitle}
          max={150}
          error={errors.fields.serviceTitle}
        />

        <TextField
          label={t("service.form.taskTitle")}
          placeholder={t("service.form.taskTitleHint")}
          value={taskTitle}
          onChange={setTaskTitle}
          max={150}
          error={errors.fields.taskTitle}
        />

        <TextAreaField
          label={t("service.form.description")}
          value={description}
          onChange={setDescription}
          max={2000}
          error={errors.fields.description}
        />
      </section>

      <section className={styles.section}>
        <PlaceField
          label={t("service.form.destination")}
          value={destination}
          onChange={setDestination}
          error={errors.fields.destination}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={hasPickup}
            onChange={(e) => setHasPickup(e.target.checked)}
          />
          {t("service.form.hasPickup")}
        </label>

        {hasPickup && (
          <PlaceField
            label={t("service.form.pickup")}
            value={pickup}
            onChange={setPickup}
            error={errors.fields.pickup}
          />
        )}

        <SubAreaField
          label={t("service.form.subArea")}
          value={subArea}
          onChange={setSubArea}
        />
      </section>

      <section className={styles.section}>
        <TextField
          type="date"
          label={t("service.form.preferredDate")}
          value={preferredDate}
          onChange={setPreferredDate}
          error={errors.fields.preferredDate}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={hasPreferredTime}
            onChange={(e) => setHasPreferredTime(e.target.checked)}
          />
          {t("service.form.hasPreferredTime")}
        </label>

        {hasPreferredTime && (
          <TextField
            type="time"
            label={t("service.form.preferredTime")}
            value={preferredTime}
            onChange={setPreferredTime}
            error={errors.fields.preferredTime}
          />
        )}
      </section>

      <section className={styles.section}>
        <TextField
          type="number"
          label={t("service.form.offeredAmount")}
          placeholder="150"
          value={offeredAmount}
          onChange={setOfferedAmount}
          error={errors.fields.offeredAmount}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={hasBudget}
            onChange={(e) => setHasBudget(e.target.checked)}
          />
          {t("service.form.hasBudget")}
        </label>

        {hasBudget && (
          <TextField
            type="number"
            label={t("service.form.estimatedBudget")}
            placeholder="500"
            value={estimatedBudget}
            onChange={setEstimatedBudget}
            error={errors.fields.estimatedBudget}
          />
        )}

        <TextField
          label={t("service.form.itemDetails")}
          placeholder={t("service.form.itemDetailsHint")}
          value={itemDetails}
          onChange={setItemDetails}
          max={1000}
          error={errors.fields.itemDetails}
        />

        <TextField
          type="number"
          label={t("service.form.quantity")}
          placeholder="1"
          value={quantity}
          onChange={setQuantity}
          error={errors.fields.quantity}
        />

        <TextAreaField
          label={t("service.form.instructions")}
          value={instructions}
          onChange={setInstructions}
          max={1000}
          error={errors.fields.instructions}
        />
      </section>

      <div className={styles.actions}>
        <SubmitButton busy={busy}>{existing ? t("service.form.save") : t("service.form.post")}</SubmitButton>
      </div>
    </form>
  );
}
