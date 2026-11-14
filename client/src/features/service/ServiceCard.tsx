import { AlertTriangle, Briefcase, Calendar, Clock, MapPin, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, PageHeader } from "../../components/ui";
import { formatRideTime } from "../../lib/dates";
import { useMe } from "../account/account-api";
import { PersonRow, Route, taka } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import type { ServiceCardItem, ServiceCategoryCode } from "./service-api";

export function ServiceGate() {
  const { t } = useTranslation();
  const me = useMe();
  if (me && me.studentVerificationStatus !== "VERIFIED") {
    return (
      <div className={styles.narrow}>
        <PageHeader title={t("service.title")} />
        <FormAlert tone="info">{t("service.verifyFirst")}</FormAlert>
        <Link to="/verify-student" className={buttonStyles.primary}>
          {t("account.verifyNow")}
        </Link>
      </div>
    );
  }
  return <Outlet />;
}

export function categoryLabel(code: ServiceCategoryCode | string, t: (key: string, opts?: { defaultValue?: string }) => string, name?: string) {
  if (name) return name;
  return t(`service.categories.${code}`, { defaultValue: code });
}

export function categorySafetyWarning(code: ServiceCategoryCode | string, t: (key: string) => string) {
  if (code === "PHARMACY_HEALTHCARE") {
    return {
      title: t("service.safety.pharmacyTitle"),
      message: t("service.safety.pharmacyWarning"),
      icon: AlertTriangle,
    };
  }
  if (code === "FINANCIAL_ADMINISTRATIVE") {
    return {
      title: t("service.safety.financialTitle"),
      message: t("service.safety.financialWarning"),
      icon: ShieldAlert,
    };
  }
  return null;
}

export function ServiceAmount({ offered, budget }: { offered: number; budget: number | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (
    <span className={styles.amount}>
      {budget && budget > 0
        ? t("service.amountWithBudget", { offered: taka(offered, lang), budget: taka(budget, lang) })
        : t("service.amount", { offered: taka(offered, lang) })}
    </span>
  );
}

export function ServiceCard({ item }: { item: ServiceCardItem }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const timeDisplay = item.hasPreferredTime
    ? formatRideTime(item.startTime, lang)
    : item.preferredDate;

  return (
    <div className={styles.card}>
      <Link to={`/service/requests/${item.id}`} className={styles.cardLink}>
        <span className={styles.cardTop}>
          <span className={styles.kind}>
            <Briefcase aria-hidden size={14} /> {categoryLabel(item.category.code, t)}
          </span>
          <ServiceAmount offered={item.offeredAmount} budget={item.estimatedBudget} />
        </span>

        <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "4px 0 2px" }}>
          {item.serviceTitle}: {item.taskTitle}
        </h3>

        {item.description && (
          <p className={styles.muted} style={{ margin: "2px 0 6px", fontSize: "0.875rem", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {item.description}
          </p>
        )}

        {item.pickup ? (
          <Route pickup={item.pickup} destination={item.destination} />
        ) : (
          <div className={styles.meta} style={{ marginTop: "4px" }}>
            <MapPin aria-hidden size={14} />
            <span>{item.destination.address}</span>
          </div>
        )}

        <span className={styles.meta}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {item.hasPreferredTime ? <Clock aria-hidden size={13} /> : <Calendar aria-hidden size={13} />}
            {timeDisplay}
          </span>
          {item.subArea && <span>{item.subArea.name}</span>}
          {item.mine && <span>{t("ride.yours")}</span>}
        </span>
      </Link>
      <PersonRow person={item.requester} caption={t("service.role.requester")} />
    </div>
  );
}

