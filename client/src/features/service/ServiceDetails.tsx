import { Briefcase, Calendar, CheckCircle2, Clock, Flag, MapPin, MessageCircle, Play, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { RaiseDisputeSheet } from "../activity/RaiseDisputeSheet";
import { ReportSheet } from "../activity/ReportSheet";
import { ContactRow } from "../../components/ContactRow";
import { FormAlert } from "../../components/form";
import { StatusChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { formatRideTime } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import { PaymentCard } from "../activity/PaymentCard";
import { ReviewPanel } from "../activity/ReviewPanel";
import { confirmCompletion, deleteActivity } from "../ride/ride-api";
import { ReasonField } from "../ride/RideActions";
import { PersonRow, Route, taka } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import {
  acceptServiceRequest,
  cancelService,
  confirmPaymentMode,
  confirmPaymentReceived,
  deliverService,
  getServiceRequest,
  markPaymentSent,
  proposePaymentMode,
  startService,
  type ServiceRequest,
} from "./service-api";
import { categoryLabel, categorySafetyWarning, ServiceAmount } from "./ServiceCard";

const TERMINAL = ["COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];

const errorText = (failure: unknown, t: Parameters<typeof formErrors>[1]) => {
  const errors = formErrors(failure, t);
  return errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic");
};

export function ServiceDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const toast = useToast();
  const navigate = useNavigate();

  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [error, setError] = useState<"NOT_FOUND" | "FAILED" | null>(null);
  const [sheet, setSheet] = useState<"accept" | "delete" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [disputeSheet, setDisputeSheet] = useState(false);
  const [reportSheet, setReportSheet] = useState(false);

  const reload = useCallback(() => {
    getServiceRequest(id)
      .then((r) => {
        setRequest(r.request);
        setError(null);
      })
      .catch((failure) => {
        setError(failure instanceof ApiError && failure.status === 404 ? "NOT_FOUND" : "FAILED");
      });
  }, [id]);

  useEffect(reload, [reload]);

  // Auto-poll while ACCEPTED (payment mode negotiation) or POST_PAY COMPLETION_REQUESTED
  // so both sides see updates without manual refresh
  useEffect(() => {
    if (!request) return;
    const isNegotiating = request.status === "ACCEPTED";
    const isAwaitingPayment =
      request.status === "IN_PROGRESS" &&
      request.subStatus === "COMPLETION_REQUESTED" &&
      request.paymentMode === "POST_PAY" &&
      !request.paymentPaid;
    if (!isNegotiating && !isAwaitingPayment) return;
    const timer = setInterval(reload, 4000);
    return () => clearInterval(timer);
  }, [reload, request?.status, request?.subStatus, request?.paymentMode, request?.paymentPaid]);

  if (!request) {
    return (
      <div className={styles.narrow}>
        <SubPageHeader title={t("service.detailTitle")} back="/service" />
        {error ? <FormAlert>{error === "NOT_FOUND" ? t("service.notFound") : t("service.loadFailed")}</FormAlert> : <SkeletonList rows={4} />}
      </div>
    );
  }

  const isOpen = request.status === "OPEN";
  const participant = request.role !== null;
  const other = request.role === "REQUESTER" ? request.accepter : request.requester;
  const safetyWarning = categorySafetyWarning(request.category.code, t);
  const isAccepter = request.role === "ACCEPTER";
  const isRequester = request.role === "REQUESTER";
  const isCompletionRequested = request.subStatus === "COMPLETION_REQUESTED";
  const active = request.status === "ACCEPTED" || request.status === "IN_PROGRESS" || request.status === "DISPUTED";

  // Cancel permission rules:
  // - ACCEPTED: both can cancel
  // - IN_PROGRESS + payment NOT paid: both can cancel
  // - IN_PROGRESS + payment PAID: only accepter can cancel (requester must dispute)
  // - COMPLETION_REQUESTED or SERVICE_DELIVERED: nobody can cancel
  const canCancel = (() => {
    if (!active || isCompletionRequested) return false;
    if (request.status === "ACCEPTED") return true;
    if (request.status === "IN_PROGRESS") {
      if (isAccepter) return true;
      // Requester blocked from cancelling once payment is made
      return !request.paymentPaid;
    }
    return false;
  })();

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    try {
      await action();
      toast.show(successMessage);
      reload();
    } catch (failure) {
      toast.show(errorText(failure, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async () => {
    await runAction(async () => {
      await acceptServiceRequest(request.id);
      setSheet(null);
    }, t("service.actions.acceptedToast"));
  };

  const handleStart = async () => {
    await runAction(async () => {
      await startService(request.id);
    }, t("service.actions.startedToast"));
  };

  const handleDeliver = async () => {
    await runAction(async () => {
      await deliverService(request.id);
    }, t("service.actions.deliveredToast"));
  };

  const handleConfirmCompletion = async () => {
    await runAction(async () => {
      await confirmCompletion(request.id);
    }, t("service.actions.completedToast"));
  };

  const handleDelete = async () => {
    await runAction(async () => {
      await deleteActivity(request.id);
      setSheet(null);
      navigate("/service", { replace: true });
    }, t("service.actions.deletedToast"));
  };

  const handleCancel = async () => {
    await runAction(async () => {
      await cancelService(request.id, cancelReason.trim());
      setSheet(null);
    }, t("service.actions.cancelledToast"));
  };

  return (
    <div className={styles.narrow}>
      <SubPageHeader
        title={t("service.detailTitle")}
        back="/service"
        action={<StatusChip status={request.status} />}
      />

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

      {/* Main Request Information */}
      <section className={styles.section}>
        <div className={styles.row}>
          <span className={styles.kind}>
            <Briefcase aria-hidden size={14} /> {categoryLabel(request.category.code, t)}
          </span>
          <ServiceAmount offered={request.offeredAmount} budget={request.estimatedBudget} />
        </div>

        <h2 style={{ fontSize: "1.125rem", fontWeight: 700, margin: "6px 0 2px" }}>
          {request.serviceTitle}
        </h2>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-text-muted)", margin: "0 0 8px" }}>
          {request.taskTitle}
        </h3>

        <p style={{ margin: "4px 0 10px", lineHeight: 1.5 }}>
          {request.description}
        </p>

        {request.pickup ? (
          <Route pickup={request.pickup} destination={request.destination} />
        ) : (
          <div className={styles.meta} style={{ marginTop: "4px" }}>
            <MapPin aria-hidden size={14} />
            <span>{request.destination.address}</span>
          </div>
        )}

        <div className={styles.meta} style={{ marginTop: "6px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {request.hasPreferredTime ? <Clock aria-hidden size={14} /> : <Calendar aria-hidden size={14} />}
            {request.hasPreferredTime
              ? formatRideTime(request.startTime, lang)
              : `${request.preferredDate} (${t("service.anyTime")})`}
          </span>
          {request.subArea && <span>{request.subArea.name}</span>}
        </div>
      </section>

      {/* Optional details (only when provided) */}
      {(request.itemDetails || request.quantity || request.instructions) && (
        <section className={styles.section}>
          <h4 style={{ fontSize: "0.9rem", fontWeight: 600, margin: "0 0 6px" }}>{t("service.optionalDetailsTitle")}</h4>
          {request.itemDetails && (
            <p style={{ margin: "2px 0 4px", fontSize: "0.875rem" }}>
              <strong>{t("service.itemDetailsLabel")}:</strong> {request.itemDetails} {request.quantity ? `(×${request.quantity})` : ""}
            </p>
          )}
          {request.instructions && (
            <p style={{ margin: "4px 0 2px", fontSize: "0.875rem", fontStyle: "italic" }}>
              <strong>{t("service.instructionsLabel")}:</strong> {request.instructions}
            </p>
          )}
        </section>
      )}

      {/* People Section */}
      <section className={styles.section}>
        <PersonRow person={request.requester} caption={t("service.role.requester")} />
        {request.accepter && <PersonRow person={request.accepter} caption={t("service.role.accepter")} />}
        <ContactRow phone={request.phone} name={other?.name} />
      </section>

      {/* Payment Mode Agreement Panel — shown when both parties are involved and status is ACCEPTED */}
      {participant && request.status === "ACCEPTED" && (
        <PaymentModeAgreementPanel
          request={request}
          isAccepter={isAccepter}
          isRequester={isRequester}
          busy={busy}
          setBusy={setBusy}
          onChanged={reload}
        />
      )}

      {/* Payment & Reviews */}
      {participant && !isOpen && (() => {
        // PRE_PAY: payment handled internally via PaymentModeAgreementPanel — never show PaymentCard
        if (request.paymentMode === "PRE_PAY") return null;
        // ACCEPTED: always hide (work hasn't started yet)
        if (request.status === "ACCEPTED") return null;
        // POST_PAY: only unlock payment after taker confirms delivery (COMPLETION_REQUESTED)
        if (request.paymentMode === "POST_PAY" && request.subStatus !== "COMPLETION_REQUESTED") return null;

        return (
          <>
            {/* Hint for legacy flow: payment locked until provider marks delivery */}
            {request.paymentMode === null &&
              request.status === "IN_PROGRESS" &&
              request.subStatus !== "SERVICE_DELIVERED" &&
              request.subStatus !== "COMPLETION_REQUESTED" && (
                <p className={styles.muted} style={{ padding: "0 16px", fontSize: "0.85rem" }}>
                  {t("payment.serviceDeliverFirst")}
                </p>
              )}
            <PaymentCard key={`${request.status}-${request.subStatus}`} activityId={request.id} />
          </>
        );
      })()}
      {participant && request.status === "COMPLETED" && (
        <ReviewPanel activityId={request.id} />
      )}

      {/* Create Again CTA */}
      {request.mine && TERMINAL.includes(request.status) && (
        <Link to={`/service/requests/new?from=${request.id}`} className={buttonStyles.secondary}>
          {t("activity.actions.createAgain")}
        </Link>
      )}

      {/* Action Bars */}
      {isOpen && request.mine && (
        <div className={styles.actions}>
          <Link to={`/service/requests/${request.id}/edit`} className={buttonStyles.secondary}>
            {t("ride.actions.edit")}
          </Link>
          <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("delete")}>
            {t("ride.actions.delete")}
          </button>
        </div>
      )}

      {isOpen && !request.mine && (
        <div className={styles.sticky}>
          <button type="button" className={buttonStyles.primary} onClick={() => setSheet("accept")}>
            {t("service.actions.accept")}
          </button>
        </div>
      )}

      {/* Active participant actions */}
      {participant && !isOpen && (
        <div className={styles.sticky}>
          <div className={styles.actions}>
            {/* Accepter can start when ACCEPTED — only when payment mode is confirmed POST_PAY, or no payment mode set (legacy/backward compat) */}
            {request.status === "ACCEPTED" && isAccepter &&
              request.subStatus !== "PAYMENT_MODE_PROPOSED" &&
              request.subStatus !== "AWAITING_PAYMENT" &&
              request.subStatus !== "PAYMENT_SENT" &&
              (request.paymentModeConfirmed && request.paymentMode === "POST_PAY") && (
                <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void handleStart()}>
                  <Play aria-hidden size={16} /> {t("service.actions.start")}
                </button>
              )}

            {/* Accepter can deliver when IN_PROGRESS */}
            {request.status === "IN_PROGRESS" && isAccepter && !isCompletionRequested && (
              <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void handleDeliver()}>
                <Send aria-hidden size={16} /> {t("service.actions.deliver")}
              </button>
            )}

            {/* POST_PAY at COMPLETION_REQUESTED:
                - Taker: PaymentCard shows method selector + "sent in Cash" hint.
                  Confirm only unlocks AFTER Giver marks received (paymentPaid = true).
                - Giver: PaymentCard shows "৳X sent in Cash — Mark as received" button.
                  After marking: Taker gets Confirm button. */}
            {request.status === "IN_PROGRESS" && isCompletionRequested && request.paymentMode === "POST_PAY" && isRequester && request.completionRequestedBy === "OTHER" && (
              <>
                {request.paymentPaid ? (
                  /* Giver confirmed receipt → Taker can now confirm completion */
                  <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void handleConfirmCompletion()}>
                    <CheckCircle2 aria-hidden size={16} /> {t("ride.actions.confirm")}
                  </button>
                ) : (
                  /* Waiting for Giver to mark received — PaymentCard above handles the UI */
                  <p className={styles.muted}>{t("service.actions.postPayWaitingGiver")}</p>
                )}
              </>
            )}
            {request.status === "IN_PROGRESS" && isCompletionRequested && request.paymentMode === "POST_PAY" && isAccepter && (
              request.paymentPaid ? (
                /* Giver: payment confirmed received — waiting for taker's final confirm */
                <p className={styles.muted}>{t("service.actions.postPayReceivedConfirm")}</p>
              ) : (
                /* Giver: PaymentCard above shows Mark as received — just an extra hint */
                <p className={styles.muted}>{t("service.actions.waitingForPayment")}</p>
              )
            )}

            {/* Legacy / non-POST_PAY: standard completion flow */}
            {request.status === "IN_PROGRESS" && isCompletionRequested && request.paymentMode !== "POST_PAY" && isRequester && request.completionRequestedBy === "OTHER" && (
              <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void handleConfirmCompletion()}>
                <CheckCircle2 aria-hidden size={16} /> {t("ride.actions.confirm")}
              </button>
            )}

            {request.status === "IN_PROGRESS" && isCompletionRequested && request.paymentMode !== "POST_PAY" && (isAccepter || (isRequester && request.completionRequestedBy === "ME")) && (
              <p className={styles.muted}>{t("ride.actions.waiting")}</p>
            )}

            {request.chatId && active && (
              <Link to={`/inbox/${request.chatId}`} className={buttonStyles.secondary}>
                <MessageCircle aria-hidden size={18} /> {t("ride.actions.chat")}
              </Link>
            )}

            {canCancel && (
              <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => setSheet("cancel")}>
                {t("service.actions.cancel")}
              </button>
            )}

            {/* Requester blocked from cancel after payment — show hint */}
            {active && !isCompletionRequested && isRequester && request.paymentPaid && (
              <p className={styles.muted}>{t("service.actions.paidCannotCancel")}</p>
            )}

            {active && request.status !== "DISPUTED" && (
              <button type="button" className={buttonStyles.secondary} onClick={() => setDisputeSheet(true)}>
                <Flag aria-hidden size={16} /> {t("dispute.raise")}
              </button>
            )}

            {active && other && (
              <button type="button" className={buttonStyles.secondary} onClick={() => setReportSheet(true)}>
                {t("report.title")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Accept Confirmation Sheet */}
      <ConfirmSheet
        title={t("service.actions.acceptTitle")}
        open={sheet === "accept"}
        onClose={() => setSheet(null)}
        confirmLabel={t("service.actions.accept")}
        onConfirm={handleAccept}
      >
        <p className={styles.muted}>{t("service.actions.acceptHint")}</p>
      </ConfirmSheet>

      {/* Delete Confirmation Sheet */}
      <ConfirmSheet
        title={t("service.actions.deleteTitle")}
        open={sheet === "delete"}
        onClose={() => setSheet(null)}
        confirmLabel={t("ride.actions.delete")}
        onConfirm={handleDelete}
      >
        <p className={styles.muted}>{t("service.actions.deleteHint")}</p>
      </ConfirmSheet>

      {/* Cancel Confirmation Sheet */}
      <ConfirmSheet
        title={t("service.actions.cancelTitle")}
        open={sheet === "cancel"}
        onClose={() => setSheet(null)}
        confirmLabel={t("service.actions.cancel")}
        onConfirm={handleCancel}
      >
        <p className={styles.muted}>{t("ride.actions.cancelHint")}</p>
        <ReasonField value={cancelReason} onChange={setCancelReason} />
      </ConfirmSheet>

      <RaiseDisputeSheet
        activityId={request.id}
        open={disputeSheet}
        onClose={() => setDisputeSheet(false)}
        onRaised={reload}
        allowKind={isCompletionRequested}
      />

      <ReportSheet
        open={reportSheet}
        onClose={() => setReportSheet(false)}
        activityId={request.id}
        reportedUserId={other?.id}
      />
    </div>
  );
}

// ─── Payment Mode Agreement Panel ────────────────────────────────────────────

type PanelProps = {
  request: ServiceRequest;
  isAccepter: boolean;
  isRequester: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onChanged: () => void;
};

function PaymentModeAgreementPanel({ request, isAccepter, isRequester, busy, setBusy, onChanged }: PanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [selected, setSelected] = useState<"PRE_PAY" | "POST_PAY" | null>(null);

  const run = async (action: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await action();
      toast.show(msg);
      onChanged();
    } catch {
      toast.show(t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  };

  const sub = request.subStatus;
  const mode = request.paymentMode;

  // ── State 1: Giver selects mode then confirms ─────────────────────────────
  if (sub === null && isAccepter && mode === null) {
    return <PaymentModeSelectorPanel request={request} busy={busy} run={run} t={t} />;
  }

  // ── State 2a: Proposal sent — Giver waiting ────────────────────────────────
  if (sub === "PAYMENT_MODE_PROPOSED" && isAccepter) {
    return (
      <section className={styles.section}>
        <p className={styles.muted}>{t("service.actions.paymentModePending")}</p>
      </section>
    );
  }

  // ── State 2b: Proposal received — Taker must confirm ─────────────────────
  if (sub === "PAYMENT_MODE_PROPOSED" && isRequester) {
    const modeLabel = mode === "PRE_PAY" ? t("service.actions.prePayLabel") : t("service.actions.postPayLabel");
    return (
      <section className={styles.section}>
        <p style={{ marginBottom: 8 }}>{t("service.actions.paymentModeProposed", { mode: modeLabel })}</p>
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={busy}
          onClick={() => run(() => confirmPaymentMode(request.id), t("service.actions.paymentModeProposed", { mode: modeLabel }))}
        >
          {t("service.actions.confirmMode")}
        </button>
      </section>
    );
  }

  // ── State 3a: PRE_PAY — Taker must send payment ───────────────────────────
  if (sub === "AWAITING_PAYMENT" && isRequester) {
    return (
      <section className={styles.section}>
        <p style={{ marginBottom: 8 }}>{t("service.actions.awaitingPayment")}</p>
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={busy}
          onClick={() => run(() => markPaymentSent(request.id), t("service.actions.markPaymentSent"))}
        >
          {t("service.actions.markPaymentSent")}
        </button>
      </section>
    );
  }

  // ── State 3b: PRE_PAY — Giver waiting for payment ────────────────────────
  if (sub === "AWAITING_PAYMENT" && isAccepter) {
    return (
      <section className={styles.section}>
        <p className={styles.muted}>{t("service.actions.waitingForPayment")}</p>
      </section>
    );
  }

  // ── State 4a: PRE_PAY — Giver must confirm receipt ───────────────────────
  if (sub === "PAYMENT_SENT" && isAccepter) {
    return (
      <section className={styles.section}>
        <button
          type="button"
          className={buttonStyles.primary}
          disabled={busy}
          onClick={() => run(() => confirmPaymentReceived(request.id), t("service.actions.confirmPaymentReceived"))}
        >
          {t("service.actions.confirmPaymentReceived")}
        </button>
      </section>
    );
  }

  // ── State 4b: PRE_PAY — Taker waiting for confirmation ───────────────────
  if (sub === "PAYMENT_SENT" && isRequester) {
    return (
      <section className={styles.section}>
        <p className={styles.muted}>{t("service.actions.paymentSentWaiting")}</p>
      </section>
    );
  }

  // ── State 5: POST_PAY confirmed — show info ───────────────────────────────
  if (request.paymentModeConfirmed && mode === "POST_PAY") {
    return (
      <section className={styles.section}>
        <p className={styles.muted}>{t("service.actions.postPayAgreed")}</p>
      </section>
    );
  }

  return null;
}

// ── Selector sub-component (own state so select doesn't re-render parent) ──
type SelectorProps = {
  request: ServiceRequest;
  busy: boolean;
  run: (action: () => Promise<unknown>, msg: string) => Promise<void>;
  t: (key: string, opts?: Record<string, string>) => string;
};

function PaymentModeSelectorPanel({ request, busy, run, t }: SelectorProps) {
  const [selected, setSelected] = useState<"PRE_PAY" | "POST_PAY" | null>(null);

  return (
    <section className={styles.section}>
      <p style={{ fontWeight: 600, marginBottom: 10 }}>{t("service.actions.proposePaymentMode")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {(["PRE_PAY", "POST_PAY"] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            className={selected === opt ? buttonStyles.primary : buttonStyles.secondary}
            onClick={() => setSelected(opt)}
          >
            {opt === "PRE_PAY" ? t("service.actions.prePayLabel") : t("service.actions.postPayLabel")}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={buttonStyles.primary}
        disabled={busy || selected === null}
        onClick={() =>
          selected &&
          run(
            () => proposePaymentMode(request.id, selected),
            t("service.actions.paymentModeProposed", { mode: selected === "PRE_PAY" ? "Pre-pay" : "Post-pay" }),
          )
        }
      >
        {t("service.actions.confirmMode")}
      </button>
    </section>
  );
}
