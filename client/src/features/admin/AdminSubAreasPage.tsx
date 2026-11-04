import { MapPin } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert, TextField } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader, Section } from "../../components/ui";
import { adminApi, type AdminSubArea } from "./admin-api";
import { adminError, ConfirmSheet, Loaded, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

// The Sub-Areas master list (Super Admin, A8 decisions 4 and 6).
export function AdminSubAreasPage() {
  const { t } = useTranslation();
  const { state, reload } = useLoad(adminApi.subAreas, []);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (change: () => Promise<unknown>, message?: string) => {
    setError(null);
    setNotice(null);
    try {
      await change();
      await reload();
      if (message) setNotice(message);
      return true;
    } catch (failure) {
      setError(adminError(failure, t));
      return false;
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => adminApi.createSubArea(name))) setName("");
  };

  return (
    <>
      <PageHeader title={t("admin.nav.subAreas")} />
      <div className={styles.stack}>
        <Section title={t("admin.subAreas.add")}>
          <form className={styles.row} onSubmit={add} noValidate>
            <TextField label={t("admin.subAreas.name")} value={name} onChange={setName} />
            <button type="submit" className={buttonStyles.primary}>
              {t("admin.subAreas.add")}
            </button>
          </form>
        </Section>
        {error && <FormAlert>{error}</FormAlert>}
        {notice && <FormAlert tone="success">{notice}</FormAlert>}
        <Loaded state={state} reload={reload}>
          {({ subAreas }) =>
            subAreas.length === 0 ? (
              <EmptyState icon={MapPin} text={t("admin.subAreas.empty")} />
            ) : (
              <ul className={styles.list}>
                {subAreas.map((subArea) => (
                  <SubAreaItem key={subArea.id} subArea={subArea} run={run} />
                ))}
              </ul>
            )
          }
        </Loaded>
      </div>
    </>
  );
}

function SubAreaItem({
  subArea,
  run,
}: {
  subArea: AdminSubArea;
  run: (change: () => Promise<unknown>, message?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState(subArea.name);

  return (
    <li className={styles.item}>
      <div className={styles.itemHeader}>
        <span className={styles.itemTitle}>{subArea.name}</span>
        <span className={styles.muted}>
          {t("admin.subAreas.usage", { users: subArea.userCount, activities: subArea.activityCount })} ·{" "}
          {subArea.isActive ? t("admin.active") : t("admin.inactive")}
        </span>
      </div>
      <div className={styles.row}>
        <button type="button" className={buttonStyles.secondary} onClick={() => setRenaming(true)}>
          {t("admin.subAreas.rename")}
        </button>
        <button
          type="button"
          className={buttonStyles.secondary}
          onClick={() => void run(() => adminApi.updateSubArea(subArea.id, { isActive: !subArea.isActive }))}
        >
          {subArea.isActive ? t("admin.deactivate") : t("admin.activate")}
        </button>
        <button type="button" className={`${buttonStyles.secondary} ${styles.danger}`} onClick={() => setRemoving(true)}>
          {t("admin.subAreas.remove")}
        </button>
      </div>

      <ConfirmSheet
        title={t("admin.subAreas.rename")}
        open={renaming}
        onClose={() => setRenaming(false)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          await adminApi.updateSubArea(subArea.id, { name });
          await run(async () => {});
        }}
      >
        <TextField label={t("admin.subAreas.name")} value={name} onChange={setName} />
      </ConfirmSheet>
      <ConfirmSheet
        title={t("admin.subAreas.removeTitle")}
        open={removing}
        onClose={() => setRemoving(false)}
        confirmLabel={t("admin.subAreas.remove")}
        onConfirm={async () => {
          const result = await adminApi.removeSubArea(subArea.id);
          await run(async () => {}, result.deleted ? t("admin.subAreas.deleted") : t("admin.subAreas.deactivated"));
        }}
      >
        <p>{t("admin.subAreas.removeText", { name: subArea.name })}</p>
      </ConfirmSheet>
    </li>
  );
}
