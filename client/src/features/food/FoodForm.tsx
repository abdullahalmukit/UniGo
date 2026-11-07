import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { DateTimeInput } from "../../components/DateTimeInput";
import { FormAlert, SubmitButton, TextField } from "../../components/form";
import { useToast } from "../../components/toast";
import { fromDhakaInput, toDhakaInput } from "../../lib/dates";
import { formErrors, type FormErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import { PlaceField, SubAreaField } from "../ride/Pickers";
import type { Place } from "../ride/ride-api";
import styles from "../ride/ride.module.css";
import { createFood, getFood, updateFood, type FoodRequest } from "./food-api";
import { TextAreaField, useFoodConfig } from "./food-shared";

const noErrors: FormErrors = { fields: {} };
// An hour from now, rounded up to the picker's 5-minute steps
const inOneHour = () => {
  const step = 5 * 60 * 1000;
  return toDhakaInput(new Date(Math.ceil((Date.now() + 60 * 60 * 1000) / step) * step));
};
const activeSubArea = <T extends { isActive?: boolean } | null>(subArea: T) => (subArea && subArea.isActive === false ? null : subArea);

// New request, edit (while OPEN) and "Create again" (?from=<id>: everything
// copied but the time, B3b-1 Q5). The server checks every rule again.
export function FoodFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = id ? null : params.get("from");
  const [existing, setExisting] = useState<FoodRequest | null | undefined>(id ? undefined : null);
  const [template, setTemplate] = useState<FoodRequest | null | undefined>(from ? undefined : null);
  useEffect(() => {
    if (id) getFood(id).then((r) => setExisting(r.request)).catch(() => setExisting(null));
  }, [id]);
  useEffect(() => {
    if (from) getFood(from).then((r) => setTemplate(r.request)).catch(() => setTemplate(null));
  }, [from]);
  if (existing === undefined || template === undefined) return <SkeletonList rows={4} />;
  if (id && (!existing || !existing.mine || existing.status !== "OPEN")) return <Navigate to={`/food/requests/${id}`} replace />;
  return <FoodForm existing={existing} template={template} />;
}

