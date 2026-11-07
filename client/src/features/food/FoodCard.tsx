import { Store, UtensilsCrossed } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, PageHeader } from "../../components/ui";
import { formatRideTime } from "../../lib/dates";
import { useMe } from "../account/account-api";
import { PersonRow, Route } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import type { FoodCardItem } from "./food-api";
import { FoodAmount } from "./food-shared";

// Food Delivery is for verified students (CLAUDE.md section 4); others are
// asked to verify first. The server checks it on every call.
export function FoodGate() {
  const { t } = useTranslation();
  const me = useMe();
  if (me && me.studentVerificationStatus !== "VERIFIED") {
    return (
      <div className={styles.narrow}>
        <PageHeader title={t("food.title")} />
        <FormAlert tone="info">{t("food.verifyFirst")}</FormAlert>
        <Link to="/verify-student" className={buttonStyles.primary}>
          {t("account.verifyNow")}
        </Link>
      </div>
    );
  }
  return <Outlet />;
}

// A request on All Available and Search (10.1). The card links to the
// request; the person row links to the profile (two separate links).
export function FoodCard({ item }: { item: FoodCardItem }) {
  const { t, i18n } = useTranslation();
  return (
    <div className={styles.card}>
      <Link to={`/food/requests/${item.id}`} className={styles.cardLink}>
        <span className={styles.cardTop}>
          <span className={styles.kind}>
            <Store aria-hidden size={14} /> {item.restaurantName}
          </span>
          <FoodAmount foodPrice={item.estimatedBudget} deliveryCharge={item.deliveryCharge} />
        </span>
        <span className={styles.meta}>
          <UtensilsCrossed aria-hidden size={14} />
          <span>{t("food.itemsLine", { items: item.items, count: item.quantity })}</span>
        </span>
        <Route pickup={item.pickup} destination={item.delivery} />
        <span className={styles.meta}>
          <span>{t("food.deliverBy", { time: formatRideTime(item.expectedDeliveryTime, i18n.language) })}</span>
          <span>{item.subArea.name}</span>
          {item.mine && <span>{t("ride.yours")}</span>}
        </span>
      </Link>
      <PersonRow person={item.requester} caption={t("food.role.requester")} />
    </div>
  );
}
