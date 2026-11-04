import { ListChecks } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { STATUS_TONE, StatusChip, type ActivityStatus } from "../../components/StatusChip";
import { EmptyState, PageHeader, Section } from "../../components/ui";
import styles from "./ActivityPage.module.css";

const filters = ["all", "ride", "carpool", "food", "service"] as const;

// Placeholder until B3. The status key shows every chip colour in use.
export function ActivityPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");

  return (
    <>
      <PageHeader title={t("activity.title")} />
      <div className={styles.filters} role="group" aria-label={t("activity.title")}>
        {filters.map((key) => (
          <button
            key={key}
            type="button"
            className={styles.filter}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {t(`activity.filters.${key}`)}
          </button>
        ))}
      </div>
      <EmptyState icon={ListChecks} text={t("activity.empty")} />

      <Section title={t("activity.statusKey")}>
        <div className={styles.statusKey}>
          {(Object.keys(STATUS_TONE) as ActivityStatus[]).map((status) => (
            <StatusChip key={status} status={status} />
          ))}
        </div>
      </Section>
    </>
  );
}