function FoodForm({ existing, template }: { existing: FoodRequest | null; template: FoodRequest | null }) {
  const source = existing ?? template;
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const config = useFoodConfig();
  const [restaurantName, setRestaurantName] = useState(source?.restaurantName ?? "");
  const [restaurant, setRestaurant] = useState<Place | null>(source?.restaurant ?? null);
  const [pickup, setPickup] = useState<Place | null>(source?.pickup ?? null);
  // The pickup follows the restaurant until the user changes it (10.2)
  const [pickupEdited, setPickupEdited] = useState(Boolean(source));
  const [items, setItems] = useState(source?.items ?? "");
  const [details, setDetails] = useState(source?.details ?? "");
  const [quantity, setQuantity] = useState(source ? String(source.quantity) : "1");
  const [budget, setBudget] = useState(source ? String(source.estimatedBudget) : "");
  const [charge, setCharge] = useState(source && source.deliveryCharge > 0 ? String(source.deliveryCharge) : "");
  const [delivery, setDelivery] = useState<Place | null>(source?.delivery ?? null);
  const [subArea, setSubArea] = useState(existing ? existing.subArea : activeSubArea(template?.subArea ?? null));
  const [time, setTime] = useState(existing ? toDhakaInput(existing.expectedDeliveryTime) : inOneHour());
  const [errors, setErrors] = useState<FormErrors>(noErrors);
  const [busy, setBusy] = useState(false);

  const chooseRestaurant = (place: Place | null) => {
    setRestaurant(place);
    if (!pickupEdited) setPickup(place);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields: Record<string, string> = {};
    if (!restaurantName.trim()) fields.restaurantName = t("errors.required");
    if (!restaurant) fields.restaurant = t("errors.required");
    if (!items.trim()) fields.items = t("errors.required");
    if (!details.trim()) fields.details = t("errors.required");
    if (!budget.trim()) fields.estimatedBudget = t("errors.required");
    if (!pickup) fields.pickup = t("errors.required");
    if (!delivery) fields.delivery = t("errors.required");
    if (!subArea) fields.subAreaId = t("errors.required");
    if (Object.keys(fields).length > 0) return setErrors({ fields });

    const body = {
      restaurantName: restaurantName.trim(),
      restaurant: restaurant!,
      items: items.trim(),
      details: details.trim(),
      quantity: Number(quantity),
      estimatedBudget: Number(budget),
      pickup: pickup!,
      delivery: delivery!,
      subAreaId: subArea!.id,
      expectedDeliveryTime: fromDhakaInput(time),
      deliveryCharge: charge.trim() ? Number(charge) : 0,
    };
    setBusy(true);
    setErrors(noErrors);
    try {
      const saved = existing ? await updateFood(existing.id, body) : await createFood(body);
      toast.show(existing ? t("food.form.saved") : t("food.form.created"));
      void navigate(`/food/requests/${saved.request.id}`, { replace: true });
    } catch (failure) {
      setErrors(formErrors(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.narrow} onSubmit={(event) => void submit(event)} noValidate>
      <SubPageHeader title={existing ? t("food.form.editTitle") : t("food.newRequest")} back={existing ? `/food/requests/${existing.id}` : "/food"} />
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      {template && <FormAlert tone="info">{t("ride.form.copied")}</FormAlert>}
      <TextField
        label={t("food.form.restaurantName")}
        value={restaurantName}
        maxLength={config?.restaurantNameMaxLength}
        onChange={setRestaurantName}
        error={errors.fields.restaurantName}
      />
      <PlaceField label={t("food.form.restaurantLocation")} value={restaurant} onChange={chooseRestaurant} error={errors.fields.restaurant} />
      <TextAreaField label={t("food.form.items")} value={items} max={config?.itemsMaxLength ?? 1000} onChange={setItems} error={errors.fields.items} />
      <TextAreaField label={t("food.form.details")} value={details} max={config?.detailsMaxLength ?? 1000} onChange={setDetails} error={errors.fields.details} />
      <div className={styles.grid2}>
        <TextField
          label={t("food.form.quantity")}
          type="number"
          min={config?.quantity.min ?? 1}
          max={config?.quantity.max}
          value={quantity}
          onChange={setQuantity}
          error={errors.fields.quantity}
        />
        <TextField
          label={t("food.form.budget")}
          type="number"
          inputMode="decimal"
          min={config?.budget.min}
          max={config?.budget.max}
          value={budget}
          onChange={setBudget}
          hint={config ? t("food.form.budgetHint", { min: config.budget.min, max: config.budget.max }) : undefined}
          error={errors.fields.estimatedBudget}
        />
      </div>
      <PlaceField
        label={t("food.form.pickup")}
        value={pickup}
        onChange={(place) => (setPickup(place), setPickupEdited(true))}
        error={errors.fields.pickup}
      />
      <p className={styles.muted}>{t("food.form.pickupHint")}</p>
      <PlaceField label={t("food.form.delivery")} value={delivery} onChange={setDelivery} error={errors.fields.delivery} />
      <SubAreaField label={t("ride.subArea.label")} value={subArea} onChange={setSubArea} error={errors.fields.subAreaId} />
      <DateTimeInput
        label={t("food.form.deliveryTime")}
        value={time}
        onChange={setTime}
        hint={t("food.form.timeHint")}
        error={errors.fields.expectedDeliveryTime}
      />
      <TextField
        label={t("food.form.deliveryCharge")}
        type="number"
        inputMode="decimal"
        value={charge}
        onChange={setCharge}
        hint={config ? t("food.form.chargeHint", { min: config.deliveryCharge.min, max: config.deliveryCharge.max }) : undefined}
        error={errors.fields.deliveryCharge}
      />
      <div className={styles.sticky}>
        <SubmitButton busy={busy}>{existing ? t("food.form.save") : t("food.form.post")}</SubmitButton>
      </div>
    </form>
  );
}
