import { ScrollText } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import formStyles from "../../components/form.module.css";
import { EmptyState, PageHeader } from "../../components/ui";
import { adminApi } from "./admin-api";
import { formatDateTime, Loaded, Pager, SelectField, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

const TARGET_TYPES = ["user", "student_verification", "university", "sub_area"];

// A calendar day in Asia/Dhaka (UTC+6) as the start or end instant.
const dhakaDay = (day: string, end: boolean) => (day ? `${day}T${end ? "23:59:59.999" : "00:00:00.000"}+06:00` : undefined);

// The read-only Audit Log (Super Admin, A8 decision 4).
export function AdminAuditLogPage() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const { state, reload } = useLoad(
    () => adminApi.auditLogs({ action, targetType, from: dhakaDay(from, false), to: dhakaDay(to, true), page }),
    [action, targetType, from, to, page],
  );
  const [actions, setActions] = useState<string[]>([]);
  if (state.status === "ready" && state.data.actions.join() !== actions.join()) setActions(state.data.actions);

  const filter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };
  const any = { value: "", label: t("admin.users.any") };
  const actionLabel = (value: string) => t(`admin.audit.actions.${value}`, { defaultValue: value });

  return (
    <>
      <PageHeader title={t("admin.nav.auditLog")} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <SelectField
            label={t("admin.audit.action")}
            value={action}
            onChange={filter(setAction)}
            options={[any, ...actions.map((value) => ({ value, label: actionLabel(value) }))]}
          />
          <SelectField
            label={t("admin.audit.targetType")}
            value={targetType}
            onChange={filter(setTargetType)}
            options={[any, ...TARGET_TYPES.map((value) => ({ value, label: t(`admin.audit.targets.${value}`) }))]}
          />
          <DateField label={t("admin.audit.from")} value={from} onChange={filter(setFrom)} />
          <DateField label={t("admin.audit.to")} value={to} onChange={filter(setTo)} />
        </div>

        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={ScrollText} text={t("admin.audit.empty")} />
            ) : (
              <>
                <ul className={styles.list}>
                  {data.items.map((entry) => (
                    <li key={entry.id} className={styles.item}>
                      <div className={styles.itemHeader}>
                        <span className={styles.itemTitle}>{actionLabel(entry.action)}</span>
                        <span className={styles.muted}>{formatDateTime(entry.createdAt, i18n.language)}</span>
                      </div>
                      <span className={styles.muted}>
                        {t("admin.audit.byOn", {
                          admin: entry.admin?.name ?? entry.admin?.email ?? "—",
                          target: entry.targetUser?.name ?? entry.targetUser?.email ?? `${t(`admin.audit.targets.${entry.targetType}`, { defaultValue: entry.targetType })}`,
                        })}
                      </span>
                      <Values label={t("admin.audit.oldValue")} value={entry.oldValue} />
                      <Values label={t("admin.audit.newValue")} value={entry.newValue} />
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

function Values({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <div>
      <span className={styles.muted}>{label}</span>
      <dl className={styles.keyValues}>
        {Object.entries(value).map(([key, item]) => (
          <div key={key} style={{ display: "contents" }}>
            <dt>{key}</dt>
            <dd>{item === null ? "—" : Array.isArray(item) ? item.join(", ") : String(item)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className={formStyles.field}>
      <label htmlFor={id} className={formStyles.label}>
        {label}
      </label>
      <input id={id} type="date" className={styles.select} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
