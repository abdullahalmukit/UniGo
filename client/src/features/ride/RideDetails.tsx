import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { ContactRow } from "../../components/ContactRow";
import { BottomSheet, FormAlert } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { StatusChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { formatRideTime } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import {
  acceptRequest,
  bookOffer,
  cancelOffer,
  deleteActivity,
  getBooking,
  getOffer,
  getRequest,
  removeOffer,
  stopOffer,
  upgradeRequest,
  type RideBooking,
  type RideOffer,
  type RideRequest,
} from "./ride-api";
import { useRiderStatus } from "./ride-hooks";
import { ReasonField, RideActions } from "./RideActions";
import { PersonRow, Route, taka, VehicleLine } from "./RideCard";
import styles from "./ride.module.css";

const TERMINAL = ["COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];

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
      <SubPageHeader title={title} back="/ride" />
      {error ? <FormAlert>{error === "NOT_FOUND" ? t("ride.notFound") : t("ride.loadFailed")}</FormAlert> : <SkeletonList rows={4} />}
    </div>
  );
}

// --- Passenger request

export function RequestDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const rider = useRiderStatus();
  const { value: request, error, reload } = useLoad(useCallback(() => getRequest(id).then((r) => r.request), [id]));
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  if (!request) return <LoadState error={error} title={t("ride.kind.request")} />;
  const isOpen = request.status === "OPEN";
  const participant = request.role !== null;

  return (
    <div className={styles.narrow}>
      <SubPageHeader title={t("ride.kind.request")} back="/ride" action={<StatusChip status={request.status} />} />
      <section className={styles.section}>
        <div className={styles.row}>
          <span>{formatRideTime(request.startTime, i18n.language)}</span>
          <span className={styles.amount}>{t("ride.total", { amount: taka(request.offeredAmount, i18n.language) })}</span>
        </div>
        <Route pickup={request.pickup} destination={request.destination} />
        <span className={styles.meta}>
          <span>{t("ride.passengers", { count: request.passengerCount })}</span>
          <span>{request.subArea.name}</span>
          {request.routeDistanceKm !== null && <span>{t("ride.distance", { km: taka(request.routeDistanceKm, i18n.language) })}</span>}
        </span>
        {request.notes && <p>{request.notes}</p>}
      </section>
      <section className={styles.section}>
        <PersonRow person={request.passenger} caption={t("ride.role.passenger")} />
        {request.rider && <PersonRow person={request.rider} caption={t("ride.role.rider")} />}
        {request.vehicle && <VehicleLine vehicle={request.vehicle} />}
        <ContactRow phone={request.phone} name={(request.role === "PASSENGER" ? request.rider : request.passenger)?.name} />
      </section>

      {isOpen && request.mine && (
        <div className={styles.actions}>
          <Link to={`/ride/requests/${request.id}/edit`} className={buttonStyles.secondary}>
            {t("ride.actions.edit")}
          </Link>
          <button type="button" className={buttonStyles.secondary} onClick={() => setUpgradeOpen(true)}>
            {t("ride.actions.upgrade")}
          </button>
          <button type="button" className={buttonStyles.secondary} onClick={() => setDeleteOpen(true)}>
            {t("ride.actions.delete")}
          </button>
        </div>
      )}
      {isOpen && !request.mine && (
        <div className={styles.sticky}>
          {rider?.canOffer ? (
            <button type="button" className={buttonStyles.primary} onClick={() => setAcceptOpen(true)}>
              {t("ride.actions.accept")}
            </button>
          ) : (
            <p className={styles.muted}>{t("ride.onlyRidersAccept")}</p>
          )}
        </div>
      )}
      {request.mine && TERMINAL.includes(request.status) && (
        <Link to={`/ride/requests/new?from=${request.id}`} className={buttonStyles.secondary}>
          {t("activity.actions.createAgain")}
        </Link>
      )}
      {participant && !isOpen && (
        <RideActions
          activityId={request.id}
          status={request.status}
          subStatus={request.subStatus}
          completionRequestedBy={request.completionRequestedBy}
          chatId={request.chatId}
          onChanged={reload}
        />
      )}

      {acceptOpen && rider && <AcceptSheet request={request} rider={rider} onClose={() => setAcceptOpen(false)} onDone={reload} />}
      {upgradeOpen && <UpgradeSheet request={request} onClose={() => setUpgradeOpen(false)} onDone={reload} />}
      <ConfirmSheet
        title={t("ride.actions.deleteTitle")}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        confirmLabel={t("ride.actions.delete")}
        onConfirm={async () => {
          await deleteActivity(request.id);
          toast.show(t("ride.actions.deleted"));
          void navigate("/ride", { replace: true });
        }}
      />
    </div>
  );
}

