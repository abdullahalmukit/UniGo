import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { taka } from "../ride/RideCard";
import { decideApproval } from "./food-api";
import styles from "./food.module.css";

type Approval = { id: string; amount: number; previousAmount: number; status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" };

// The over-budget approval card in a food chat (proposal 10.4, B4): the
// accepter asks for a higher food price before buying; the requester approves
// or rejects it once. The decision is recorded on the server.
export function ApprovalCard({
  approval,
  activityId,
  canDecide,
  onDecided,
}: {
  approval: Approval;
  activityId: string;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await decideApproval(activityId, approval.id, approve);
      toast.show(approve ? t("food.approval.approvedToast") : t("food.approval.rejectedToast"));
      onDecided();
    } catch (failure) {
      toast.show(formErrors(failure, t).form ?? t("errors.generic"), "error");
      onDecided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.card} role="group" aria-label={t("food.approval.title")}>
      <strong>{t("food.approval.title")}</strong>
      <span>{t("food.approval.line", { from: taka(approval.previousAmount, i18n.language), to: taka(approval.amount, i18n.language) })}</span>
      {approval.status === "PENDING" && canDecide ? (
        <div className={styles.cardButtons}>
          <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void decide(true)}>
            {t("food.approval.approve")}
          </button>
          <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => void decide(false)}>
            {t("food.approval.reject")}
          </button>
        </div>
      ) : (
        <span className={approval.status === "APPROVED" ? styles.ok : styles.waiting}>{t(`food.approval.status.${approval.status}`)}</span>
      )}
    </div>
  );
}
