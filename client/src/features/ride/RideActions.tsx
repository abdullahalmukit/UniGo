import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { cancelActivity, confirmCompletion, requestCompletion, startActivity, type ActivityStatus, type CompletionBy } from "./ride-api";
import styles from "./ride.module.css";

// The steps of an accepted ride for its two participants (proposal 8.6, 7.3):
// Start Ride (from 30 minutes before), mark completed, confirm, cancel with a
// reason (confirm sheet), open the chat. The server decides; this only offers
// the steps that fit the status.
export function RideActions({
  activityId,
  status,
  subStatus,
  completionRequestedBy,
  chatId,
  onChanged,
}: {
  activityId: string;
  status: ActivityStatus;
  subStatus: string | null;
  completionRequestedBy: CompletionBy;
  chatId: string | null;
  onChanged: () => void;
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
      toast.show(formErrors(failure, t).form ?? t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  };

  const completionRequested = subStatus === "COMPLETION_REQUESTED";
  const active = status === "ACCEPTED" || status === "IN_PROGRESS" || status === "DISPUTED";

  return (
    <div className={`${styles.actions} ${styles.sticky}`}>
      {status === "ACCEPTED" && (
        <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void run(() => startActivity(activityId), t("ride.actions.started"))}>
          {t("ride.actions.start")}
        </button>
      )}
      {status === "IN_PROGRESS" && !completionRequested && (
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={busy}
          onClick={() => void run(() => requestCompletion(activityId), t("ride.actions.completionAsked"))}
        >
          {t("ride.actions.complete")}
        </button>
      )}
      {completionRequested && completionRequestedBy === "OTHER" && (
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={busy}
          onClick={() => void run(() => confirmCompletion(activityId), t("ride.actions.completed"))}
        >
          {t("ride.actions.confirm")}
        </button>
      )}
      {completionRequested && completionRequestedBy === "ME" && <p className={styles.muted}>{t("ride.actions.waiting")}</p>}
      {chatId && active && (
        <Link to={`/inbox/${chatId}`} className={buttonStyles.secondary}>
          <MessageCircle aria-hidden size={18} /> {t("ride.actions.chat")}
        </Link>
      )}
      {(status === "ACCEPTED" || (status === "IN_PROGRESS" && !completionRequested)) && (
        <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => setCancelOpen(true)}>
          {t("ride.actions.cancel")}
        </button>
      )}
      <ConfirmSheet
        title={t("ride.actions.cancelTitle")}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        confirmLabel={t("ride.actions.cancel")}
        onConfirm={async () => {
          await cancelActivity(activityId, reason.trim());
          setCancelOpen(false);
          toast.show(t("ride.actions.cancelled"));
          onChanged();
        }}
      >
        <p className={styles.muted}>{t("ride.actions.cancelHint")}</p>
        <ReasonField value={reason} onChange={setReason} />
      </ConfirmSheet>
    </div>
  );
}

export function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <label className={styles.actions}>
      <span>{t("ride.actions.reason")}</span>
      <textarea className={styles.textarea} value={value} maxLength={500} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
