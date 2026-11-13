import { MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import formStyles from "../../components/form.module.css";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { formErrors } from "../../lib/errors";
import { cancelActivity, confirmCompletion, requestCompletion, type ActivityStatus, type CompletionBy } from "../ride/ride-api";
import { ReasonField } from "../ride/RideActions";
import { taka } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import { getFoodConfig, type FoodConfig } from "./food-api";

// Small food pieces used outside the food pages too (Activity cards), kept
// apart so the lazy food pages stay out of the main bundle.

const errorText = (failure: unknown, t: Parameters<typeof formErrors>[1]) => {
  const errors = formErrors(failure, t);
  return errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic");
};

let configCache: Promise<FoodConfig> | null = null;

// Limits from the server (rules.ts), never hard-coded here.
export function useFoodConfig() {
  const [config, setConfig] = useState<FoodConfig | null>(null);
  useEffect(() => {
    configCache ??= getFoodConfig().catch((error) => {
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

// Budget plus the delivery charge offered, e.g. "৳600 + ৳60 delivery"
export function FoodAmount({ foodPrice, deliveryCharge }: { foodPrice: number; deliveryCharge: number }) {
  const { t, i18n } = useTranslation();
  return (
    <span className={styles.amount}>
      {deliveryCharge > 0
        ? t("food.amountWithCharge", { food: taka(foodPrice, i18n.language), charge: taka(deliveryCharge, i18n.language) })
        : t("food.amount", { food: taka(foodPrice, i18n.language) })}
    </span>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  max,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  error?: string;
}) {
  return (
    <label className={formStyles.field}>
      <span className={formStyles.label}>{label}</span>
      <textarea className={styles.textarea} value={value} maxLength={max} aria-invalid={error ? true : undefined} onChange={(event) => onChange(event.target.value)} />
      {error && <span className={formStyles.error}>{error}</span>}
    </label>
  );
}

// The steps of an accepted food request for its participants: mark completed
// (after the receipt), confirm, open the chat, cancel with a reason. After the
// receipt only the accepter can cancel; the requester reports instead (B4).
export function FoodActions({
  activityId,
  status,
  subStatus,
  role,
  completionRequestedBy,
  chatId,
  onChanged,
  sticky = true,
}: {
  activityId: string;
  status: ActivityStatus;
  subStatus: string | null;
  role: "REQUESTER" | "ACCEPTER" | null;
  completionRequestedBy: CompletionBy;
  chatId: string | null;
  onChanged: () => void;
  sticky?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (step: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await step();
      toast.show(done);
      onChanged();
    } catch (failure) {
      // If the transition is no longer valid, the page data is stale — reload
      // silently so the user sees the updated state (e.g. already completed).
      if (failure instanceof ApiError && (failure.code === "INVALID_TRANSITION" || failure.status === 409)) {
        onChanged();
        return;
      }
      toast.show(errorText(failure, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const completionRequested = status === "IN_PROGRESS" && subStatus === "COMPLETION_REQUESTED";
  const collected = status === "IN_PROGRESS" && subStatus === "FOOD_COLLECTED";
  const active = status === "ACCEPTED" || status === "IN_PROGRESS" || status === "DISPUTED";
  const canCancel = status === "ACCEPTED" || (collected && role === "ACCEPTER");

  return (
    <div className={sticky ? `${styles.actions} ${styles.sticky}` : styles.actions}>
      {collected && (
        <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void run(() => requestCompletion(activityId), t("ride.actions.completionAsked"))}>
          {t("food.actions.delivered")}
        </button>
      )}
      {completionRequested && completionRequestedBy === "OTHER" && (
        <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void run(() => confirmCompletion(activityId), t("food.actions.completed"))}>
          {t("ride.actions.confirm")}
        </button>
      )}
      {completionRequested && completionRequestedBy === "ME" && <p className={styles.muted}>{t("ride.actions.waiting")}</p>}
      {chatId && active && (
        <Link to={`/inbox/${chatId}`} className={buttonStyles.secondary}>
          <MessageCircle aria-hidden size={18} /> {t("ride.actions.chat")}
        </Link>
      )}
      {canCancel && (
        <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => setCancelOpen(true)}>
          {t("food.actions.cancel")}
        </button>
      )}
      {collected && role === "REQUESTER" && <p className={styles.muted}>{t("food.actions.complainInstead")}</p>}
      <ConfirmSheet
        title={t("food.actions.cancelTitle")}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        confirmLabel={t("food.actions.cancel")}
        onConfirm={async () => {
          await cancelActivity(activityId, reason.trim());
          setCancelOpen(false);
          toast.show(t("food.actions.cancelled"));
          onChanged();
        }}
      >
        <p className={styles.muted}>{t("ride.actions.cancelHint")}</p>
        <ReasonField value={reason} onChange={setReason} />
      </ConfirmSheet>
    </div>
  );
}
