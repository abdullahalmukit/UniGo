import { CheckCircle2, Clock, Receipt, Store } from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { ContactRow } from "../../components/ContactRow";
import { BottomSheet, FormAlert, TextField } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { StatusChip } from "../../components/StatusChip";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { formatRideTime } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { SkeletonList, SubPageHeader } from "../account/SubPage";
import { PaymentCard } from "../activity/PaymentCard";
import { ReviewPanel } from "../activity/ReviewPanel";
import { linkUrl } from "../inbox/chat-api";
import { shrinkImage } from "../profile/shrink-image";
import { deleteActivity } from "../ride/ride-api";
import { PersonRow, Route, taka } from "../ride/RideCard";
import styles from "../ride/ride.module.css";
import {
  acceptFood,
  askApproval,
  confirmOrder,
  decideApproval,
  getFood,
  saveOrder,
  upgradeFood,
  uploadReceipt,
  type FoodRequest,
  type PaymentMethod,
} from "./food-api";
import { FoodActions, FoodAmount, TextAreaField, useFoodConfig } from "./food-shared";
import foodStyles from "./food.module.css";

const TERMINAL = ["COMPLETED", "CANCELLED", "EXPIRED", "NOT_MARKED"];
const METHODS: PaymentMethod[] = ["CASH", "BKASH", "NAGAD"];

const errorText = (failure: unknown, t: Parameters<typeof formErrors>[1]) => {
  const errors = formErrors(failure, t);
  return errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic");
};

// A food request (proposal 10.3): details, the order both confirm, the
// over-budget approval, the receipt, completion, payment and reviews. The
// server decides every step; this page only offers the steps that fit.
export function FoodDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const [request, setRequest] = useState<FoodRequest | null>(null);
  const [error, setError] = useState<"NOT_FOUND" | "FAILED" | null>(null);
  const [sheet, setSheet] = useState<"accept" | "delete" | "upgrade" | null>(null);

  const reload = useCallback(() => {
    getFood(id)
      .then((r) => (setRequest(r.request), setError(null)))
      .catch((failure) => setError(failure instanceof ApiError && failure.status === 404 ? "NOT_FOUND" : "FAILED"));
  }, [id]);
  useEffect(reload, [reload]);

  if (!request) {
    return (
      <div className={styles.narrow}>
        <SubPageHeader title={t("food.detailTitle")} back="/food" />
        {error ? <FormAlert>{error === "NOT_FOUND" ? t("food.notFound") : t("food.loadFailed")}</FormAlert> : <SkeletonList rows={4} />}
      </div>
    );
  }
  const isOpen = request.status === "OPEN";
  const participant = request.role !== null;
  const other = request.role === "REQUESTER" ? request.accepter : request.requester;
  // Reload the payment card whenever a step may have changed the amounts
  const paymentKey = `${request.status}-${request.subStatus}-${request.order?.version ?? 0}-${request.receipts.length}`;

  return (
    <div className={styles.narrow}>
      <SubPageHeader title={t("food.detailTitle")} back="/food" action={<StatusChip status={request.status} />} />
      <section className={styles.section}>
        <div className={styles.row}>
          <span className={styles.kind}>
            <Store aria-hidden size={14} /> {request.restaurantName}
          </span>
          <FoodAmount foodPrice={request.estimatedBudget} deliveryCharge={request.deliveryCharge} />
        </div>
        <span>{t("food.deliverBy", { time: formatRideTime(request.expectedDeliveryTime, i18n.language) })}</span>
        <p>{t("food.itemsLine", { items: request.items, count: request.quantity })}</p>
        <p className={styles.muted}>{request.details}</p>
        <span className={styles.muted}>{t("food.restaurantAt", { address: request.restaurant.address })}</span>
        <Route pickup={request.pickup} destination={request.delivery} />
        <span className={styles.meta}>
          <span>{t("food.budgetLine", { amount: taka(request.estimatedBudget, i18n.language) })}</span>
          <span>{request.subArea.name}</span>
        </span>
      </section>
      <section className={styles.section}>
        <PersonRow person={request.requester} caption={t("food.role.requester")} />
        {request.accepter && <PersonRow person={request.accepter} caption={t("food.role.accepter")} />}
        <ContactRow phone={request.phone} name={other?.name} />
      </section>

      {isOpen && request.mine && (
        <div className={styles.actions}>
          <Link to={`/food/requests/${request.id}/edit`} className={buttonStyles.secondary}>
            {t("ride.actions.edit")}
          </Link>
          <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("upgrade")}>
            {t("food.actions.upgrade")}
          </button>
          <button type="button" className={buttonStyles.secondary} onClick={() => setSheet("delete")}>
            {t("ride.actions.delete")}
          </button>
        </div>
      )}
      {isOpen && !request.mine && (
        <div className={styles.sticky}>
          <button type="button" className={buttonStyles.primary} onClick={() => setSheet("accept")}>
            {t("food.actions.accept")}
          </button>
        </div>
      )}

      {participant && !isOpen && (
        <>
          <OrderPanel request={request} onChanged={setRequest} />
          <ApprovalPanel request={request} onChanged={setRequest} />
          <ReceiptPanel request={request} onChanged={setRequest} />
          <PaymentCard key={paymentKey} activityId={request.id} />
        </>
      )}
      {participant && request.status === "COMPLETED" && <ReviewPanel activityId={request.id} />}
      {request.mine && TERMINAL.includes(request.status) && (
        <Link to={`/food/requests/new?from=${request.id}`} className={buttonStyles.secondary}>
          {t("activity.actions.createAgain")}
        </Link>
      )}
      {participant && !isOpen && (
        <FoodActions
          activityId={request.id}
          status={request.status}
          subStatus={request.subStatus}
          role={request.role}
          completionRequestedBy={request.completionRequestedBy}
          chatId={request.chatId}
          onChanged={reload}
        />
      )}

      <ConfirmSheet
        title={t("food.actions.acceptTitle")}
        open={sheet === "accept"}
        onClose={() => setSheet(null)}
        confirmLabel={t("food.actions.accept")}
        onConfirm={async () => {
          const result = await acceptFood(request.id);
          setSheet(null);
          setRequest(result.request);
          toast.show(t("food.actions.accepted"));
        }}
      >
        <p className={styles.muted}>{t("food.actions.acceptHint")}</p>
      </ConfirmSheet>
      <ConfirmSheet
        title={t("food.actions.deleteTitle")}
        open={sheet === "delete"}
        onClose={() => setSheet(null)}
        confirmLabel={t("ride.actions.delete")}
        onConfirm={async () => {
          await deleteActivity(request.id);
          toast.show(t("ride.actions.deleted"));
          void navigate("/food", { replace: true });
        }}
      />
      {sheet === "upgrade" && <UpgradeSheet request={request} onClose={() => setSheet(null)} onDone={setRequest} />}
    </div>
  );
}

