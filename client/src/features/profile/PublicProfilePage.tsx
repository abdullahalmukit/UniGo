import { BadgeCheck, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Avatar } from "../../components/Avatar";
import { FormAlert } from "../../components/form";
import { ToneChip } from "../../components/StatusChip";
import { api, ApiError } from "../../lib/api";
import { formatDate } from "../../lib/dates";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import type { PublicVehicle, RideItem, SignedLink } from "../ride/ride-api";
import { RideCard } from "../ride/RideCard";
import styles from "./PublicProfilePage.module.css";

export type PublicProfile = {
  id: string;
  name: string;
  photo: SignedLink | null;
  university: { name: string; shortName: string | null } | null;
  department: string | null;
  batch: string | null;
  memberSince: string;
  badges: ("VERIFIED_STUDENT" | "VERIFIED_RIDER")[];
  vehicles: PublicVehicle[];
  stats: { rating: number | null; completed: number | null; completionRate: number | null; lateCancellationRate: number | null };
  reviews: unknown[];
  openRides: RideItem[];
  isMe: boolean;
};

export const getPublicProfile = (id: string) => api<{ profile: PublicProfile }>(`/users/${encodeURIComponent(id)}/profile`).then((r) => r.profile);

// A person's public profile (proposal 8.3, B3b-1 G). Never a phone or email.
// Rating, completion rate, late cancellation rate and reviews arrive in B3b-2.
export function PublicProfilePage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<"NOT_FOUND" | "FAILED" | null>(null);

  const load = useCallback(() => {
    setError(null);
    getPublicProfile(id)
      .then(setProfile)
      .catch((failure) => setError(failure instanceof ApiError && failure.status === 404 ? "NOT_FOUND" : "FAILED"));
  }, [id]);
  useEffect(load, [load]);

  if (!profile) {
    return (
      <div className={styles.page}>
        <SubPageHeader title={t("profile.publicTitle")} back="/" />
        {error ? <FormAlert>{error === "NOT_FOUND" ? t("profile.notFound") : t("profile.loadFailed")}</FormAlert> : <SkeletonList rows={4} />}
      </div>
    );
  }

  const university = profile.university?.shortName ?? profile.university?.name;
  const dash = t("profile.stats.none");
  return (
    <div className={styles.page}>
      <SubPageHeader title={t("profile.publicTitle")} back="/" />
      <section className={styles.card}>
        <div className={styles.head}>
          <Avatar name={profile.name} src={profile.photo?.url} size={72} />
          <div className={styles.headText}>
            <h1 className={styles.name}>{profile.name || t("chat.someone")}</h1>
            <span className={styles.muted}>{[university, profile.department, profile.batch && t("profile.batchOf", { batch: profile.batch })].filter(Boolean).join(" · ")}</span>
            <span className={styles.muted}>{t("profile.memberSince", { date: formatDate(profile.memberSince, i18n.language) })}</span>
          </div>
        </div>
        <div className={styles.badges}>
          {profile.badges.map((badge) => (
            <ToneChip key={badge} tone="green" label={t(`profile.badges.${badge}`)} />
          ))}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="stats-title">
        <h2 id="stats-title" className={styles.title}>
          {t("profile.stats.title")}
        </h2>
        <dl className={styles.stats}>
          <div>
            <dt>{t("profile.stats.rating")}</dt>
            <dd>
              <Star aria-hidden size={16} /> {profile.stats.rating ?? dash}
            </dd>
          </div>
          <div>
            <dt>{t("profile.stats.completionRate")}</dt>
            <dd>{profile.stats.completionRate ?? dash}</dd>
          </div>
          <div>
            <dt>{t("profile.stats.lateCancellationRate")}</dt>
            <dd>{profile.stats.lateCancellationRate ?? dash}</dd>
          </div>
        </dl>
        <h3 className={styles.subTitle}>{t("profile.reviews")}</h3>
        <p className={styles.muted}>{t("profile.noReviews")}</p>
      </section>

      {profile.vehicles.length > 0 && (
        <section className={styles.card}>
          <h2 className={styles.title}>{t("profile.vehicles")}</h2>
          <ul className={styles.vehicles}>
            {profile.vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <BadgeCheck aria-hidden size={16} /> {t(`ride.vehicleType.${vehicle.type}`)} · {vehicle.brand} {vehicle.model} · {vehicle.colour} ·{" "}
                {vehicle.registrationNumber}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.title}>{t("profile.openRides")}</h2>
        {profile.openRides.length === 0 ? (
          <p className={styles.muted}>{t("profile.noOpenRides")}</p>
        ) : (
          <ul className={styles.list}>
            {profile.openRides.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <RideCard item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
