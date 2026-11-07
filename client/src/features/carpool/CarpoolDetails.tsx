import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { ContactRow } from "../../components/ContactRow";
import { BottomSheet, FormAlert } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { StatusChip, ToneChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { formatRideTime } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import { cancelActivity } from "../ride/ride-api";
import { ReasonField } from "../ride/RideActions";
import { PersonRow, Route, taka, VehicleLine } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import {
  acceptBooking,
  agreeBooking,
  dhakaDate,
  getBooking,
  getPost,
  pausePost,
  quote,
  rejectBooking,
  removePost,
  requestSeat,
  runsOn,
  weekdayOf,
  withdrawBooking,
  type CarpoolBooking,
  type CarpoolBookingSummary,
  type CarpoolPost,
  type CarpoolPostDetail,
  type Quote,
} from "./carpool-api";
import { DateRange, ScheduleLine, showDate } from "./carpool-shared";
import carpoolStyles from "./carpool.module.css";

const HOLDING = ["ACCEPTED", "DISPUTED"];

function useLoad<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<"NOT_FOUND" | "FAILED" | null>(null);
  const reload = useCallback(() => {
    load()
      .then((result) => (setValue(result), setError(null)))
      .catch((failure) => setError(failure instanceof ApiError && failure.status === 404 ? "NOT_FOUND" : "FAILED"));
  }, [load]);
  useEffect(reload, [reload]);
  return { value, error, reload };
}

function LoadState({ error, title }: { error: "NOT_FOUND" | "FAILED" | null; title: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.narrow}>
      <SubPageHeader title={title} back="/carpool" />
      {error ? <FormAlert>{error === "NOT_FOUND" ? t("carpool.notFound") : t("carpool.loadFailed")}</FormAlert> : <SkeletonList rows={4} />}
    </div>
  );
}

function errorText(failure: unknown, t: ReturnType<typeof useTranslation>["t"], language: string) {
  // B6a: a clash names the ride days
  if (failure instanceof ApiError && failure.code === "TIME_CONFLICT" && Array.isArray(failure.data?.dates)) {
    const dates = (failure.data.dates as string[]).map((d) => showDate(d, language)).join(", ");
    return t("carpool.conflictDates", { dates });
  }
  const errors = formErrors(failure, t);
  return errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic");
}

export function PostStatusChip({ post }: { post: Pick<CarpoolPost, "status" | "paused"> }) {
  const { t } = useTranslation();
  if (post.paused && post.status !== "CLOSED") return <ToneChip tone="grey" label={t("carpool.paused")} />;
  const tone = post.status === "OPEN" ? "amber" : post.status === "FULL" ? "indigo" : "grey";
  return <ToneChip tone={tone} label={t(`ride.postStatus.${post.status}`)} />;
}

function PostSummary({ post }: { post: CarpoolPost }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <section className={styles.section}>
        <ScheduleLine daysOfWeek={post.daysOfWeek} departureMinute={post.departureMinute} />
        <Route pickup={post.pickup} destination={post.destination} />
        <DateRange from={post.validFrom} until={post.validUntil} />
        <span className={styles.meta}>
          <span>{t("ride.seatsLeft", { count: post.seatsAvailable })}</span>
          {post.nextRide && <span>{t("carpool.nextRide", { time: formatRideTime(post.nextRide, i18n.language) })}</span>}
        </span>
        <ul className={carpoolStyles.sessions} aria-label={t("carpool.form.prices")}>
          {post.prices.map((p) => (
            <li key={p.durationMonths} className={carpoolStyles.session}>
              <span>{t("carpool.months", { count: p.durationMonths })}</span>
              <span className={styles.amount}>{t("carpool.perMonth", { amount: taka(p.monthlyPrice, i18n.language) })}</span>
            </li>
          ))}
        </ul>
        {post.notes && <p>{post.notes}</p>}
      </section>
      <section className={styles.section}>
        <PersonRow person={post.rider} caption={t("ride.role.rider")} />
        <VehicleLine vehicle={post.vehicle} />
        <span className={styles.meta}>{t("carpool.sessionCancellations", { count: post.riderSessionCancellations })}</span>
      </section>
    </>
  );
}

