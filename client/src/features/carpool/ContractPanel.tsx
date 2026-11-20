import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { FormAlert } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { StatusChip, ToneChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formatRideTime } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { ReportSheet } from "../activity/ReportSheet";
import { ReviewPanel } from "../activity/ReviewPanel";
import { cancelActivity } from "../ride/ride-api";
import { ReasonField } from "../ride/RideActions";
import { taka } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import {
  answerTermination,
  completeSession,
  markPaymentPaid,
  renewContract,
  requestTermination,
  setPaymentMethod,
  withdrawTermination,
  type CarpoolBooking,
  type CarpoolSession,
  type MonthlyPayment,
  type PaymentMethod,
} from "./carpool-api";
import { showDate } from "./carpool-shared";
import carpoolStyles from "./carpool.module.css";

// A carpool contract after it starts (proposal 9.3 steps 6-8, 9.5, 9.6; B6b):
// marking sessions, the month-by-month history, the monthly payment records,
// ending early by agreement, reviews and Renew after a normal end, and a
// complaint (a report to UniGo) when the two do not agree.

// A session can be marked Completed from 30 minutes before its departure
// (the server checks it too, rules.carpool.sessionCompleteAllowedBefore).
const COMPLETE_FROM_MS = 30 * 60 * 1000;
const METHODS: PaymentMethod[] = ["CASH", "BKASH", "NAGAD"];

export function ContractPanel({ booking, reload }: { booking: CarpoolBooking; reload: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const isRider = booking.role === "RIDER";
  const other = isRider ? booking.passenger : booking.rider;
  const contract = booking.contract!;

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await work();
      toast.show(done);
    } catch (failure) {
      setError(formErrors(failure, t).form ?? t("errors.generic"));
    }
    reload();
  };

  return (
    <>
      {error && <FormAlert>{error}</FormAlert>}
      {contract.status === "ACTIVE" && <TerminationCard booking={booking} run={run} />}
      {contract.status === "TERMINATED" && <FormAlert tone="info">{t("carpool.contract.terminatedNote")}</FormAlert>}
      {booking.status === "COMPLETED" && <ReviewPanel activityId={booking.activityId} />}
      {!isRider && booking.renewal && <RenewCard booking={booking} />}
      <PaymentsCard payments={booking.payments} isRider={isRider} run={run} />
      <HistoryCard booking={booking} />
      <SessionList sessions={booking.sessions} run={run} reload={reload} />
      {other && (
        <div className={styles.actions}>
          <button type="button" className={buttonStyles.secondary} onClick={() => setReportOpen(true)}>
            {t("carpool.contract.complaint")}
          </button>
        </div>
      )}
      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} activityId={booking.activityId} reportedUserId={other?.id} />
    </>
  );
}

type Run = (work: () => Promise<unknown>, done: string) => Promise<void>;

