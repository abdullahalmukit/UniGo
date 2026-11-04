import { GraduationCap, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert, TextField } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader, Section } from "../../components/ui";
import { adminApi, type AdminUniversity } from "./admin-api";
import { adminError, ConfirmSheet, Loaded, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

// Universities and their allowed email domains (Super Admin, A6 API). Matching
// is exact, so each subdomain is added on its own (A6 decision 1).
export function AdminUniversitiesPage() {
  const { t } = useTranslation();
  const { state, reload } = useLoad(adminApi.universities, []);
  const [error, setError] = useState<string | null>(null);

  // Runs a change, shows its error (if any) and reloads the list.
  const run = async (change: () => Promise<unknown>) => {
    setError(null);
    try {
      await change();
      await reload();
      return true;
    } catch (failure) {
      setError(adminError(failure, t));
      return false;
    }
  };

  return (
    <>
      <PageHeader title={t("admin.nav.universities")} />
      <div className={styles.stack}>
        <CreateUniversity run={run} />
        {error && <FormAlert>{error}</FormAlert>}
        <Loaded state={state} reload={reload}>
          {({ universities }) =>
            universities.length === 0 ? (
              <EmptyState icon={GraduationCap} text={t("admin.universities.empty")} />
            ) : (
              <ul className={styles.list}>
                {universities.map((university) => (
                  <UniversityItem key={university.id} university={university} run={run} />
                ))}
              </ul>
            )
          }
        </Loaded>
      </div>
    </>
  );
}

type Run = (change: () => Promise<unknown>) => Promise<boolean>;

function CreateUniversity({ run }: { run: Run }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [domains, setDomains] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const list = domains.split(/[\s,]+/).filter(Boolean);
    const ok = await run(() => adminApi.createUniversity({ name, shortName: shortName || undefined, domains: list }));
    if (ok) {
      setName("");
      setShortName("");
      setDomains("");
    }
  };

  return (
    <Section title={t("admin.universities.add")}>
      <form className={styles.stack} onSubmit={submit} noValidate>
        <TextField label={t("admin.universities.name")} value={name} onChange={setName} />
        <TextField label={t("admin.universities.shortName")} value={shortName} onChange={setShortName} />
        <TextField label={t("admin.universities.domains")} value={domains} onChange={setDomains} hint={t("admin.universities.domainsHint")} />
        <div className={styles.row}>
          <button type="submit" className={buttonStyles.primary}>
            {t("admin.universities.add")}
          </button>
        </div>
      </form>
    </Section>
  );
}

function UniversityItem({ university, run }: { university: AdminUniversity; run: Run }) {
  const { t } = useTranslation();
  const [domain, setDomain] = useState("");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(university.name);
  const [shortName, setShortName] = useState(university.shortName ?? "");
  const [deleting, setDeleting] = useState(false);

  const addDomain = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => adminApi.addDomain(university.id, domain))) setDomain("");
  };

  return (
    <li className={styles.item}>
      <div className={styles.itemHeader}>
        <span className={styles.itemTitle}>
          {university.name}
          {university.shortName ? ` (${university.shortName})` : ""}
        </span>
        <span className={styles.muted}>
          {t("admin.universities.users", { count: university.userCount })} ·{" "}
          {university.isActive ? t("admin.active") : t("admin.inactive")}
        </span>
      </div>

      <div className={styles.row} aria-label={t("admin.universities.domains")}>
        {university.domains.length === 0 && <span className={styles.muted}>{t("admin.universities.noDomains")}</span>}
        {university.domains.map((item) => (
          <span key={item.id} className={styles.chip}>
            {item.domain}
            <button
              type="button"
              className={styles.chipButton}
              aria-label={t("admin.universities.removeDomain", { domain: item.domain })}
              onClick={() => void run(() => adminApi.removeDomain(university.id, item.id))}
            >
              <X aria-hidden size={14} />
            </button>
          </span>
        ))}
      </div>

      <form className={styles.row} onSubmit={addDomain} noValidate>
        <TextField label={t("admin.universities.newDomain")} value={domain} onChange={setDomain} placeholder="student.example.edu.bd" />
        <button type="submit" className={buttonStyles.secondary}>
          {t("admin.universities.addDomain")}
        </button>
      </form>

      <div className={styles.row}>
        <button type="button" className={buttonStyles.secondary} onClick={() => setEditing(true)}>
          {t("admin.edit")}
        </button>
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={() => void run(() => adminApi.updateUniversity(university.id, { isActive: !university.isActive }))}
        >
          {university.isActive ? t("admin.deactivate") : t("admin.activate")}
        </button>
        {university.userCount === 0 && (
          <button type="button" className={`${buttonStyles.secondary} ${styles.danger}`} onClick={() => setDeleting(true)}>
            {t("admin.delete")}
          </button>
        )}
      </div>

      <ConfirmSheet
        title={t("admin.universities.editTitle")}
        open={editing}
        onClose={() => setEditing(false)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          await adminApi.updateUniversity(university.id, { name, shortName: shortName || null });
          await run(async () => {});
        }}
      >
        <TextField label={t("admin.universities.name")} value={name} onChange={setName} />
        <TextField label={t("admin.universities.shortName")} value={shortName} onChange={setShortName} />
      </ConfirmSheet>
      <ConfirmSheet
        title={t("admin.universities.deleteTitle")}
        open={deleting}
        onClose={() => setDeleting(false)}
        confirmLabel={t("admin.delete")}
        onConfirm={async () => {
          await adminApi.deleteUniversity(university.id);
          await run(async () => {});
        }}
      >
        <p>{t("admin.universities.deleteText", { name: university.name })}</p>
      </ConfirmSheet>
    </li>
  );
}