function UpgradeSheet({ request, onClose, onDone }: { request: FoodRequest; onClose: () => void; onDone: (r: FoodRequest) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [amount, setAmount] = useState(String(Math.max(request.deliveryCharge + 10, 10)));
  const [error, setError] = useState<string | null>(null);
  return (
    <BottomSheet title={t("food.actions.upgrade")} open onClose={onClose}>
      {error && <FormAlert>{error}</FormAlert>}
      <TextField label={t("food.form.deliveryCharge")} type="number" inputMode="decimal" value={amount} onChange={setAmount} />
      <button
        type="button"
        className={buttonStyles.primary}
        onClick={async () => {
          try {
            onDone((await upgradeFood(request.id, Number(amount))).request);
            toast.show(t("food.form.saved"));
            onClose();
          } catch (failure) {
            setError(errorText(failure, t));
          }
        }}
      >
        {t("food.form.save")}
      </button>
    </BottomSheet>
  );
}

// 10.3 step 3: either side fills in the order; the other confirms. A change
// after confirming needs confirming again (B4).
function OrderPanel({ request, onChanged }: { request: FoodRequest; onChanged: (r: FoodRequest) => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const order = request.order;
  const editable = request.status === "ACCEPTED";
  const confirmed = request.subStatus === "ORDER_CONFIRMED";
  if (!editable && !order) return null;

  const confirm = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const result = await confirmOrder(request.id, order.version);
      onChanged(result.request);
      toast.show(result.request.subStatus === "ORDER_CONFIRMED" ? t("food.order.confirmedToast") : t("food.order.savedToast"));
    } catch (failure) {
      toast.show(errorText(failure, t), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={foodStyles.panel} aria-labelledby="food-order">
      <div className={styles.row}>
        <h2 id="food-order" className={foodStyles.title}>
          {t("food.order.title")}
        </h2>
        {order && (
          <span className={confirmed || (order.confirmedByMe && order.confirmedByOther) ? foodStyles.ok : foodStyles.waiting}>
            {confirmed ? <CheckCircle2 aria-hidden size={16} /> : <Clock aria-hidden size={16} />}{" "}
            {confirmed ? t("food.order.confirmed") : order.confirmedByMe ? t("food.order.waitingOther") : t("food.order.needsYou")}
          </span>
        )}
      </div>
      {!order && <p className={styles.muted}>{t("food.order.empty")}</p>}
      {order && (
        <dl className={foodStyles.facts}>
          <dt>{t("food.form.items")}</dt>
          <dd>{order.items}</dd>
          <dt>{t("food.order.foodPrice")}</dt>
          <dd>৳{taka(order.foodPrice ?? 0, i18n.language)}</dd>
          <dt>{t("food.form.deliveryCharge")}</dt>
          <dd>৳{taka(order.deliveryCharge ?? 0, i18n.language)}</dd>
          <dt>{t("payment.method")}</dt>
          <dd>{order.paymentMethod ? t(`payment.methods.${order.paymentMethod}`) : "-"}</dd>
        </dl>
      )}
      {editable && (
        <div className={styles.actions}>
          {order && !confirmed && !order.confirmedByMe && (
            <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void confirm()}>
              {t("food.order.confirm")}
            </button>
          )}
          <button type="button" className={buttonStyles.secondary} onClick={() => setEditing(true)}>
            {order ? t("food.order.change") : t("food.order.fill")}
          </button>
        </div>
      )}
      {editable && confirmed && <p className={styles.muted}>{t("food.order.changeHint")}</p>}
      {editing && <OrderSheet request={request} onClose={() => setEditing(false)} onDone={onChanged} />}
    </section>
  );
}

function OrderSheet({ request, onClose, onDone }: { request: FoodRequest; onClose: () => void; onDone: (r: FoodRequest) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const config = useFoodConfig();
  const order = request.order;
  const [items, setItems] = useState(order?.items ?? request.items);
  const [price, setPrice] = useState(String(order?.foodPrice ?? request.estimatedBudget));
  const [charge, setCharge] = useState(String(order?.deliveryCharge ?? request.deliveryCharge));
  const [method, setMethod] = useState<PaymentMethod | null>(order?.paymentMethod ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!method) return setError(t("food.order.chooseMethod"));
    setBusy(true);
    try {
      onDone((await saveOrder(request.id, { items: items.trim(), foodPrice: Number(price), deliveryCharge: Number(charge || 0), paymentMethod: method })).request);
      toast.show(t("food.order.savedToast"));
      onClose();
    } catch (failure) {
      setError(errorText(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={t("food.order.title")} open onClose={onClose}>
      {error && <FormAlert>{error}</FormAlert>}
      <p className={styles.muted}>{t("food.order.sheetHint")}</p>
      <TextAreaField label={t("food.form.items")} value={items} max={config?.itemsMaxLength ?? 1000} onChange={setItems} />
      <div className={styles.grid2}>
        <TextField label={t("food.order.foodPrice")} type="number" inputMode="decimal" value={price} onChange={setPrice} />
        <TextField label={t("food.form.deliveryCharge")} type="number" inputMode="decimal" value={charge} onChange={setCharge} />
      </div>
      <div className={foodStyles.methods} role="radiogroup" aria-label={t("payment.method")}>
        {METHODS.map((value) => (
          <button key={value} type="button" role="radio" aria-checked={method === value} className={foodStyles.method} onClick={() => setMethod(value)}>
            {t(`payment.methods.${value}`)}
          </button>
        ))}
      </div>
      <div className={formStyles.sheetButtons}>
        <button type="button" className={buttonStyles.secondary} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void save()}>
          {t("food.order.save")}
        </button>
      </div>
    </BottomSheet>
  );
}

// 10.4: a higher price is approved by the requester before buying (B4 Q1).
function ApprovalPanel({ request, onChanged }: { request: FoodRequest; onChanged: (r: FoodRequest) => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirmed = request.status === "ACCEPTED" && request.subStatus === "ORDER_CONFIRMED";
  const pending = request.approvals.find((a) => a.status === "PENDING");
  if (request.approvals.length === 0 && !(confirmed && request.role === "ACCEPTER")) return null;

  const decide = async (approve: boolean) => {
    if (!pending) return;
    try {
      onChanged((await decideApproval(request.id, pending.id, approve)).request);
      toast.show(approve ? t("food.approval.approvedToast") : t("food.approval.rejectedToast"));
    } catch (failure) {
      toast.show(errorText(failure, t), "error");
    }
  };

  return (
    <section className={foodStyles.panel} aria-labelledby="food-approval">
      <h2 id="food-approval" className={foodStyles.title}>
        {t("food.approval.title")}
      </h2>
      <ul className={foodStyles.approvals}>
        {request.approvals.map((a) => (
          <li key={a.id}>
            {t("food.approval.line", { from: taka(a.previousAmount, i18n.language), to: taka(a.amount, i18n.language) })} ·{" "}
            <strong>{t(`food.approval.status.${a.status}`)}</strong>
          </li>
        ))}
      </ul>
      {pending && confirmed && request.role === "REQUESTER" && (
        <div className={styles.actions}>
          <button type="button" className={buttonStyles.primary} onClick={() => void decide(true)}>
            {t("food.approval.approve")}
          </button>
          <button type="button" className={buttonStyles.secondary} onClick={() => void decide(false)}>
            {t("food.approval.reject")}
          </button>
        </div>
      )}
      {pending && request.role === "ACCEPTER" && <p className={styles.muted}>{t("food.approval.waiting")}</p>}
      {confirmed && request.role === "ACCEPTER" && !pending && (
        <button type="button" className={buttonStyles.secondary} onClick={() => setAsking(true)}>
          {t("food.approval.ask")}
        </button>
      )}
      {asking && (
        <BottomSheet title={t("food.approval.ask")} open onClose={() => setAsking(false)}>
          {error && <FormAlert>{error}</FormAlert>}
          <p className={styles.muted}>{t("food.approval.askHint", { amount: taka(request.order?.foodPrice ?? 0, i18n.language) })}</p>
          <TextField label={t("food.approval.newPrice")} type="number" inputMode="decimal" value={amount} onChange={setAmount} />
          <button
            type="button"
            className={buttonStyles.primary}
            onClick={async () => {
              try {
                onChanged((await askApproval(request.id, Number(amount))).request);
                toast.show(t("food.approval.askedToast"));
                setAsking(false);
              } catch (failure) {
                setError(errorText(failure, t));
              }
            }}
          >
            {t("food.approval.send")}
          </button>
        </BottomSheet>
      )}
    </section>
  );
}

// 10.3 step 4: the accepter uploads the receipt with the actual cost.
function ReceiptPanel({ request, onChanged }: { request: FoodRequest; onChanged: (r: FoodRequest) => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [cost, setCost] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canUpload = request.role === "ACCEPTER" && request.status === "ACCEPTED" && request.subStatus === "ORDER_CONFIRMED";
  if (!canUpload && request.receipts.length === 0) return null;

  const upload = async () => {
    if (!file || !cost.trim()) return setError(t("food.receipt.needBoth"));
    setBusy(true);
    setError(null);
    try {
      onChanged((await uploadReceipt(request.id, await shrinkImage(file, 1600), Number(cost))).request);
      toast.show(t("food.receipt.uploaded"));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "OVER_BUDGET_APPROVAL_REQUIRED") setError(t("food.receipt.overBudget"));
      else setError(errorText(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={foodStyles.panel} aria-labelledby="food-receipt">
      <h2 id="food-receipt" className={foodStyles.title}>
        <Receipt aria-hidden size={18} /> {t("food.receipt.title")}
      </h2>
      {request.receipts.map((r) => (
        <figure key={r.id} className={foodStyles.receipt}>
          <img src={linkUrl(r.image) ?? undefined} alt={t("food.receipt.alt")} loading="lazy" />
          {r.actualCost !== null && <figcaption>{t("food.receipt.cost", { amount: taka(r.actualCost, i18n.language) })}</figcaption>}
        </figure>
      ))}
      {canUpload && (
        <>
          {error && <FormAlert>{error}</FormAlert>}
          <p className={styles.muted}>{t("food.receipt.hint", { amount: taka(request.order?.foodPrice ?? 0, i18n.language) })}</p>
          <TextField label={t("food.receipt.actualCost")} type="number" inputMode="decimal" value={cost} onChange={setCost} />
          <label className={formStyles.field}>
            <span className={formStyles.label}>{t("food.receipt.photo")}</span>
            <input type="file" accept="image/jpeg,image/png" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className={buttonStyles.primary} disabled={busy} onClick={() => void upload()}>
            {t("food.receipt.upload")}
          </button>
        </>
      )}
    </section>
  );
}
