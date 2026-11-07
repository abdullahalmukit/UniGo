import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { ToneChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { taka } from "../ride/RideCard";
import { getPayment, markPaid, PAYMENT_METHODS, setPaymentMethod, type Payment } from "./extras-api";
import styles from "./extras.module.css";

// The payment record of an accepted activity (proposal 16, B3b-2). UniGo
// never takes a payment: either person picks how it is paid, and only the
// person who receives the money marks it paid (final).
export function PaymentCard({ activityId }: { activityId: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(() => {
    getPayment(activityId)
      .then(setPayment)
      .catch(() => setPayment(null));
  }, [activityId]);
  useEffect(load, [load]);

  if (!payment) return null;

  const choose = async (method: (typeof PAYMENT_METHODS)[number]) => {
    setBusy(true);
    try {
      setPayment(await setPaymentMethod(activityId, method));
    } catch (failure) {
      toast.show(formErrors(failure, t).form ?? t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby={`pay-${activityId}`}>
      <div className={styles.row}>
        <h2 id={`pay-${activityId}`} className={styles.title}>
          {t("payment.title")}
        </h2>
        <ToneChip tone={payment.status === "PAID" ? "green" : "amber"} label={t(`payment.status.${payment.status}`)} />
      </div>
      <p className={styles.amount}>
        ৳{taka(payment.amount, i18n.language)} · {payment.payee === "ME" ? t("payment.youReceive") : t("payment.youPay")}
      </p>
      <div className={styles.methods} role="group" aria-label={t("payment.method")}>
        {PAYMENT_METHODS.map((method) => (
          <button
            key={method}
            type="button"
            className={styles.method}
            aria-pressed={payment.method === method}
            disabled={busy || !payment.canChooseMethod}
            onClick={() => void choose(method)}
          >
            {t(`payment.methods.${method}`)}
          </button>
        ))}
      </div>
      {payment.payee === "ME" && payment.status === "UNPAID" && (
        <button type="button" className={buttonStyles.secondary} disabled={!payment.canMarkPaid || busy} onClick={() => setConfirm(true)}>
          {t("payment.markPaid")}
        </button>
      )}
      {payment.payee === "ME" && payment.status === "UNPAID" && !payment.method && <p className={styles.note}>{t("payment.chooseFirst")}</p>}
      <p className={styles.note}>{t("payment.noGateway")}</p>
      <ConfirmSheet
        title={t("payment.confirmTitle")}
        open={confirm}
        onClose={() => setConfirm(false)}
        confirmLabel={t("payment.markPaid")}
        onConfirm={async () => {
          setPayment(await markPaid(activityId));
          setConfirm(false);
          toast.show(t("payment.marked"));
        }}
      >
        <p className={styles.note}>{t("payment.confirmText", { amount: taka(payment.amount, i18n.language) })}</p>
      </ConfirmSheet>
    </section>
  );
}