function TerminationCard({ booking, run }: { booking: CarpoolBooking; run: Run }) {
  const { t } = useTranslation();
  const [askOpen, setAskOpen] = useState(false);
  const [reason, setReason] = useState("");
  const termination = booking.contract?.termination ?? null;

  return (
    <section className={styles.section} aria-label={t("carpool.contract.endEarly")}>
      <h2 className={styles.sectionTitle}>{t("carpool.contract.endEarly")}</h2>
      {!termination && (
        <>
          <p className={styles.muted}>{t("carpool.contract.endEarlyHint")}</p>
          <div className={styles.actions}>
            <button type="button" className={buttonStyles.secondary} onClick={() => setAskOpen(true)}>
              {t("carpool.contract.askEndEarly")}
            </button>
          </div>
        </>
      )}
      {termination?.requestedBy === "ME" && (
        <>
          <p>{t("carpool.contract.youAsked", { reason: termination.reason ?? "" })}</p>
          <div className={styles.actions}>
            <button type="button" className={buttonStyles.secondary} onClick={() => void run(() => withdrawTermination(booking.activityId), t("carpool.contract.withdrawn"))}>
              {t("carpool.contract.withdraw")}
            </button>
          </div>
        </>
      )}
      {termination?.requestedBy === "OTHER" && (
        <>
          <p>{t("carpool.contract.otherAsked", { reason: termination.reason ?? "" })}</p>
          <p className={styles.muted}>{t("carpool.contract.agreeHint")}</p>
          <div className={styles.actions}>
            <button type="button" className={buttonStyles.primary} onClick={() => void run(() => answerTermination(booking.activityId, true), t("carpool.contract.ended"))}>
              {t("carpool.contract.agreeEnd")}
            </button>
            <button type="button" className={buttonStyles.secondary} onClick={() => void run(() => answerTermination(booking.activityId, false), t("carpool.contract.declined"))}>
              {t("carpool.contract.declineEnd")}
            </button>
          </div>
        </>
      )}
      <ConfirmSheet
        title={t("carpool.contract.askEndEarly")}
        open={askOpen}
        onClose={() => setAskOpen(false)}
        confirmLabel={t("carpool.contract.send")}
        onConfirm={async () => {
          await run(() => requestTermination(booking.activityId, reason.trim()), t("carpool.contract.asked"));
          setAskOpen(false);
          setReason("");
        }}
      >
        <p className={styles.muted}>{t("carpool.contract.askHint")}</p>
        <ReasonField value={reason} onChange={setReason} />
      </ConfirmSheet>
    </section>
  );
}

