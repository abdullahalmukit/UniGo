import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { FormAlert } from "../../components/form";
import { ToneChip } from "../../components/StatusChip";
import { buttonStyles, PageHeader, Section } from "../../components/ui";
import { formatDate } from "../../lib/dates";
import { adminApi, privateFileUrl, type AdminVehicle, type ApprovalStatus, type RiderDocument } from "./admin-api";
import { ConfirmSheet, formatDateTime, Loaded, TextAreaField, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

const TONE: Record<ApprovalStatus, "amber" | "green" | "red"> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };

// One rider application (B1): the applicant, each document through a fresh
// 5-minute link, the vehicles with full registration numbers, and the decision.
export function AdminRiderApplicationPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, reload } = useLoad(() => adminApi.riderApplication(id).then((r) => r.application), [id]);
  const [sheet, setSheet] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");

  return (
    <>
      <PageHeader title={t("admin.riders.reviewTitle")} />
      <div className={styles.stack}>
        <Link to="/admin/rider-requests" className={buttonStyles.secondary}>
          {t("admin.back")}
        </Link>
        <Loaded state={state} reload={reload}>
          {(application) => {
            const user = application.user;
            const name = user.name ?? user.email;
            return (
              <>
                <div className={styles.item}>
                  <div className={styles.itemHeader}>
                    <Link to={`/admin/users/${user.id}`} className={styles.itemTitle}>
                      {name}
                    </Link>
                    <ToneChip tone={TONE[application.status]} label={t(`rider.status.${application.status}`)} />
                  </div>
                  <dl className={styles.keyValues}>
                    <dt>{t("admin.riders.kind")}</dt>
                    <dd>{t(application.kind === "INITIAL" ? "rider.application" : "rider.reverification")}</dd>
                    <dt>{t("admin.users.email")}</dt>
                    <dd>{user.email}</dd>
                    <dt>{t("admin.users.phone")}</dt>
                    <dd>{user.phone}</dd>
                    <dt>{t("admin.users.university")}</dt>
                    <dd>{user.university.name}</dd>
                    <dt>{t("admin.riders.licenceExpiry")}</dt>
                    <dd>{formatDate(application.licenceExpiresOn, i18n.language)}</dd>
                    {user.licenceExpiresOn && (
                      <>
                        <dt>{t("admin.riders.currentLicence")}</dt>
                        <dd>{formatDate(user.licenceExpiresOn, i18n.language)}</dd>
                      </>
                    )}
                    <dt>{t("admin.verifications.submitted")}</dt>
                    <dd>{formatDateTime(application.submittedAt, i18n.language)}</dd>
                    {application.reviewedBy && (
                      <>
                        <dt>{t("admin.riders.reviewedBy")}</dt>
                        <dd>
                          {application.reviewedBy.name ?? "—"} · {formatDateTime(application.reviewedAt, i18n.language)}
                        </dd>
                      </>
                    )}
                    {application.rejectionReason && (
                      <>
                        <dt>{t("admin.verifications.reason")}</dt>
                        <dd>{application.rejectionReason}</dd>
                      </>
                    )}
                  </dl>
                </div>

                <Section title={t("admin.riders.documents")}>
                  <Documents applicationId={application.id} documents={application.documents} />
                </Section>
                {application.documentsOnFile.length > 0 && (
                  <Section title={t("admin.riders.documentsOnFile")}>
                    <Documents applicationId={application.id} documents={application.documentsOnFile} />
                  </Section>
                )}

                <Section title={t("admin.riders.vehiclesTitle")}>
                  {application.vehicles.length === 0 ? (
                    <p className={styles.muted}>{t("admin.riders.noNewVehicles")}</p>
                  ) : (
                    <Vehicles vehicles={application.vehicles} />
                  )}
                </Section>
                {application.approvedVehicles.length > 0 && (
                  <Section title={t("admin.riders.approvedVehicles")}>
                    <Vehicles vehicles={application.approvedVehicles} />
                  </Section>
                )}

                <Section title={t("rider.history")}>
                  <ul className={styles.list}>
                    {application.history.map((item) => (
                      <li key={item.id} className={styles.item}>
                        <div className={styles.itemHeader}>
                          <span>{t(item.kind === "INITIAL" ? "rider.application" : "rider.reverification")}</span>
                          <ToneChip tone={TONE[item.status]} label={t(`rider.status.${item.status}`)} />
                        </div>
                        <span className={styles.muted}>
                          {formatDateTime(item.submittedAt, i18n.language)}
                          {item.rejectionReason ? ` · ${item.rejectionReason}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>

                {application.status === "PENDING" && (
                  <div className={styles.row}>
                    <button type="button" className={buttonStyles.primary} onClick={() => setSheet("approve")}>
                      {t("admin.verifications.approve")}
                    </button>
                    <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("reject")}>
                      {t("admin.verifications.reject")}
                    </button>
                  </div>
                )}

                <ConfirmSheet
                  title={t("admin.riders.approveTitle")}
                  open={sheet === "approve"}
                  onClose={() => setSheet(null)}
                  confirmLabel={t("admin.verifications.approve")}
                  onConfirm={async () => {
                    await adminApi.approveRiderApplication(application.id);
                    navigate("/admin/rider-requests");
                  }}
                >
                  <p>{t("admin.riders.approveText", { name })}</p>
                </ConfirmSheet>
                <ConfirmSheet
                  title={t("admin.riders.rejectTitle")}
                  open={sheet === "reject"}
                  onClose={() => setSheet(null)}
                  confirmLabel={t("admin.verifications.reject")}
                  onConfirm={async () => {
                    await adminApi.rejectRiderApplication(application.id, reason);
                    navigate("/admin/rider-requests");
                  }}
                >
                  <TextAreaField label={t("admin.reason")} value={reason} onChange={setReason} />
                  <p className={styles.muted}>{t("admin.riders.rejectHint")}</p>
                </ConfirmSheet>
              </>
            );
          }}
        </Loaded>
      </div>
    </>
  );
}

// Each document opens through a fresh 5-minute signed link when asked for.
function Documents({ applicationId, documents }: { applicationId: string; documents: RiderDocument[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ id: string; url: string; mimeType: string | null } | null>(null);
  const [failed, setFailed] = useState(false);

  const show = async (document: RiderDocument) => {
    setFailed(false);
    try {
      const link = await adminApi.riderDocument(applicationId, document.id);
      setOpen({ id: document.id, url: privateFileUrl(link.url), mimeType: link.mimeType });
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        {documents.map((document) => (
          <button
            key={document.id}
            type="button"
            className={buttonStyles.secondary}
            aria-pressed={open?.id === document.id}
            onClick={() => void show(document)}
          >
            <FileText aria-hidden size={18} />
            {t(`admin.riders.documentTypes.${document.type}`)}
          </button>
        ))}
      </div>
      {failed && <FormAlert>{t("admin.verifications.fileFailed")}</FormAlert>}
      {open &&
        (open.mimeType === "application/pdf" ? (
          <iframe title={t("admin.verifications.document")} src={open.url} className={styles.pdf} />
        ) : (
          <img src={open.url} alt={t("admin.verifications.document")} className={styles.document} onError={() => setFailed(true)} />
        ))}
      {open && (
        <a href={open.url} target="_blank" rel="noreferrer noopener" className={styles.row}>
          <ExternalLink aria-hidden size={18} />
          {t("admin.verifications.openFile")}
        </a>
      )}
      <p className={styles.muted}>{t("admin.verifications.linkExpires")}</p>
    </div>
  );
}

function Vehicles({ vehicles }: { vehicles: AdminVehicle[] }) {
  const { t } = useTranslation();
  return (
    <ul className={styles.list}>
      {vehicles.map((vehicle) => (
        <li key={vehicle.id} className={styles.item}>
          <img src={privateFileUrl(vehicle.photo.url)} alt={t("admin.riders.vehiclePhoto")} className={styles.document} />
          <div className={styles.itemHeader}>
            <span className={styles.itemTitle}>
              {t(`rider.vehicleTypes.${vehicle.type}`)} · {vehicle.brand} {vehicle.model}
            </span>
            <ToneChip tone={TONE[vehicle.status]} label={t(`rider.status.${vehicle.status}`)} />
          </div>
          <span className={styles.muted}>
            {vehicle.registrationNumber} · {vehicle.colour} · {t("rider.seatsCount", { count: vehicle.seatCapacity })}
          </span>
        </li>
      ))}
    </ul>
  );
}
