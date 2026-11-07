import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { buttonStyles, PageHeader, Section } from "../../components/ui";
import { formatRideTime } from "../../lib/dates";
import { adminRidesApi, type AdminPerson, type AdminRideActivity, type AdminReview, type AdminVehicle, type HistoryRow } from "./admin-rides-api";
import { adminError, ConfirmSheet, formatDateTime, Loaded, TextAreaField, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

const RUNNING = ["OPEN", "ACCEPTED", "IN_PROGRESS", "DISPUTED"];

function Person({ label, person }: { label: string; person: AdminPerson }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{person ? <Link to={`/admin/users/${person.id}`}>{person.name || person.email}</Link> : "—"}</dd>
    </>
  );
}

function Vehicle({ vehicle }: { vehicle: AdminVehicle | null }) {
  const { t } = useTranslation();
  if (!vehicle) return null;
  return (
    <>
      <dt>{t("admin.rides.vehicle")}</dt>
      <dd>
        {t(`ride.vehicleType.${vehicle.type}`)} · {vehicle.brand} {vehicle.model} · {vehicle.colour} · {vehicle.registrationNumber}
      </dd>
    </>
  );
}

function History({ rows }: { rows: HistoryRow[] }) {
  const { t, i18n } = useTranslation();
  return (
    <Section title={t("admin.rides.history")}>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.id} className={styles.item}>
            <span className={styles.itemTitle}>
              {row.fromStatus ? `${t(`status.${row.fromStatus}`)} → ` : ""}
              {t(`status.${row.toStatus}`)}
              {row.toSubStatus ? ` (${row.toSubStatus})` : ""}
            </span>
            <span className={styles.muted}>
              {formatDateTime(row.createdAt, i18n.language)} · {row.actor?.name ?? t(`admin.rides.actor.${row.actorType}`)}
            </span>
            {row.reason && <span className={styles.muted}>{t("admin.rides.reason", { reason: row.reason })}</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Reviews({ reviews, onChanged }: { reviews: AdminReview[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const [hiding, setHiding] = useState<AdminReview | null>(null);
  const [reason, setReason] = useState("");
  if (reviews.length === 0) return null;
  return (
    <Section title={t("admin.rides.reviews")}>
      <ul className={styles.list}>
        {reviews.map((review) => (
          <li key={review.id} className={styles.item}>
            <span className={styles.itemTitle}>
              {t("admin.rides.reviewLine", { reviewer: review.reviewer.name, reviewee: review.reviewee.name, rating: review.rating })}
            </span>
            {review.comment && <span>{review.comment}</span>}
            <span className={styles.muted}>
              {review.hidden ? t("admin.rides.hidden", { reason: review.hiddenReason ?? "" }) : review.published ? t("admin.rides.published") : t("admin.rides.notPublished")}
            </span>
            {!review.hidden && (
              <button type="button" className={buttonStyles.secondary} onClick={() => setHiding(review)}>
                {t("admin.rides.hide")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmSheet
        title={t("admin.rides.hideTitle")}
        open={hiding !== null}
        onClose={() => setHiding(null)}
        confirmLabel={t("admin.rides.hide")}
        onConfirm={async () => {
          await adminRidesApi.hideReview(hiding!.id, reason.trim());
          setHiding(null);
          setReason("");
          onChanged();
        }}
      >
        <TextAreaField label={t("admin.reason")} value={reason} onChange={setReason} />
      </ConfirmSheet>
    </Section>
  );
}

function CancelButton({ onCancel }: { onCancel: (reason: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <button type="button" className={`${buttonStyles.secondary} ${styles.danger}`} onClick={() => setOpen(true)}>
        {t("admin.rides.cancel")}
      </button>
      <ConfirmSheet
        title={t("admin.rides.cancelTitle")}
        open={open}
        onClose={() => setOpen(false)}
        confirmLabel={t("admin.rides.cancel")}
        onConfirm={async () => {
          await onCancel(reason.trim());
          setOpen(false);
          setReason("");
        }}
      >
        <p className={styles.muted}>{t("admin.rides.cancelHint")}</p>
        <TextAreaField label={t("admin.reason")} value={reason} onChange={setReason} />
      </ConfirmSheet>
    </>
  );
}

// A request or a booking (proposal 17, B3b-2).
export function AdminRideActivityPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminRidesApi.activity(id), [id]);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.rides.detailTitle")} />
      <Link to="/admin/rides" className={styles.backLink}>
        {t("admin.rides.back")}
      </Link>
      <Loaded state={state} reload={reload}>
        {(ride: AdminRideActivity) => (
          <div className={styles.stack}>
            <Section title={t(ride.kind === "REQUEST" ? "ride.kind.request" : "activity.kind.booking")}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>
                  {t(`status.${ride.status}`)}
                  {ride.deletedAt ? ` · ${t("admin.rides.deleted")}` : ""}
                  {ride.isLateCancellation ? ` · ${t("admin.rides.late")}` : ""}
                </dd>
                <dt>{t("admin.rides.time")}</dt>
                <dd>{formatRideTime(ride.startTime, i18n.language)}</dd>
                {ride.rideRequest && (
                  <>
                    <dt>{t("admin.rides.route")}</dt>
                    <dd>
                      {ride.rideRequest.pickupAddress} → {ride.rideRequest.destinationAddress}
                    </dd>
                    <dt>{t("admin.rides.amount")}</dt>
                    <dd>৳{ride.rideRequest.offeredAmount}</dd>
                  </>
                )}
                {ride.rideBooking && (
                  <>
                    <dt>{t("admin.rides.amount")}</dt>
                    <dd>
                      ৳{ride.rideBooking.amount} · {t("admin.rides.seats", { seats: ride.rideBooking.seatsBooked })} ·{" "}
                      <Link to={`/admin/rides/offers/${ride.rideBooking.rideOfferId}`}>{t("admin.rides.openOffer")}</Link>
                    </dd>
                  </>
                )}
                <Person label={t(ride.kind === "REQUEST" ? "ride.role.passenger" : "ride.role.rider")} person={ride.creator} />
                <Person label={t(ride.kind === "REQUEST" ? "ride.role.rider" : "ride.role.passenger")} person={ride.accepter} />
                <Vehicle vehicle={ride.rideRequest?.vehicle ?? null} />
                <dt>{t("admin.rides.payment")}</dt>
                <dd>
                  {ride.payment
                    ? `${t(`payment.status.${ride.payment.status}`)} · ${ride.payment.method ? t(`payment.methods.${ride.payment.method}`) : t("payment.noMethod")}`
                    : "—"}
                </dd>
              </dl>
              {error && <p className={styles.muted}>{error}</p>}
              {RUNNING.includes(ride.status) && (
                <CancelButton
                  onCancel={async (reason) => {
                    try {
                      await adminRidesApi.cancelActivity(ride.id, reason);
                      setError(null);
                      void reload();
                    } catch (failure) {
                      setError(adminError(failure, t));
                      throw failure;
                    }
                  }}
                />
              )}
            </Section>
            <History rows={ride.history} />
            <Reviews reviews={ride.reviews} onChanged={() => void reload()} />
            <p className={styles.muted}>{t("admin.rides.chatPrivate")}</p>
          </div>
        )}
      </Loaded>
    </>
  );
}

// A ride offer with its bookings.
export function AdminRideOfferPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminRidesApi.offer(id), [id]);

  return (
    <>
      <PageHeader title={t("admin.rides.offerTitle")} />
      <Link to="/admin/rides" className={styles.backLink}>
        {t("admin.rides.back")}
      </Link>
      <Loaded state={state} reload={reload}>
        {(offer) => (
          <div className={styles.stack}>
            <Section title={t("ride.kind.offer")}>
              <dl className={styles.keyValues}>
                <dt>{t("admin.rides.status")}</dt>
                <dd>
                  {t(`ride.postStatus.${offer.status}`)}
                  {offer.closeReason ? ` · ${t(`admin.rides.closeReasons.${offer.closeReason}`)}` : ""}
                </dd>
                <dt>{t("admin.rides.time")}</dt>
                <dd>{formatRideTime(offer.departureTime, i18n.language)}</dd>
                <dt>{t("admin.rides.route")}</dt>
                <dd>
                  {offer.pickupAddress} → {offer.destinationAddress}
                </dd>
                <dt>{t("admin.rides.amount")}</dt>
                <dd>
                  ৳{offer.farePerSeat} · {t("admin.rides.seats", { seats: `${offer.totalSeats - offer.seatsAvailable}/${offer.totalSeats}` })}
                </dd>
                <Person label={t("ride.role.rider")} person={offer.rider} />
                <Vehicle vehicle={offer.vehicle} />
              </dl>
              {(offer.status !== "CLOSED" || offer.bookings.some((b) => RUNNING.includes(b.status))) && (
                <CancelButton
                  onCancel={async (reason) => {
                    await adminRidesApi.cancelOffer(offer.id, reason);
                    void reload();
                  }}
                />
              )}
            </Section>
            <Section title={t("admin.rides.bookings")}>
              {offer.bookings.length === 0 ? (
                <p className={styles.muted}>{t("ride.bookings.none")}</p>
              ) : (
                <ul className={styles.list}>
                  {offer.bookings.map((booking) => (
                    <li key={booking.activityId}>
                      <Link to={`/admin/rides/activities/${booking.activityId}`} className={styles.itemLink}>
                        <span className={styles.itemTitle}>{booking.passenger?.name ?? "—"}</span>
                        <span className={styles.muted}>
                          {t(`status.${booking.status}`)} · {t("admin.rides.seats", { seats: booking.seatsBooked })} · ৳{booking.amount}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </Loaded>
    </>
  );
}
