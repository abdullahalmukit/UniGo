import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ContactRow } from "../../components/ContactRow";
import { StatusChip, ToneChip, type ActivityStatus } from "../../components/StatusChip";
import { buttonStyles } from "../../components/ui";
import { formatRideTime } from "../../lib/dates";
import { FoodActions, FoodAmount } from "../food/food-shared";
import { RideActions } from "../ride/RideActions";
import { PersonRow, Route, taka } from "../ride/RideCard";
import { itemPath, type FeedItem } from "./feed-api";
import styles from "./feed.module.css";

const TERMINAL = ["COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];
const RUNNING = ["ACCEPTED", "IN_PROGRESS", "DISPUTED"];

export function ItemStatus({ item }: { item: FeedItem }) {
  const { t } = useTranslation();
  if (item.kind !== "RIDE_OFFER") return <StatusChip status={item.status as ActivityStatus} />;
  // A ride offer has its own post status (CLAUDE.md 5.1)
  const tone = item.status === "OPEN" ? "amber" : item.status === "FULL" ? "indigo" : "grey";
  return <ToneChip tone={tone} label={t(`ride.postStatus.${item.status}`)} />;
}

function kindLabel(item: FeedItem, t: (key: string) => string) {
  if (item.kind === "FOOD") return item.food?.restaurantName ?? t("food.detailTitle");
  if (item.kind === "RIDE_OFFER") return t("ride.kind.offer");
  if (item.kind === "RIDE_BOOKING") return t("activity.kind.booking");
  return t("ride.kind.request");
}

// One item in Activity (with the actions of proposal 12.2) or in Upcoming.
export function FeedCard({
  item,
  mode,
  countdown,
  onChanged,
}: {
  item: FeedItem;
  mode: "activity" | "upcoming";
  countdown?: string | null;
  onChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const isOffer = item.kind === "RIDE_OFFER";
  const isFood = item.kind === "FOOD";
  const amount = isOffer ? t("ride.perSeat", { amount: taka(item.amount, i18n.language) }) : t("ride.total", { amount: taka(item.amount, i18n.language) });

  return (
    <article className={styles.card}>
      <Link to={itemPath(item)} className={styles.cardLink}>
        <span className={styles.top}>
          <span className={styles.kind}>
            {t(isFood ? "activity.filters.food" : "activity.filters.ride")} · {kindLabel(item, t)}
          </span>
          <ItemStatus item={item} />
        </span>
        <span className={styles.when}>
          {formatRideTime(item.time, i18n.language)}
          {countdown && <span className={styles.countdown}>{countdown}</span>}
        </span>
        <Route pickup={item.pickup} destination={item.destination} />
        <span className={styles.meta}>
          {isFood && item.food ? <FoodAmount foodPrice={item.food.foodPrice} deliveryCharge={item.food.deliveryCharge} /> : <span className={styles.amount}>{amount}</span>}
          {isFood && item.food && <span>{t("food.itemsLine", { items: item.food.items, count: item.food.quantity })}</span>}
          {item.kind === "RIDE_REQUEST" && item.seats !== null && <span>{t("ride.passengers", { count: item.seats })}</span>}
          {item.kind === "RIDE_BOOKING" && item.seats !== null && <span>{t("ride.seatsCount", { count: item.seats })}</span>}
          {isOffer && <span>{t("activity.passengersBooked", { count: item.activeBookings })}</span>}
          <span>{item.role === "REQUESTED" ? t("activity.roles.requested") : t("activity.roles.accepted")}</span>
        </span>
      </Link>

      {item.otherPerson && (
        <PersonRow
          person={item.otherPerson}
          caption={
            isFood
              ? t(item.role === "REQUESTED" ? "food.role.accepter" : "food.role.requester")
              : item.kind === "RIDE_BOOKING" || item.role === "REQUESTED"
                ? t("ride.role.rider")
                : t("ride.role.passenger")
          }
        />
      )}
      <ContactRow phone={item.phone} name={item.otherPerson?.name} />
      {item.payment && (
        <span className={styles.meta}>
          <ToneChip tone={item.payment.status === "PAID" ? "green" : "amber"} label={t(`payment.status.${item.payment.status}`)} />
          <span>{item.payment.method ? t(`payment.methods.${item.payment.method}`) : t("payment.noMethod")}</span>
        </span>
      )}

      {isOffer && mode === "activity" && item.bookings.length > 0 && (
        <ul className={styles.bookings} aria-label={t("ride.bookings.title", { count: item.bookings.length })}>
          {item.bookings.map((booking) => (
            <li key={booking.activityId} className={styles.booking}>
              <div className={styles.bookingTop}>
                {booking.passenger && <PersonRow person={booking.passenger} caption={t("ride.seatsCount", { count: booking.seatsBooked })} />}
                <StatusChip status={booking.status} />
              </div>
              <ContactRow phone={booking.phone} name={booking.passenger?.name} />
              <Link to={`/ride/bookings/${booking.activityId}`} className={styles.textLink}>
                {t("ride.bookings.openOne")}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {mode === "activity" && <Actions item={item} onChanged={onChanged ?? (() => undefined)} />}
    </article>
  );
}

// What the user can do, by status (proposal 12.2).
function Actions({ item, onChanged }: { item: FeedItem; onChanged: () => void }) {
  const { t } = useTranslation();
  const open = <Link to={itemPath(item)} className={buttonStyles.secondary}>{t("activity.actions.details")}</Link>;

  if (item.kind === "RIDE_OFFER") {
    const stillRunning = item.bookings.some((b) => RUNNING.includes(b.status));
    return (
      <div className={styles.actions}>
        {item.status !== "CLOSED" && (
          <Link to={`/ride/offers/${item.id}/edit`} className={buttonStyles.secondary}>
            {item.activeBookings > 0 ? t("ride.actions.addSeats") : t("ride.actions.edit")}
          </Link>
        )}
        {open}
        {item.status === "CLOSED" && !stillRunning && (
          <Link to={`/ride/offers/new?from=${item.id}`} className={buttonStyles.secondary}>
            {t("activity.actions.createAgain")}
          </Link>
        )}
      </div>
    );
  }

  if (item.status === "OPEN") {
    // Edit, raise the amount or delete: on the request page
    return (
      <div className={styles.actions}>
        {item.role === "REQUESTED" && (
          <Link to={`${itemPath(item)}/edit`} className={buttonStyles.secondary}>
            {t("ride.actions.edit")}
          </Link>
        )}
        {open}
      </div>
    );
  }

  if (item.status === "DISPUTED") {
    return (
      <div className={styles.actions}>
        <p className={styles.note}>{t("activity.disputeLater")}</p>
        {open}
      </div>
    );
  }

  if (TERMINAL.includes(item.status)) {
    return (
      <div className={styles.actions}>
        {item.review === "CAN_REVIEW" && (
          <Link to={`${itemPath(item)}#review`} className={buttonStyles.primary}>
            {t("review.leave")}
          </Link>
        )}
        {item.review === "REVIEWED" && <p className={styles.note}>{t("review.done")}</p>}
        {open}
        {(item.kind === "RIDE_REQUEST" || item.kind === "FOOD") && item.role === "REQUESTED" && (
          <Link to={`/${item.kind === "FOOD" ? "food" : "ride"}/requests/new?from=${item.id}`} className={buttonStyles.secondary}>
            {t("activity.actions.createAgain")}
          </Link>
        )}
      </div>
    );
  }

  // Food: the order, approval and receipt steps are on the request page
  if (item.kind === "FOOD") {
    return (
      <div className={styles.actions}>
        <FoodActions
          activityId={item.id}
          status={item.status as ActivityStatus}
          subStatus={item.subStatus}
          role={item.role === "REQUESTED" ? "REQUESTER" : "ACCEPTER"}
          completionRequestedBy={item.completionRequestedBy}
          chatId={item.chatId}
          onChanged={onChanged}
          sticky={false}
        />
        {open}
      </div>
    );
  }

  // ACCEPTED and IN_PROGRESS: start, mark completed, confirm, chat, cancel
  return (
    <div className={styles.actions}>
      <RideActions
        activityId={item.id}
        status={item.status as ActivityStatus}
        subStatus={item.subStatus}
        completionRequestedBy={item.completionRequestedBy}
        chatId={item.chatId}
        onChanged={onChanged}
        sticky={false}
      />
      {open}
    </div>
  );
}
