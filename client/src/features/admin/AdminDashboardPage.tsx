import { useTranslation } from "react-i18next";
import { PageHeader, Section } from "../../components/ui";
import { adminApi, type Dashboard } from "./admin-api";
import { Loaded, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

const COUNTERS: (keyof Omit<Dashboard, "newRequestsToday">)[] = [
  "totalUsers",
  "activeUsers",
  "verifiedStudents",
  "verifiedRiders",
  "pendingStudentVerifications",
  "pendingRiderApplications",
  "openDisputes",
  "openReports",
  "openNoShowReports",
];

// Proposal section 17: counters. Features not built yet count 0.
export function AdminDashboardPage() {
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(adminApi.dashboard, []);
  const number = new Intl.NumberFormat(i18n.language === "bn" ? "bn-BD" : "en");

  return (
    <>
      <PageHeader title={t("admin.nav.dashboard")} />
      <Loaded state={state} reload={reload}>
        {(data) => (
          <div className={styles.stack}>
            <div className={styles.counters}>
              {COUNTERS.map((key) => (
                <div key={key} className={styles.counter}>
                  <span className={styles.counterValue}>{number.format(data[key])}</span>
                  <span className={styles.muted}>{t(`admin.dashboard.${key}`)}</span>
                </div>
              ))}
            </div>
            <Section title={t("admin.dashboard.newRequestsToday")}>
              <div className={styles.counters}>
                {(["ride", "carpool", "food", "service"] as const).map((feature) => (
                  <div key={feature} className={styles.counter}>
                    <span className={styles.counterValue}>{number.format(data.newRequestsToday[feature])}</span>
                    <span className={styles.muted}>{t(`features.${feature}.name`)}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </Loaded>
    </>
  );
}