function RenewCard({ booking }: { booking: CarpoolBooking }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [months, setMonths] = useState(booking.durationMonths);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const renewal = booking.renewal!;
  const durations = booking.post.prices.map((price) => price.durationMonths);

  if (!renewal.available) {
    return (
      <FormAlert tone="info">
        {t("carpool.renew.pending")}{" "}
        <a href={`/carpool/bookings/${renewal.pendingActivityId}`} onClick={(event) => (event.preventDefault(), void navigate(`/carpool/bookings/${renewal.pendingActivityId}`))}>
          {t("carpool.renew.open")}
        </a>
      </FormAlert>
    );
  }
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await renewContract(booking.activityId, months);
      toast.show(t("carpool.renew.sent"));
      void navigate(`/carpool/bookings/${result.booking.activityId}`);
    } catch (failure) {
      setError(formErrors(failure, t).form ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.section} aria-label={t("carpool.renew.title")}>
      <h2 className={styles.sectionTitle}>{t("carpool.renew.title")}</h2>
      <p className={styles.muted}>{t("carpool.renew.hint", { date: showDate(renewal.startDate, i18n.language), until: formatRideTime(renewal.until, i18n.language) })}</p>
      {error && <FormAlert>{error}</FormAlert>}
      <label className={formStyles.field}>
        <span className={formStyles.label}>{t("carpool.renew.duration")}</span>
        <select className={formStyles.input} value={months} onChange={(event) => setMonths(Number(event.target.value))}>
          {durations.map((count) => (
            <option key={count} value={count}>
              {t("carpool.months", { count })}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void submit()}>
        {t("carpool.renew.action")}
      </button>
    </section>
  );
}

function PaymentsCard({ payments, isRider, run }: { payments: MonthlyPayment[]; isRider: boolean; run: Run }) {
  const { t, i18n } = useTranslation();
  return (
    <section className={styles.section} aria-label={t("carpool.payments.title")}>
      <h2 className={styles.sectionTitle}>{t("carpool.payments.title")}</h2>
      {payments.length === 0 && <p className={styles.muted}>{t("carpool.payments.none")}</p>}
      <ul className={carpoolStyles.sessions}>
        {payments.map((payment) => (
          <li key={payment.id} className={carpoolStyles.session}>
            <span>
              {t("carpool.payments.month", { number: payment.monthNumber })} · {showDate(payment.periodStart, i18n.language)} – {showDate(payment.periodEnd, i18n.language)}
              <br />
              <strong>{taka(payment.amount, i18n.language)}</strong>
            </span>
            <span className={styles.actions}>
              <ToneChip tone={payment.status === "PAID" ? "green" : "amber"} label={t(`payment.status.${payment.status}`)} />
              {payment.status === "UNPAID" ? (
                <select
                  className={formStyles.input}
                  aria-label={t("carpool.payments.method")}
                  value={payment.method ?? ""}
                  onChange={(event) => void run(() => setPaymentMethod(payment.id, event.target.value as PaymentMethod), t("carpool.payments.saved"))}
                >
                  <option value="" disabled>
                    {t("carpool.payments.method")}
                  </option>
                  {METHODS.map((method) => (
                    <option key={method} value={method}>
                      {t(`payment.methods.${method}`)}
                    </option>
                  ))}
                </select>
              ) : (
                payment.method && <span>{t(`payment.methods.${payment.method}`)}</span>
              )}
              {isRider && payment.status === "UNPAID" && (
                <button type="button" className={buttonStyles.secondary} disabled={!payment.method} onClick={() => void run(() => markPaymentPaid(payment.id), t("carpool.payments.markedPaid"))}>
                  {t("carpool.payments.markPaid")}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {!isRider && <p className={styles.muted}>{t("carpool.payments.passengerHint")}</p>}
    </section>
  );
}

function HistoryCard({ booking }: { booking: CarpoolBooking }) {
  const { t, i18n } = useTranslation();
  if (booking.history.length === 0) return null;
  return (
    <section className={styles.section} aria-label={t("carpool.history.title")}>
      <h2 className={styles.sectionTitle}>{t("carpool.history.title")}</h2>
      <ul className={carpoolStyles.sessions}>
        {booking.history.map((month) => (
          <li key={month.monthNumber} className={carpoolStyles.session}>
            <span>
              {t("carpool.payments.month", { number: month.monthNumber })} · {showDate(month.periodStart, i18n.language)} – {showDate(month.periodEnd, i18n.language)}
            </span>
            <span className={styles.meta}>
              {t("carpool.history.line", {
                completed: month.completed,
                notMarked: month.notMarked,
                byMe: month.cancelledByMe,
                byOther: month.cancelledByOther,
                total: month.total,
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SessionList({ sessions, run, reload }: { sessions: CarpoolSession[]; run: Run; reload: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<CarpoolSession | null>(null);
  const [reason, setReason] = useState("");
  const now = Date.now();

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{t("carpool.sessions.title", { count: sessions.length })}</h2>
      <ul className={carpoolStyles.sessions}>
        {sessions.map((session) => {
          const start = new Date(session.startTime).getTime();
          const open = session.status === "ACCEPTED";
          return (
            <li key={session.activityId} className={carpoolStyles.session}>
              <span>
                {formatRideTime(session.startTime, i18n.language)}
                {session.status === "CANCELLED" && (
                  <span className={styles.meta}>
                    {session.cancelledBy ? t(session.cancelledBy === "ME" ? "carpool.sessions.cancelledByMe" : "carpool.sessions.cancelledByOther") : t("carpool.sessions.closed")}
                  </span>
                )}
              </span>
              <span className={styles.actions}>
                <StatusChip status={session.status} />
                {open && now >= start - COMPLETE_FROM_MS && (
                  <button type="button" className={buttonStyles.secondary} onClick={() => void run(() => completeSession(session.activityId), t("carpool.sessions.markedCompleted"))}>
                    {t("carpool.sessions.complete")}
                  </button>
                )}
                {open && (
                  <button type="button" className={buttonStyles.secondary} onClick={() => setCancelling(session)}>
                    {t("carpool.sessions.cancel")}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <ConfirmSheet
        title={t("carpool.sessions.cancelTitle")}
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        confirmLabel={t("carpool.sessions.cancel")}
        onConfirm={async () => {
          if (!cancelling) return;
          await cancelActivity(cancelling.activityId, reason.trim());
          setCancelling(null);
          setReason("");
          toast.show(t("ride.actions.cancelled"));
          reload();
        }}
      >
        <p className={styles.muted}>{t("carpool.sessions.cancelHint")}</p>
        <ReasonField value={reason} onChange={setReason} />
      </ConfirmSheet>
    </section>
  );
}
