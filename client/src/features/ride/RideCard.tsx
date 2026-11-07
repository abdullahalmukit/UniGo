import { BadgeCheck, CircleDot, MapPin, Star, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Avatar } from "../../components/Avatar";
import { profilePath } from "../../lib/activity-links";
import { formatRideTime } from "../../lib/dates";
import type { MiniProfile, Place, PublicVehicle, RideItem } from "./ride-api";
import styles from "./ride.module.css";

export function taka(amount: number, language: string) {
  return new Intl.NumberFormat(language === "bn" ? "bn-BD" : "en", { maximumFractionDigits: 2 }).format(amount);
}

export function Route({ pickup, destination }: { pickup: Place; destination: Place }) {
  const { t } = useTranslation();
  return (
    <div className={styles.route}>
      <span className={styles.routeLine}>
        <CircleDot aria-hidden size={16} className={styles.routeIcon} />
        <span>
          <span className="visually-hidden">{t("ride.pickup")}: </span>
          {pickup.address}
        </span>
      </span>
      <span className={styles.routeLine}>
        <MapPin aria-hidden size={16} className={styles.routeIcon} />
        <span>
          <span className="visually-hidden">{t("ride.destination")}: </span>
          {destination.address}
        </span>
      </span>
    </div>
  );
}

// Mini profile (proposal 8.3). Rating, completion rate and badges arrive in B3b.
// Tapping the name or photo opens the person's profile (B3b-1 G); pass
// link={false} where the row is already inside a link.
export function PersonRow({ person, caption, link = true }: { person: MiniProfile; caption?: string; link?: boolean }) {
  const { t } = useTranslation();
  const university = person.university?.shortName ?? person.university?.name;
  const content = (
    <>
      <Avatar name={person.name} src={person.photo?.url} size={40} />
      <span className={styles.personText}>
        <span className={styles.personName}>
          {person.name || t("chat.someone")}{" "}
          {person.isVerifiedRider && <BadgeCheck aria-label={t("ride.verifiedRider")} size={16} />}
        </span>
        <span className={styles.muted}>{[caption, university, person.department].filter(Boolean).join(" · ")}</span>
        <PersonStats person={person} />
      </span>
    </>
  );
  return link ? (
    <Link to={profilePath(person.id)} className={styles.person} aria-label={t("profile.open", { name: person.name || t("chat.someone") })}>
      {content}
    </Link>
  ) : (
    <div className={styles.person}>{content}</div>
  );
}

// Rating ("New" below 3 reviews), completion rate ("New" below 5) and the
// earned badges (B3b-2).
export function PersonStats({ person }: { person: MiniProfile }) {
  const { t, i18n } = useTranslation();
  const earned = person.badges.filter((badge) => badge === "TOP_RATED" || badge === "RELIABLE");
  return (
    <span className={styles.stats}>
      <span>
        <Star aria-hidden size={13} /> {person.rating === null ? t("stats.new") : t("stats.ratingShort", { rating: person.rating.toLocaleString(i18n.language === "bn" ? "bn-BD" : "en"), count: person.ratingCount ?? 0 })}
      </span>
      {person.completionRate !== null && <span>{t("stats.completedShort", { rate: Math.round(person.completionRate * 100) })}</span>}
      {earned.map((badge) => (
        <span key={badge} className={styles.badge}>
          {t(`profile.badges.${badge}`)}
        </span>
      ))}
    </span>
  );
}

export function VehicleLine({ vehicle }: { vehicle: PublicVehicle }) {
  const { t } = useTranslation();
  return (
    <span className={styles.muted}>
      {t(`ride.vehicleType.${vehicle.type}`)} · {vehicle.brand} {vehicle.model} · {vehicle.colour} · {vehicle.registrationNumber}
    </span>
  );
}

// A request or an offer in the list (proposal 8.3).
export function RideCard({ item }: { item: RideItem }) {
  const { t, i18n } = useTranslation();
  const isOffer = item.kind === "OFFER";
  const to = isOffer ? `/ride/offers/${item.id}` : `/ride/requests/${item.id}`;
  const time = isOffer ? item.departureTime : item.startTime;

  // The card links to the ride; the person row below links to the profile
  // (two separate links, never one inside the other).
  return (
    <div className={styles.card}>
      <Link to={to} className={styles.cardLink}>
      <span className={styles.cardTop}>
        <span className={styles.kind}>{isOffer ? t("ride.kind.offer") : t("ride.kind.request")}</span>
        <span className={styles.amount}>
          {isOffer
            ? t("ride.perSeat", { amount: taka(item.farePerSeat, i18n.language) })
            : t("ride.total", { amount: taka(item.offeredAmount, i18n.language) })}
        </span>
      </span>
      <Route pickup={item.pickup} destination={item.destination} />
      <span className={styles.meta}>
        <span>{formatRideTime(time, i18n.language)}</span>
        <span>
          <Users aria-hidden size={14} />{" "}
          {isOffer ? t("ride.seatsLeft", { count: item.seatsAvailable }) : t("ride.passengers", { count: item.passengerCount })}
        </span>
        {item.mine && <span>{t("ride.yours")}</span>}
      </span>
      </Link>
      <PersonRow person={isOffer ? item.rider : item.passenger} caption={isOffer ? t("ride.role.rider") : t("ride.role.passenger")} />
      {isOffer && <VehicleLine vehicle={item.vehicle} />}
    </div>
  );
}