// The rider chooses one of their approved vehicles with enough seats (Q5).
function AcceptSheet({
  request,
  rider,
  onClose,
  onDone,
}: {
  request: RideRequest;
  rider: NonNullable<ReturnType<typeof useRiderStatus>>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const fits = rider.vehicles.filter((v) => v.seatCapacity >= request.passengerCount);
  const [vehicleId, setVehicleId] = useState(fits.length === 1 ? fits[0].id : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptRequest(request.id, vehicleId);
      toast.show(t("ride.actions.accepted"));
      onClose();
      onDone();
    } catch (failure) {
      setError(formErrors(failure, t).form ?? Object.values(formErrors(failure, t).fields)[0] ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={t("ride.actions.acceptTitle")} open onClose={onClose}>
      {error && <FormAlert>{error}</FormAlert>}
      {fits.length === 0 && <FormAlert>{t("ride.noVehicleFits", { count: request.passengerCount })}</FormAlert>}
      <div role="radiogroup" aria-label={t("ride.form.vehicle")} className={styles.actions}>
        {rider.vehicles.map((v) => {
          const fit = v.seatCapacity >= request.passengerCount;
          return (
            <label key={v.id} className={fit ? styles.choice : `${styles.choice} ${styles.choiceDisabled}`}>
              <input type="radio" name="vehicle" value={v.id} checked={vehicleId === v.id} disabled={!fit} onChange={() => setVehicleId(v.id)} />
              <span>
                {t(`ride.vehicleType.${v.type}`)} · {v.brand} {v.model} · {t("ride.seatsCount", { count: v.seatCapacity })}
              </span>
            </label>
          );
        })}
      </div>
      <div className={formStyles.sheetButtons}>
        <button type="button" className={buttonStyles.secondary} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className={buttonStyles.primary} disabled={!vehicleId || busy} onClick={() => void accept()}>
          {t("ride.actions.accept")}
        </button>
      </div>
    </BottomSheet>
  );
}

function UpgradeSheet({ request, onClose, onDone }: { request: RideRequest; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [amount, setAmount] = useState(String(request.offeredAmount + 10));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await upgradeRequest(request.id, Number(amount));
      toast.show(t("ride.form.saved"));
      onClose();
      onDone();
    } catch (failure) {
      const errors = formErrors(failure, t);
      setError(errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic"));
    }
  };
  return (
    <BottomSheet title={t("ride.actions.upgrade")} open onClose={onClose}>
      {error && <FormAlert>{error}</FormAlert>}
      <label className={formStyles.field}>
        <span className={formStyles.label}>{t("ride.form.offeredAmount")}</span>
        <input className={styles.select} type="number" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <button type="button" className={buttonStyles.primary} onClick={() => void save()}>
        {t("ride.form.save")}
      </button>
    </BottomSheet>
  );
}

// --- Ride offer

export function OfferDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { value: offer, error, reload } = useLoad(useCallback(() => getOffer(id).then((r) => r.offer), [id]));
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"stop" | "cancel" | "remove" | null>(null);
  const [reason, setReason] = useState("");

  if (!offer) return <LoadState error={error} title={t("ride.kind.offer")} />;
  const open = offer.status === "OPEN" && new Date(offer.departureTime) > new Date();
  const myBooking = offer.myBooking;
  const activeBookings = (offer.bookings ?? []).filter((b) => ["ACCEPTED", "IN_PROGRESS", "DISPUTED"].includes(b.status));
  const canBook = !offer.mine && open && (!myBooking || !["ACCEPTED", "IN_PROGRESS", "DISPUTED"].includes(myBooking.status));

  const book = async () => {
    setBusy(true);
    setBookError(null);
    try {
      const result = await bookOffer(offer.id, seats);
      toast.show(t("ride.actions.booked"));
      void navigate(`/ride/bookings/${result.booking.activityId}`);
    } catch (failure) {
      setBookError(formErrors(failure, t).form ?? t("errors.generic"));
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.narrow}>
      <SubPageHeader title={t("ride.kind.offer")} back="/ride" action={<span className={styles.kind}>{t(`ride.postStatus.${offer.status}`)}</span>} />
      <OfferSummary offer={offer} />

      {offer.mine && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t("ride.bookings.title", { count: activeBookings.length })}</h2>
          {(offer.bookings ?? []).length === 0 && <p className={styles.muted}>{t("ride.bookings.none")}</p>}
          {(offer.bookings ?? []).map((booking) => (
            <div key={booking.activityId} className={styles.bookingRow}>
              <div className={styles.row}>
                {booking.passenger && <PersonRow person={booking.passenger} caption={t("ride.seatsCount", { count: booking.seatsBooked })} />}
                <StatusChip status={booking.status} />
              </div>
              <ContactRow phone={booking.phone} name={booking.passenger?.name} />
              <Link to={`/ride/bookings/${booking.activityId}`} className={buttonStyles.secondary}>
                {t("ride.bookings.openOne")}
              </Link>
            </div>
          ))}
        </section>
      )}

      {offer.mine && offer.status === "CLOSED" && activeBookings.length === 0 && (
        <Link to={`/ride/offers/new?from=${offer.id}`} className={buttonStyles.secondary}>
          {t("activity.actions.createAgain")}
        </Link>
      )}

      {offer.mine && offer.status !== "CLOSED" && (
        <div className={styles.actions}>
          <Link to={`/ride/offers/${offer.id}/edit`} className={buttonStyles.secondary}>
            {activeBookings.length > 0 ? t("ride.actions.addSeats") : t("ride.actions.edit")}
          </Link>
          {activeBookings.length > 0 ? (
            <>
              <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("stop")}>
                {t("ride.actions.stop")}
              </button>
              <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("cancel")}>
                {t("ride.actions.cancelOffer")}
              </button>
            </>
          ) : (
            <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("remove")}>
              {t("ride.actions.removeOffer")}
            </button>
          )}
        </div>
      )}

      {myBooking && (
        <section className={styles.section}>
          <div className={styles.row}>
            <span>{t("ride.bookings.yours", { count: myBooking.seatsBooked, amount: taka(myBooking.amount, i18n.language) })}</span>
            <StatusChip status={myBooking.status} />
          </div>
          <ContactRow phone={myBooking.phone} name={offer.rider.name} />
          <Link to={`/ride/bookings/${myBooking.activityId}`} className={buttonStyles.secondary}>
            {t("ride.bookings.open")}
          </Link>
        </section>
      )}

      {canBook && (
        <section className={`${styles.section} ${styles.sticky}`}>
          {bookError && <FormAlert>{bookError}</FormAlert>}
          <div className={styles.row}>
            <span>{t("ride.bookings.seats")}</span>
            <span className={styles.stepper}>
              <button type="button" className={styles.stepButton} aria-label={t("ride.bookings.fewer")} disabled={seats <= 1} onClick={() => setSeats(seats - 1)}>
                −
              </button>
              <span aria-live="polite">{seats}</span>
              <button
                type="button"
                className={styles.stepButton}
                aria-label={t("ride.bookings.more")}
                disabled={seats >= offer.seatsAvailable}
                onClick={() => setSeats(seats + 1)}
              >
                +
              </button>
            </span>
          </div>
          <button type="button" className={buttonStyles.primary} disabled={busy || offer.seatsAvailable < 1} onClick={() => void book()}>
            {t("ride.actions.book", { amount: taka(offer.farePerSeat * seats, i18n.language) })}
          </button>
        </section>
      )}

      <ConfirmSheet
        title={t(`ride.offerSheet.${sheet ?? "stop"}.title`)}
        open={sheet !== null}
        onClose={() => setSheet(null)}
        confirmLabel={t(sheet === "cancel" ? "ride.actions.cancelOffer" : sheet === "remove" ? "ride.actions.removeOffer" : "ride.actions.stop")}
        onConfirm={async () => {
          if (sheet === "stop") await stopOffer(offer.id);
          if (sheet === "remove") await removeOffer(offer.id);
          if (sheet === "cancel") await cancelOffer(offer.id, reason.trim());
          setSheet(null);
          toast.show(t("ride.form.saved"));
          reload();
        }}
      >
        <p className={styles.muted}>{t(`ride.offerSheet.${sheet ?? "stop"}.hint`)}</p>
        {sheet === "cancel" && <ReasonField value={reason} onChange={setReason} />}
      </ConfirmSheet>
    </div>
  );
}

