import { Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { TextField } from "../../components/form";
import { EmptyState, PageHeader } from "../../components/ui";
import { VerificationChip } from "../../components/VerificationChip";
import { adminApi } from "./admin-api";
import { AccountStatusChip, Loaded, Pager, SelectField, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

// User Account Management: list and search (proposal section 17.1).
export function AdminUsersPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [verification, setVerification] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);

  // Searches a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const { state, reload } = useLoad(
    () => adminApi.users({ q: search, accountStatus, verification, role, page }),
    [search, accountStatus, verification, role, page],
  );

  const any = { value: "", label: t("admin.users.any") };
  const choose = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t("admin.nav.users")} />
      <div className={styles.stack}>
        <div className={styles.filters}>
          <TextField label={t("admin.users.search")} type="search" value={q} onChange={setQ} hint={t("admin.users.searchHint")} />
          <SelectField
            label={t("admin.users.accountStatus")}
            value={accountStatus}
            onChange={choose(setAccountStatus)}
            options={[any, ...(["ACTIVE", "RESTRICTED", "SUSPENDED", "BANNED"] as const).map((value) => ({ value, label: t(`admin.accountStatus.${value}`) }))]}
          />
          <SelectField
            label={t("admin.users.verification")}
            value={verification}
            onChange={choose(setVerification)}
            options={[any, ...(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"] as const).map((value) => ({ value, label: t(`verification.status.${value}`) }))]}
          />
          <SelectField
            label={t("admin.users.role")}
            value={role}
            onChange={choose(setRole)}
            options={[any, ...(["USER", "MODERATOR", "SUPER_ADMIN"] as const).map((value) => ({ value, label: t(`admin.roles.${value}`) }))]}
          />
        </div>

        <Loaded state={state} reload={reload}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={Users} text={t("admin.users.empty")} />
            ) : (
              <>
                <p className={styles.muted}>{t("admin.users.count", { count: data.total })}</p>
                <ul className={styles.list}>
                  {data.items.map((user) => (
                    <li key={user.id}>
                      <Link to={`/admin/users/${user.id}`} className={styles.itemLink}>
                        <div className={styles.itemHeader}>
                          <span className={styles.itemTitle}>{user.name ?? user.email}</span>
                          <span className={styles.row}>
                            <AccountStatusChip status={user.accountStatus} />
                            <VerificationChip status={user.studentVerificationStatus} />
                          </span>
                        </div>
                        <span className={styles.muted}>
                          {user.email} · {user.phone}
                        </span>
                        <span className={styles.muted}>
                          {user.university.name}
                          {user.role !== "USER" ? ` · ${t(`admin.roles.${user.role}`)}` : ""}
                        </span>
                      </Link>
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
