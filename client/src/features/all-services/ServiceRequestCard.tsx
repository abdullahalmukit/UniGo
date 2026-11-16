import { Briefcase, Calendar, Car, CircleDot, Clock, MapPin, Package, ShoppingBag, Users, UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { formatRideTime } from "../../lib/dates";
import { PersonRow, taka } from "../ride/RideCard";
import type { ServiceRequestCardItem } from "./all-services-api";
import styles from "./AllServicesPage.module.css";

export function ServiceRequestCard({ item }: { item: ServiceRequestCardItem }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  // Feature metadata
  const featureMeta = {
    ride: {
      icon: Car,
      label: t("activity.filters.ride"),
      className: styles.badgeRide,
      role: t("ride.role.rider", { defaultValue: "Passenger" }),
    },
    food: {
      icon: UtensilsCrossed,
      label: t("activity.filters.food"),
      className: styles.badgeFood,
      role: t("food.role.customer", { defaultValue: "Requester" }),
    },
    carpool: {
      icon: Users,
      label: t("activity.filters.carpool"),
      className: styles.badgeCarpool,
      role: t("carpool.role.driver", { defaultValue: "Driver" }),
    },
    service: {
      icon: Briefcase,
      label: t("activity.filters.service"),
      className: styles.badgeService,
      role: t("service.role.requester", { defaultValue: "Requester" }),
    },
  }[item.feature];

  let Icon = featureMeta.icon;
  let label = featureMeta.label;

  if (item.feature === "service") {
    if (item.details.categoryName) {
      label = item.details.categoryName;
    } else if (item.details.categoryCode) {
      label = t(`service.categories.${item.details.categoryCode}`, { defaultValue: item.details.categoryCode });
    }

    if (item.details.categoryCode === "PHARMACY_HEALTHCARE") {
      Icon = ShoppingBag;
    } else if (item.details.categoryCode === "PARCEL_DELIVERY") {
      Icon = Package;
    }
  }

  const renderAmount = () => {
    const hasBudget = item.feature === "service" && Boolean(item.details.estimatedBudget && item.details.estimatedBudget > 0);
    const offered = item.details.offeredAmount ?? item.amount;

    return (
      <div className={styles.amount}>
        <span className={styles.amountMain}>
          {hasBudget ? `৳${taka(offered, lang)}` : `৳ ${taka(item.amount, lang)}`}
          {item.feature === "carpool" && " / mo"}
        </span>
        {hasBudget && (
          <span className={styles.budgetNote}>
            (+৳{taka(item.details.estimatedBudget!, lang)} {t("service.budget", { defaultValue: "budget" })})
          </span>
        )}
      </div>
    );
  };

  const description =
    item.details.notes ||
    (item.details.items ? `Items: ${item.details.items}` : null) ||
    (item.details.passengerCount ? `${item.details.passengerCount} passenger${item.details.passengerCount > 1 ? "s" : ""}` : null) ||
    (item.details.availableSeats ? `${item.details.availableSeats} seat${item.details.availableSeats > 1 ? "s" : ""} available` : null);

  const pickupAddressText = item.details.restaurantName
    ? `${item.details.restaurantName} (${item.pickup.address.split(",")[0].trim()})`
    : item.pickup?.address;

  const showPickup = Boolean(item.pickup?.address && item.pickup.address !== item.destination?.address);

  return (
    <article className={styles.requestCard}>
      <Link to={item.link} className={styles.cardLink}>
        <div className={styles.cardTop}>
          <span className={`${styles.kind} ${featureMeta.className}`}>
            <Icon aria-hidden size={14} />
            <span>{label}</span>
          </span>
          {renderAmount()}
        </div>

        <h3 className={styles.cardTitle}>
          {item.title}
        </h3>

        {description && (
          <p className={styles.cardDescription}>
            {description}
          </p>
        )}

        <div className={styles.route}>
          {showPickup && (
            <span className={styles.routeLine}>
              <CircleDot aria-hidden size={16} className={`${styles.routeIcon} ${styles.pickupIcon}`} />
              <span>{pickupAddressText}</span>
            </span>
          )}
          {item.destination?.address && (
            <span className={styles.routeLine}>
              <MapPin aria-hidden size={16} className={`${styles.routeIcon} ${styles.destIcon}`} />
              <span>{item.destination.address}</span>
            </span>
          )}
        </div>

        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <Clock aria-hidden size={13} />
            <span>{formatRideTime(item.time, lang)}</span>
          </span>
          {item.subArea && <span>{item.subArea.name}</span>}
          {item.mine && <span className={styles.yoursBadge}>{t("ride.yours")}</span>}
        </div>
      </Link>

      <div className={styles.cardFooter}>
        <PersonRow person={item.creator} caption={featureMeta.role} />
      </div>
    </article>
  );
}
