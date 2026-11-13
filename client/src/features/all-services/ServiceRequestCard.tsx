import { Car, CircleDot, Clock, MapPin, Users, UtensilsCrossed, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Avatar } from "../../components/Avatar";
import { formatRideTime } from "../../lib/dates";
import type { ServiceRequestCardItem } from "./all-services-api";
import styles from "./AllServicesPage.module.css";

function taka(amount: number, language: string) {
  return new Intl.NumberFormat(language === "bn" ? "bn-BD" : "en", { maximumFractionDigits: 2 }).format(amount);
}

export function ServiceRequestCard({ item }: { item: ServiceRequestCardItem }) {
  const { t, i18n } = useTranslation();

  const featureMeta = {
    ride: {
      icon: Car,
      label: t("activity.filters.ride"),
      className: styles.badgeRide,
    },
    food: {
      icon: UtensilsCrossed,
      label: t("activity.filters.food"),
      className: styles.badgeFood,
    },
    carpool: {
      icon: Users,
      label: t("activity.filters.carpool"),
      className: styles.badgeCarpool,
    },
    service: {
      icon: Wrench,
      label: t("activity.filters.service"),
      className: styles.badgeService,
    },
  }[item.feature];

  const Icon = featureMeta.icon;
  const university = item.creator.university?.shortName ?? item.creator.university?.name;

  return (
    <article className={styles.requestCard}>
      <div className={styles.cardHeader}>
        <span className={`${styles.featureBadge} ${featureMeta.className}`}>
          <Icon aria-hidden size={14} />
          <span>{featureMeta.label}</span>
        </span>
        <span className={styles.timeTag}>
          <Clock aria-hidden size={13} />
          <span>{formatRideTime(item.time, i18n.language)}</span>
        </span>
      </div>

      <div className={styles.routeContainer}>
        <div className={styles.routeRow}>
          <CircleDot aria-hidden size={15} className={styles.pickupDot} />
          <span className={styles.addressText} title={item.pickup.address}>
            {item.details.restaurantName ? `${item.details.restaurantName} (${item.pickup.address.split(",")[0].trim()})` : item.pickup.address}
          </span>
        </div>
        <div className={styles.routeRow}>
          <MapPin aria-hidden size={15} className={styles.destDot} />
          <span className={styles.addressText} title={item.destination.address}>
            {item.destination.address}
          </span>
        </div>
      </div>

      {item.details.items && (
        <p className={styles.itemPreview}>
          <strong>Items:</strong> {item.details.items}
        </p>
      )}

      {item.details.notes && !item.details.items && (
        <p className={styles.itemPreview}>
          {item.details.notes}
        </p>
      )}

      <div className={styles.cardFooter}>
        <div className={styles.creatorInfo}>
          <Avatar name={item.creator.name} src={item.creator.photo?.url} size={32} />
          <div className={styles.creatorDetails}>
            <span className={styles.creatorName}>{item.creator.name}</span>
            {university && <span className={styles.creatorUniv}>{university}</span>}
          </div>
        </div>

        <div className={styles.amountBox}>
          <span className={styles.amountValue}>৳ {taka(item.amount, i18n.language)}</span>
          <span className={styles.amountLabel}>{item.amountLabel}</span>
        </div>
      </div>

      <div className={styles.cardAction}>
        <Link to={item.link} className={styles.actionBtn}>
          {t("services.viewDetails")}
        </Link>
      </div>
    </article>
  );
}