// --- A carpool post

export function PostDetailPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { value: post, error, reload } = useLoad(useCallback(() => getPost(id).then((r) => r.post), [id]));
  const [removeOpen, setRemoveOpen] = useState(false);
  const [rejecting, setRejecting] = useState<CarpoolBookingSummary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { i18n } = useTranslation();

  if (!post) return <LoadState error={error} title={t("carpool.kind.post")} />;
  const holding = post.bookings.filter((b) => HOLDING.includes(b.status));
  const pending = post.bookings.filter((b) => b.status === "OPEN");
  const past = post.bookings.filter((b) => !HOLDING.includes(b.status) && b.status !== "OPEN");
  const closed = post.status === "CLOSED";

  const run = async (work: () => Promise<unknown>, done: string) => {
    setActionError(null);
    try {
      await work();
      toast.show(done);
      reload();
    } catch (failure) {
      setActionError(errorText(failure, t, i18n.language));
      reload();
    }
  };

  return (
    <div className={styles.narrow}>
      <SubPageHeader title={t("carpool.kind.post")} back="/carpool" action={<PostStatusChip post={post} />} />
      {actionError && <FormAlert>{actionError}</FormAlert>}
      <PostSummary post={post} />

      {post.mine && (
        <>
          {!closed && (
            <div className={styles.actions}>
              <Link to={`/carpool/posts/${post.id}/edit`} className={buttonStyles.secondary}>
                {holding.length > 0 ? t("ride.actions.addSeats") : t("ride.actions.edit")}
              </Link>
              <button type="button" className={buttonStyles.secondary} onClick={() => void run(() => pausePost(post.id, !post.paused), t("ride.form.saved"))}>
                {post.paused ? t("carpool.actions.resume") : t("ride.actions.stop")}
              </button>
              {holding.length === 0 && (
                <button type="button" className={buttonStyles.secondary} onClick={() => setRemoveOpen(true)}>
                  {t("carpool.actions.remove")}
                </button>
              )}
            </div>
          )}
          {post.paused && !closed && <p className={styles.muted}>{t("carpool.pausedHint")}</p>}

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>{t("carpool.requests.title", { count: pending.length })}</h2>
            {pending.length === 0 && <p className={styles.muted}>{t("carpool.requests.none")}</p>}
            {pending.map((booking) => (
              <div key={booking.activityId} className={styles.bookingRow}>
                {booking.passenger && <PersonRow person={booking.passenger} caption={t("carpool.requestLine", { count: booking.durationMonths, date: showDate(booking.startDate, i18n.language) })} />}
                <div className={styles.actions}>
                  <button type="button" className={buttonStyles.primary} onClick={() => void run(() => acceptBooking(booking.activityId), t("carpool.actions.accepted"))}>
                    {t("carpool.actions.accept")}
                  </button>
                  <button type="button" className={buttonStyles.secondary} onClick={() => setRejecting(booking)}>
                    {t("carpool.actions.reject")}
                  </button>
                  <Link to={`/carpool/bookings/${booking.activityId}`} className={buttonStyles.secondary}>
                    {t("activity.actions.details")}
                  </Link>
                </div>
              </div>
            ))}
          </section>

          <BookingList title={t("carpool.passengers.title", { count: holding.length })} bookings={holding} empty={t("carpool.passengers.none")} />
          {past.length > 0 && <BookingList title={t("carpool.passengers.past")} bookings={past} />}
        </>
      )}

      {!post.mine && <PassengerPanel post={post} onDone={(activityId) => void navigate(`/carpool/bookings/${activityId}`)} />}

      <ConfirmSheet
        title={t("carpool.actions.removeTitle")}
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        confirmLabel={t("carpool.actions.remove")}
        onConfirm={async () => {
          await removePost(post.id);
          setRemoveOpen(false);
          toast.show(t("carpool.actions.removed"));
          reload();
        }}
      >
        <p className={styles.muted}>{t("carpool.actions.removeHint")}</p>
      </ConfirmSheet>
      {rejecting && <RejectSheet booking={rejecting} onClose={() => setRejecting(null)} onDone={() => (setRejecting(null), reload())} />}
    </div>
  );
}

