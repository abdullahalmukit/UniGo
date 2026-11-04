import { BadgeCheck, Bike, Car, CarFront, Clock, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import formStyles from "../../components/form.module.css";
import { FormAlert } from "../../components/form";
import { ToneChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles, Card, Section } from "../../components/ui";
import { formatDate } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { fileUrl } from "../account/account-api";
import settings from "../account/settings.module.css";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import { ApplicationForm } from "./ApplicationForm";
import {
  getRiderDashboard,
  getRiderOverview,
  setRiderActive,
  type ApprovalStatus,
  type RiderApplication,
  type RiderDashboard,
  type RiderOverview,
  type RiderVehicle,
} from "./rider-api";
import styles from "./rider.module.css";

// Chip colours follow the status rules: green approved, amber pending, red rejected.
const TONE: Record<ApprovalStatus, "green" | "amber" | "red"> = { APPROVED: "green", PENDING: "amber", REJECTED: "red" };

export function ApprovalChip({ status }: { status: ApprovalStatus }) {
  const { t } = useTranslation();
  return <ToneChip tone={TONE[status]} label={t(`rider.status.${status}`)} />;
}

// Drive with UniGo (proposal section 6, B1): apply, follow the review, and once
// approved, the Active switch, the Rider Dashboard, vehicles and history.
export function DrivePage() {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<RiderOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [applying, setApplying] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setOverview(await getRiderOverview());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const header = <SubPageHeader title={t("rider.title")} />;
  if (failed) {
    return (
      <div className={settings.page}>
        {header}
        <FormAlert>
          {t("rider.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className={settings.page}>
        {header}
        <SkeletonList rows={3} />
      </div>
    );
  }

  const latest = overview.latestApplication;
  const pending = latest?.status === "PENDING";

  if (applying && !pending) {
    const kind = overview.isVerifiedRider ? "REVERIFICATION" : "INITIAL";
    return (
      <div className={settings.page}>
        <SubPageHeader title={t(kind === "INITIAL" ? "rider.form.title" : "rider.form.renewTitle")} />
        <ApplicationForm
          kind={kind}
          limits={overview.limits}
          rejected={latest?.status === "REJECTED" ? overview.vehicles.filter((v) => v.status === "REJECTED") : []}
          onCancel={() => setApplying(false)}
          onSubmitted={(next) => {
            setOverview(next);
            setApplying(false);
            toast.show(t("rider.submitted"));
          }}
        />
      </div>
    );
  }

  return (
    <div className={settings.page}>
      {header}
      {!overview.studentVerified ? (
        <Card className={settings.stack}>
          <ShieldAlert aria-hidden className={styles.bigIcon} />
          <p>{t("rider.verifyFirst")}</p>
          <Link to="/verify-student?next=%2Fdrive" className={buttonStyles.primary}>
            {t("account.verifyNow")}
          </Link>
        </Card>
      ) : overview.isVerifiedRider ? (
        <RiderHome overview={overview} onChange={setOverview} onRenew={() => setApplying(true)} />
      ) : pending ? (
        <ApplicationStatus application={latest} />
      ) : (
        <>
          {latest?.status === "REJECTED" && <ApplicationStatus application={latest} />}
          <Requirements onApply={() => setApplying(true)} rejected={latest?.status === "REJECTED"} />
        </>
      )}
      {overview.vehicles.length > 0 && <Vehicles vehicles={overview.vehicles} />}
      {overview.history.length > 0 && <History history={overview.history} />}
    </div>
  );
}

function Requirements({ onApply, rejected }: { onApply: () => void; rejected: boolean }) {
  const { t } = useTranslation();
  const items = ["nid", "licence", "vehicle", "photo"] as const;
  return (
    <Card className={settings.stack}>
      <CarFront aria-hidden className={styles.bigIcon} />
      <h2 className={styles.cardTitle}>{t("rider.intro.title")}</h2>
      <p className={settings.caption}>{t("rider.intro.text")}</p>
      <ul className={styles.requirements}>
        {items.map((item) => (
          <li key={item}>{t(`rider.intro.${item}`)}</li>
        ))}
      </ul>
      <button type="button" className={buttonStyles.primary} onClick={onApply}>
        {t(rejected ? "rider.reapply" : "rider.apply")}
      </button>
    </Card>
  );
}

function ApplicationStatus({ application }: { application: RiderApplication }) {
  const { t, i18n } = useTranslation();
  return (
    <Card className={settings.stack}>
      <div className={styles.vehicleHeader}>
        <span className={styles.cardTitle}>
          {t(application.kind === "INITIAL" ? "rider.application" : "rider.reverification")}
        </span>
        <ApprovalChip status={application.status} />
      </div>
      {application.status === "PENDING" && (
        <p className={styles.notice}>
          <Clock aria-hidden size={18} />
          {t("rider.pendingText")}
        </p>
      )}
      {application.status === "REJECTED" && (
        <FormAlert>
          {t("rider.rejectedText")} <strong>{application.rejectionReason}</strong>
        </FormAlert>
      )}
      <p className={settings.caption}>{t("rider.submittedOn", { date: formatDate(application.submittedAt, i18n.language) })}</p>
    </Card>
  );
}

// An approved rider: badge, Active switch, licence, dashboard.
function RiderHome({
  overview,
  onChange,
  onRenew,
}: {
  overview: RiderOverview;
  onChange: (overview: RiderOverview) => void;
  onRenew: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const latest = overview.latestApplication;
  const renewalPending = latest?.status === "PENDING";
  const blocker = overview.activeBlocker;

  const toggle = async () => {
    setBusy(true);
    try {
      const next = await setRiderActive(!overview.riderActive);
      onChange(next);
      toast.show(t(next.riderActive ? "rider.nowActive" : "rider.nowInactive"));
    } catch (failure) {
      toast.show(formErrors(failure, t).form ?? t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className={settings.stack}>
        <span className={styles.badge}>
          <BadgeCheck aria-hidden size={18} />
          {t("rider.badge")}
        </span>
        <div className={formStyles.switchRow}>
          <span className={formStyles.switchText}>
            <span id="rider-active-label" className={settings.rowTitle}>
              {t(overview.riderActive ? "rider.active" : "rider.inactive")}
            </span>
            <span className={settings.caption}>{t("rider.activeHint")}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={overview.riderActive}
            aria-labelledby="rider-active-label"
            className={formStyles.switch}
            disabled={busy || (!overview.riderActive && blocker !== null)}
            onClick={() => void toggle()}
          />
        </div>
        {blocker && !overview.riderActive && (
          <FormAlert tone="info">
            {t(`rider.blockers.${blocker}`, {
              date: overview.riderSuspendedUntil ? formatDate(overview.riderSuspendedUntil, i18n.language) : "",
            })}
          </FormAlert>
        )}
      </Card>

      <Card className={settings.stack}>
        <div className={styles.vehicleHeader}>
          <span className={styles.cardTitle}>{t("rider.licence")}</span>
          {overview.licenceExpired && <ToneChip tone="red" label={t("rider.expired")} />}
        </div>
        <p>
          {overview.licenceExpiresOn
            ? t("rider.licenceValidUntil", { date: formatDate(overview.licenceExpiresOn, i18n.language) })
            : "—"}
        </p>
        {renewalPending ? (
          <p className={styles.notice}>
            <Clock aria-hidden size={18} />
            {t("rider.renewalPending")}
          </p>
        ) : (
          <>
            {latest?.status === "REJECTED" && latest.kind === "REVERIFICATION" && (
              <FormAlert>
                {t("rider.rejectedText")} <strong>{latest.rejectionReason}</strong>
              </FormAlert>
            )}
            <p className={settings.caption}>{t("rider.renewHint")}</p>
            <button type="button" className={buttonStyles.secondary} onClick={onRenew}>
              <ShieldCheck aria-hidden size={18} />
              {t("rider.renew")}
            </button>
          </>
        )}
      </Card>

      <Dashboard />
    </>
  );
}

function Dashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<RiderDashboard | null>(null);

  useEffect(() => {
    getRiderDashboard()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) return null;
  const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
  const counters: [string, string | number][] = [
    ["totalRides", data.totalRides],
    ["accepted", data.accepted],
    ["completed", data.completed],
    ["cancelled", data.cancelled],
    ["completionRate", percent(data.completionRate)],
    ["lateCancellationRate", percent(data.lateCancellationRate)],
    ["rating", data.rating === null ? "—" : data.rating.toFixed(1)],
    ["activeCarpoolContracts", data.activeCarpoolContracts],
    ["carpoolSessionCancellations", data.carpoolSessionCancellations],
    ["earnings", `৳${data.earnings}`],
  ];
  return (
    <Section title={t("rider.dashboard.title")}>
      <ul className={styles.counters}>
        {counters.map(([key, value]) => (
          <li key={key} className={styles.counter}>
            <span className={styles.counterValue}>{value}</span>
            <span className={settings.caption}>{t(`rider.dashboard.${key}`)}</span>
          </li>
        ))}
      </ul>
      <p className={settings.caption}>{t("rider.dashboard.empty")}</p>
    </Section>
  );
}

function Vehicles({ vehicles }: { vehicles: RiderVehicle[] }) {
  const { t } = useTranslation();
  return (
    <Section title={t("rider.myVehicles")}>
      <ul className={settings.list}>
        {vehicles.map((vehicle) => {
          const Icon = vehicle.type === "BIKE" ? Bike : Car;
          return (
            <li key={vehicle.id} className={settings.row}>
              <img src={fileUrl(vehicle.photo) ?? ""} alt="" className={styles.vehiclePhoto} />
              <span className={settings.rowText}>
                <span className={settings.rowTitle}>
                  <Icon aria-hidden size={16} /> {vehicle.brand} {vehicle.model}
                </span>
                <span className={settings.caption}>
                  {vehicle.registrationNumber} · {vehicle.colour} · {t("rider.seatsCount", { count: vehicle.seatCapacity })}
                </span>
              </span>
              <ApprovalChip status={vehicle.status} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function History({ history }: { history: RiderApplication[] }) {
  const { t, i18n } = useTranslation();
  return (
    <Section title={t("rider.history")}>
      <ul className={settings.list}>
        {history.map((application) => (
          <li key={application.id} className={settings.row}>
            <span className={settings.rowText}>
              <span className={settings.rowTitle}>
                {t(application.kind === "INITIAL" ? "rider.application" : "rider.reverification")}
              </span>
              <span className={settings.caption}>
                {formatDate(application.submittedAt, i18n.language)} ·{" "}
                {t("rider.licenceValidUntil", { date: formatDate(application.licenceExpiresOn, i18n.language) })}
              </span>
              {application.rejectionReason && <span className={settings.caption}>{application.rejectionReason}</span>}
            </span>
            <ApprovalChip status={application.status} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