function OfferSummary({ offer }: { offer: RideOffer }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <section className={styles.section}>
        <div className={styles.row}>
          <span>{formatRideTime(offer.departureTime, i18n.language)}</span>
          <span className={styles.amount}>{t("ride.perSeat", { amount: taka(offer.farePerSeat, i18n.language) })}</span>
        </div>
        <Route pickup={offer.pickup} destination={offer.destination} />
        <span className={styles.meta}>
          <span>{t("ride.seatsLeft", { count: offer.seatsAvailable })}</span>
          {offer.subArea && <span>{offer.subArea.name}</span>}
          {offer.routeDistanceKm !== null && <span>{t("ride.distance", { km: taka(offer.routeDistanceKm, i18n.language) })}</span>}
        </span>
        {offer.notes && <p>{offer.notes}</p>}
      </section>
      <section className={styles.section}>
        <PersonRow person={offer.rider} caption={t("ride.role.rider")} />
        <VehicleLine vehicle={offer.vehicle} />
      </section>
    </>
  );
}

// --- One booking (rider or passenger)

export function BookingDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { value: booking, error, reload } = useLoad(useCallback(() => getBooking(id).then((r) => r.booking), [id]));
  if (!booking) return <LoadState error={error} title={t("ride.booking.title")} />;
  return <BookingView booking={booking} reload={reload} language={i18n.language} />;
}

function BookingView({ booking, reload, language }: { booking: RideBooking; reload: () => void; language: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.narrow}>
      <SubPageHeader title={t("ride.booking.title")} back={`/ride/offers/${booking.offer.id}`} action={<StatusChip status={booking.status} />} />
      <OfferSummary offer={booking.offer} />
      <section className={styles.section}>
        <div className={styles.row}>
          <span>{t("ride.seatsCount", { count: booking.seatsBooked })}</span>
          <span className={styles.amount}>{t("ride.total", { amount: taka(booking.amount, language) })}</span>
        </div>
        {booking.role === "RIDER" && booking.passenger && <PersonRow person={booking.passenger} caption={t("ride.role.passenger")} />}
        <ContactRow phone={booking.phone} name={booking.role === "RIDER" ? booking.passenger?.name : booking.rider?.name} />
      </section>
      <RideActions
        activityId={booking.activityId}
        status={booking.status}
        subStatus={booking.subStatus}
        completionRequestedBy={booking.completionRequestedBy}
        chatId={booking.chatId}
        onChanged={reload}
      />
    </div>
  );
}
