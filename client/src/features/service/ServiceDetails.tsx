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
import { cancelActivity, confirmCompletion, deleteActivity } from "../ride/ride-api";
import { ReasonField } from "../ride/RideActions";
import { PersonRow, Route, taka } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import {
  acceptServiceRequest,
  deliverService,
  getServiceRequest,
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
      await cancelActivity(request.id, cancelReason.trim());
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

      {/* Payment & Reviews */}
      {participant && !isOpen && (
        <PaymentCard key={`${request.status}-${request.subStatus}`} activityId={request.id} />
      )}
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
            {/* Accepter can start when ACCEPTED */}
            {request.status === "ACCEPTED" && isAccepter && (
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

            {/* Requester can confirm completion when COMPLETION_REQUESTED */}
            {isCompletionRequested && isRequester && (
              <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void handleConfirmCompletion()}>
                <CheckCircle2 aria-hidden size={16} /> {t("ride.actions.confirm")}
              </button>
            )}

            {isCompletionRequested && isAccepter && (
              <p className={styles.muted}>{t("ride.actions.waiting")}</p>
            )}

            {request.chatId && active && (
              <Link to={`/inbox/${request.chatId}`} className={buttonStyles.secondary}>
                <MessageCircle aria-hidden size={18} /> {t("ride.actions.chat")}
              </Link>
            )}

            {active && !isCompletionRequested && (
              <button type="button" className={buttonStyles.secondary} disabled={busy} onClick={() => setSheet("cancel")}>
                {t("service.actions.cancel")}
              </button>
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