function BookingList({ title, bookings, empty }: { title: string; bookings: CarpoolBookingSummary[]; empty?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {bookings.length === 0 && empty && <p className={styles.muted}>{empty}</p>}
      {bookings.map((booking) => (
        <div key={booking.activityId} className={styles.bookingRow}>
          <div className={styles.row}>
            {booking.passenger && <PersonRow person={booking.passenger} caption={t("carpool.contractLine", { from: showDate(booking.startDate, i18n.language), until: showDate(booking.endDate, i18n.language) })} />}
            <BookingStatus booking={booking} />
          </div>
          <ContactRow phone={booking.phone} name={booking.passenger?.name} />
          <Link to={`/carpool/bookings/${booking.activityId}`} className={buttonStyles.secondary}>
            {t("ride.bookings.openOne")}
          </Link>
        </div>
      ))}
    </section>
  );
}

export function BookingStatus({ booking }: { booking: Pick<CarpoolBookingSummary, "status" | "subStatus"> }) {
  const { t } = useTranslation();
  if (booking.status === "ACCEPTED" && booking.subStatus === "CONTRACT_ACTIVE") return <ToneChip tone="indigo" label={t("carpool.contractActive")} />;
  if (booking.status === "ACCEPTED") return <ToneChip tone="amber" label={t("carpool.seatHeld")} />;
  return <StatusChip status={booking.status} />;
}

function RejectSheet({ booking, onClose, onDone }: { booking: CarpoolBookingSummary; onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <BottomSheet title={t("carpool.actions.rejectTitle")} open onClose={onClose}>
      {error && <FormAlert>{error}</FormAlert>}
      <p className={styles.muted}>{t("carpool.actions.rejectHint")}</p>
      <ReasonField value={reason} onChange={setReason} />
      <div className={formStyles.sheetButtons}>
        <button type="button" className={buttonStyles.secondary} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className={buttonStyles.primary}
          onClick={() =>
            void rejectBooking(booking.activityId, reason.trim() || null)
              .then(() => (toast.show(t("carpool.actions.rejected")), onDone()))
              .catch((failure) => setError(errorText(failure, t, i18n.language)))
          }
        >
          {t("carpool.actions.reject")}
        </button>
      </div>
    </BottomSheet>
  );
}

