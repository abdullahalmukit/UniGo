import { ExternalLink, IdCard } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader } from "../../components/ui";
import { adminApi, privateFileUrl, type IdCardReview } from "./admin-api";
import { ConfirmSheet, formatDateTime, Loaded, Pager, TextAreaField, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

type Tab = "PENDING" | "VERIFIED" | "REJECTED";

// Student ID card review (proposal sections 4 and 17.1).
export function AdminVerificationsPage() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("PENDING");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<IdCardReview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { state, reload } = useLoad(() => adminApi.idCards(tab, page), [tab, page]);

  const decided = (message: string) => {
    setSelected(null);
    setNotice(message);
    void reload();
  };

  if (selected) {
    return <Review card={selected} onBack={() => setSelected(null)} onDecided={decided} />;
  }

  return (
    <>
      <PageHeader title={t("admin.nav.verifications")} />
      <div className={styles.stack}>
        <div role="tablist" className={styles.tabs}>
          {(["PENDING", "VERIFIED", "REJECTED"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={styles.tab}
              onClick={() => {
                setTab(value);
                setPage(1);
              }}
            >
              {t(`admin.verifications.tabs.${value}`)}
            </button>
          ))}
        </div>
        {notice && <FormAlert tone="success">{notice}</FormAlert>}
        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={IdCard} text={t("admin.verifications.empty")} />
            ) : (
              <>
                <ul className={styles.list}>
                  {data.items.map((card) => (
                    <li key={card.id} className={styles.item}>
                      <div className={styles.itemHeader}>
                        <span className={styles.itemTitle}>{card.user.name ?? card.user.email}</span>
                        <span className={styles.muted}>{formatDateTime(card.submittedAt, i18n.language)}</span>
                      </div>
                      <span className={styles.muted}>
                        {card.user.university.name}
                        {card.user.studentIdNumber ? ` · ${card.user.studentIdNumber}` : ""}
                      </span>
                      {card.rejectionReason && <span className={styles.muted}>{card.rejectionReason}</span>}
                      <div className={styles.row}>
                        <button type="button" className={buttonStyles.secondary} onClick={() => setSelected(card)}>
                          {tab === "PENDING" ? t("admin.verifications.review") : t("admin.verifications.view")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
              </>
            )
          }
        </Loaded>
      </div>
    </>
  );
}

function Review({ card, onBack, onDecided }: { card: IdCardReview; onBack: () => void; onDecided: (message: string) => void }) {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<{ url: string; mimeType: string | null } | null>(null);
  const [fileError, setFileError] = useState(false);
  const [sheet, setSheet] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");

  // A fresh 5-minute link each time the card is opened.
  const loadFile = async () => {
    setFileError(false);
    try {
      const link = await adminApi.idCardFile(card.id);
      setFile({ url: privateFileUrl(link.url), mimeType: link.mimeType });
    } catch {
      setFileError(true);
    }
  };

  useEffect(() => {
    void loadFile();
  }, [card.id]);

  const user = card.user;
  return (
    <>
      <PageHeader title={t("admin.verifications.reviewTitle")} />
      <div className={styles.stack}>
        <button type="button" className={buttonStyles.secondary} onClick={onBack}>
          {t("admin.back")}
        </button>
        <dl className={styles.keyValues}>
          <dt>{t("admin.users.name")}</dt>
          <dd>{user.name ?? "—"}</dd>
          <dt>{t("admin.users.email")}</dt>
          <dd>{user.email}</dd>
          <dt>{t("admin.users.phone")}</dt>
          <dd>{user.phone}</dd>
          <dt>{t("admin.users.university")}</dt>
          <dd>{user.university.name}</dd>
          <dt>{t("admin.users.studentId")}</dt>
          <dd>{user.studentIdNumber ?? "—"}</dd>
          <dt>{t("admin.verifications.submitted")}</dt>
          <dd>{formatDateTime(card.submittedAt, i18n.language)}</dd>
          {card.rejectionReason && (
            <>
              <dt>{t("admin.verifications.reason")}</dt>
              <dd>{card.rejectionReason}</dd>
            </>
          )}
        </dl>

        {fileError && (
          <FormAlert>
            {t("admin.verifications.fileFailed")}{" "}
            <button type="button" className={buttonStyles.secondary} onClick={() => void loadFile()}>
              {t("admin.retry")}
            </button>
          </FormAlert>
        )}
        {file &&
          (file.mimeType === "application/pdf" ? (
            <iframe title={t("admin.verifications.document")} src={file.url} className={styles.pdf} />
          ) : (
            <img src={file.url} alt={t("admin.verifications.document")} className={styles.document} onError={() => setFileError(true)} />
          ))}
        {file && (
          <a href={file.url} target="_blank" rel="noreferrer noopener" className={styles.row}>
            <ExternalLink aria-hidden size={18} />
            {t("admin.verifications.openFile")}
          </a>
        )}
        <p className={styles.muted}>{t("admin.verifications.linkExpires")}</p>

        {card.status === "PENDING" && (
          <div className={styles.row}>
            <button type="button" className={buttonStyles.primary} onClick={() => setSheet("approve")}>
              {t("admin.verifications.approve")}
            </button>
            <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("reject")}>
              {t("admin.verifications.reject")}
            </button>
          </div>
        )}
      </div>

      <ConfirmSheet
        title={t("admin.verifications.approveTitle")}
        open={sheet === "approve"}
        onClose={() => setSheet(null)}
        confirmLabel={t("admin.verifications.approve")}
        onConfirm={async () => {
          await adminApi.approveIdCard(card.id);
          onDecided(t("admin.verifications.approved"));
        }}
      >
        <p>{t("admin.verifications.approveText", { name: user.name ?? user.email })}</p>
      </ConfirmSheet>
      <ConfirmSheet
        title={t("admin.verifications.rejectTitle")}
        open={sheet === "reject"}
        onClose={() => setSheet(null)}
        confirmLabel={t("admin.verifications.reject")}
        onConfirm={async () => {
          await adminApi.rejectIdCard(card.id, reason);
          onDecided(t("admin.verifications.rejected"));
        }}
      >
        <TextAreaField label={t("admin.reason")} value={reason} onChange={setReason} />
        <p className={styles.muted}>{t("admin.verifications.reasonHint")}</p>
      </ConfirmSheet>
    </>
  );
}
