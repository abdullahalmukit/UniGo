import { useTranslation } from "react-i18next";
import { PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
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
            <MatchingMetrics />
          </div>
        )}
      </Loaded>
    </>
  );
}

// B9 (proposal 20 evaluation): how often suggested matches are taken.
type Metrics = {
  days: number;
  shown: number;
  taken: number;
  acceptanceRate: number | null;
  precisionAt1: number | null;
  precisionAt3: number | null;
  precisionAt5: number | null;
};

function MatchingMetrics() {
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => api<Metrics>("/admin/matching/metrics?days=30"), []);
  const number = new Intl.NumberFormat(i18n.language === "bn" ? "bn-BD" : "en");
  const percent = (value: number | null) => (value === null ? "—" : `${number.format(Math.round(value * 100))}%`);
  return (
    <Section title={t("admin.matching.title")}>
      <Loaded state={state} reload={reload}>
        {(data) => (
          <div className={styles.counters}>
            {(
              [
                ["shown", number.format(data.shown)],
                ["taken", number.format(data.taken)],
                ["acceptanceRate", percent(data.acceptanceRate)],
                ["precisionAt1", percent(data.precisionAt1)],
                ["precisionAt3", percent(data.precisionAt3)],
                ["precisionAt5", percent(data.precisionAt5)],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className={styles.counter}>
                <span className={styles.counterValue}>{value}</span>
                <span className={styles.muted}>{t(`admin.matching.${key}`)}</span>
              </div>
            ))}
          </div>
        )}
      </Loaded>
    </Section>
  );
}