// A passenger picks a duration and a start date on one of the ride days, and
// sends a request for one seat (9.3 step 1).
function PassengerPanel({ post, onDone }: { post: CarpoolPostDetail; onDone: (activityId: string) => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const mine = post.myBooking;
  const active = mine && ["OPEN", "ACCEPTED", "DISPUTED"].includes(mine.status);
  const [months, setMonths] = useState(post.prices[0]?.durationMonths ?? 1);
  const firstDay = () => {
    for (let i = 1; i < 60; i += 1) {
      const date = dhakaDate(i);
      if (date >= post.validFrom && runsOn(post.daysOfWeek, weekdayOf(date))) return date;
    }
    return dhakaDate(1);
  };
  const [startDate, setStartDate] = useState(firstDay);
  const [summary, setSummary] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bookable = post.status === "OPEN" && !post.paused;

  useEffect(() => {
    if (active || !bookable) return;
    let cancelled = false;
    setSummary(null);
    setError(null);
    quote(post.id, months, startDate)
      .then((result) => !cancelled && setSummary(result))
      .catch((failure) => !cancelled && setError(errorText(failure, t, i18n.language)));
    return () => {
      cancelled = true;
    };
  }, [post.id, months, startDate, active, bookable, t, i18n.language]);

  if (active && mine) {
    return (
      <section className={styles.section}>
        <div className={styles.row}>
          <span>{t("carpool.yourBooking", { count: mine.durationMonths, date: showDate(mine.startDate, i18n.language) })}</span>
          <BookingStatus booking={mine} />
        </div>
        <ContactRow phone={mine.phone} name={post.rider.name} />
        <Link to={`/carpool/bookings/${mine.activityId}`} className={buttonStyles.secondary}>
          {t("ride.bookings.open")}
        </Link>
      </section>
    );
  }
  if (!bookable) return <p className={styles.muted}>{post.paused ? t("carpool.pausedHint") : t(post.status === "FULL" ? "carpool.fullHint" : "carpool.closedHint")}</p>;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestSeat(post.id, months, startDate);
      toast.show(t("carpool.actions.requested"));
      onDone(result.booking.activityId);
    } catch (failure) {
      setError(errorText(failure, t, i18n.language));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${styles.section} ${styles.sticky}`}>
      <h2 className={styles.sectionTitle}>{t("carpool.requestTitle")}</h2>
      {error && <FormAlert>{error}</FormAlert>}
      <label className={formStyles.field}>
        <span className={formStyles.label}>{t("carpool.duration")}</span>
        <select className={styles.select} value={months} onChange={(event) => setMonths(Number(event.target.value))}>
          {post.prices.map((p) => (
            <option key={p.durationMonths} value={p.durationMonths}>
              {t("carpool.months", { count: p.durationMonths })} · {t("carpool.perMonth", { amount: taka(p.monthlyPrice, i18n.language) })}
            </option>
          ))}
        </select>
      </label>
      <label className={formStyles.field}>
        <span className={formStyles.label}>{t("carpool.startDate")}</span>
        <input className={styles.select} type="date" min={dhakaDate(1)} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        <span className={formStyles.hint}>{t("carpool.startDateHint")}</span>
      </label>
      {summary && (
        <p className={styles.muted}>
          {t("carpool.quote", {
            until: showDate(summary.endDate, i18n.language),
            count: summary.sessions,
            total: taka(summary.total, i18n.language),
          })}
        </p>
      )}
      <button type="button" className={buttonStyles.primary} disabled={busy || !summary} onClick={() => void send()}>
        {t("carpool.actions.request")}
      </button>
    </section>
  );
}

// --- One booking: the request, the held seat, the contract and its sessions

export function CarpoolBookingPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const { value: booking, error, reload } = useLoad(useCallback(() => getBooking(id).then((r) => r.booking), [id]));
  if (!booking) return <LoadState error={error} title={t("carpool.kind.booking")} />;
  return <BookingView booking={booking} reload={reload} />;
}

function BookingView({ booking, reload }: { booking: CarpoolBooking; reload: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const isRider = booking.role === "RIDER";
  const other = isRider ? booking.passenger : booking.rider;
  const held = booking.status === "ACCEPTED" && booking.subStatus === null;
  const contract = booking.status === "ACCEPTED" && booking.subStatus === "CONTRACT_ACTIVE";

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await work();
      toast.show(done);
    } catch (failure) {
      setError(errorText(failure, t, i18n.language));
    }
    reload();
  };

  return (
    <div className={styles.narrow}>
      <SubPageHeader title={t("carpool.kind.booking")} back={`/carpool/posts/${booking.postId}`} action={<BookingStatus booking={booking} />} />
      {error && <FormAlert>{error}</FormAlert>}
      <BookingNote booking={booking} />

      <section className={styles.section}>
        <div className={styles.row}>
          <span>{t("carpool.months", { count: booking.durationMonths })}</span>
          <span className={styles.amount}>{t("carpool.perMonth", { amount: taka(booking.monthlyPrice, i18n.language) })}</span>
        </div>
        <span className={styles.meta}>{t("carpool.contractLine", { from: showDate(booking.startDate, i18n.language), until: showDate(booking.endDate, i18n.language) })}</span>
        <span className={styles.meta}>{t("carpool.firstRide", { time: formatRideTime(booking.firstRide, i18n.language) })}</span>
        {other && <PersonRow person={other} caption={t(isRider ? "ride.role.passenger" : "ride.role.rider")} />}
        <ContactRow phone={booking.phone} name={other?.name} />
      </section>

      <div className={styles.actions}>
        {booking.status === "OPEN" && isRider && (
          <>
            <button type="button" className={buttonStyles.primary} onClick={() => void run(() => acceptBooking(booking.activityId), t("carpool.actions.accepted"))}>
              {t("carpool.actions.accept")}
            </button>
            <button type="button" className={buttonStyles.secondary} onClick={() => setRejectOpen(true)}>
              {t("carpool.actions.reject")}
            </button>
          </>
        )}
        {booking.status === "OPEN" && !isRider && (
          <button type="button" className={buttonStyles.secondary} onClick={() => void run(() => withdrawBooking(booking.activityId), t("carpool.actions.withdrawn"))}>
            {t("carpool.actions.withdraw")}
          </button>
        )}
        {held && !booking.agreed.me && (
          <button type="button" className={buttonStyles.primary} onClick={() => void run(() => agreeBooking(booking.activityId), t("carpool.actions.agreed"))}>
            {t("carpool.actions.agree")}
          </button>
        )}
        {booking.chatId && (
          <Link to={`/inbox/${booking.chatId}`} className={buttonStyles.secondary}>
            {t("ride.actions.chat")}
          </Link>
        )}
        {held && (
          <button type="button" className={buttonStyles.secondary} onClick={() => setCancelOpen(true)}>
            {t("carpool.actions.cancelSeat")}
          </button>
        )}
      </div>

      <PostSummary post={booking.post} />

      {contract || booking.sessions.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("carpool.sessions.title", { count: booking.sessions.length })}</h2>
          <ul className={carpoolStyles.sessions}>
            {booking.sessions.map((session) => (
              <li key={session.activityId} className={carpoolStyles.session}>
                <span>{formatRideTime(session.startTime, i18n.language)}</span>
                <StatusChip status={session.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ConfirmSheet
        title={t("carpool.actions.cancelSeatTitle")}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        confirmLabel={t("carpool.actions.cancelSeat")}
        onConfirm={async () => {
          await cancelActivity(booking.activityId, reason.trim());
          setCancelOpen(false);
          toast.show(t("ride.actions.cancelled"));
          reload();
        }}
      >
        <p className={styles.muted}>{t("ride.actions.cancelHint")}</p>
        <ReasonField value={reason} onChange={setReason} />
      </ConfirmSheet>
      {rejectOpen && <RejectSheet booking={booking} onClose={() => setRejectOpen(false)} onDone={() => (setRejectOpen(false), reload())} />}
    </div>
  );
}

// What happens next, in one line.
function BookingNote({ booking }: { booking: CarpoolBooking }) {
  const { t, i18n } = useTranslation();
  const isRider = booking.role === "RIDER";
  if (booking.status === "OPEN") return <FormAlert tone="info">{t(isRider ? "carpool.note.openRider" : "carpool.note.openPassenger")}</FormAlert>;
  if (booking.status === "ACCEPTED" && booking.subStatus === null && booking.holdExpiresAt) {
    const until = formatRideTime(booking.holdExpiresAt, i18n.language);
    const key = booking.agreed.me ? "carpool.note.waitingOther" : booking.agreed.other ? "carpool.note.otherAgreed" : "carpool.note.held";
    return <FormAlert tone="info">{t(key, { until })}</FormAlert>;
  }
  if (booking.status === "ACCEPTED" && booking.subStatus === "CONTRACT_ACTIVE") return <FormAlert tone="success">{t("carpool.note.contract")}</FormAlert>;
  if (booking.status === "CANCELLED") {
    const why =
      booking.closureReason === "BOOKING_REJECTED"
        ? booking.rejectionReason
          ? t("carpool.note.rejectedWith", { reason: booking.rejectionReason })
          : t("carpool.note.rejected")
        : booking.closureReason === "POST_CHANGED" || booking.closureReason === "POST_REMOVED" || booking.closureReason === "SEAT_HOLD_EXPIRED"
          ? t(`carpool.note.${booking.closureReason}`)
          : booking.cancellationReason
            ? t("carpool.note.cancelledWith", { reason: booking.cancellationReason })
            : t("carpool.note.cancelled");
    return <FormAlert tone="info">{why}</FormAlert>;
  }
  if (booking.status === "EXPIRED") return <FormAlert tone="info">{t("carpool.note.expired")}</FormAlert>;
  if (booking.status === "COMPLETED") return <FormAlert tone="success">{t("carpool.note.ended")}</FormAlert>;
  return null;
}
