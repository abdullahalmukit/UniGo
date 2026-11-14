import { Plus, TicketPercent } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonStyles, EmptyState, PageHeader, Section } from "../../components/ui";
import type { Promo } from "../content/content-api";
import { adminContentApi } from "../content/content-api";
import {
  adminError,
  ConfirmSheet,
  formatDateTime,
  Loaded,
  SelectField,
  TextAreaField,
  useLoad,
} from "./admin-ui";
import styles from "./admin.module.css";

// Admin › Promos (B8): list, create, edit and delete promos.

type FormState = {
  title: string;
  description: string;
  imageUrl: string;
  promoCode: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

const toLocal = (iso: string | Date | null | undefined) => {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const emptyForm = (): FormState => ({
  title: "",
  description: "",
  imageUrl: "",
  promoCode: "",
  startsAt: toLocal(new Date()),
  endsAt: toLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  isActive: true,
});

function formFromItem(item: Promo): FormState {
  return {
    title: item.title,
    description: item.description ?? "",
    imageUrl: item.imageUrl ?? "",
    promoCode: item.promoCode ?? "",
    startsAt: toLocal(item.startsAt),
    endsAt: toLocal(item.endsAt),
    isActive: item.isActive,
  };
}

function formToBody(form: FormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    imageUrl: form.imageUrl.trim() || undefined,
    promoCode: form.promoCode.trim() || undefined,
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : new Date().toISOString(),
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : new Date().toISOString(),
    isActive: form.isActive,
  };
}

function PromoForm({ form, onChange }: { form: FormState; onChange: (f: FormState) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.stack}>
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.title")} *
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
        />
      </div>
      <TextAreaField
        label={t("admin.content.description")}
        value={form.description}
        onChange={(v) => onChange({ ...form, description: v })}
      />
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.imageUrl")}
        </label>
        <input
          type="url"
          value={form.imageUrl}
          onChange={(e) => onChange({ ...form, imageUrl: e.target.value })}
          style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
        />
      </div>
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.promoCode")}
        </label>
        <input
          type="text"
          value={form.promoCode}
          onChange={(e) => onChange({ ...form, promoCode: e.target.value })}
          style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
        />
      </div>
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.startsAt")} *
        </label>
        <input
          type="datetime-local"
          value={form.startsAt}
          onChange={(e) => onChange({ ...form, startsAt: e.target.value })}
          style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)", fontSize: "0.875rem" }}
        />
      </div>
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.endsAt")} *
        </label>
        <input
          type="datetime-local"
          value={form.endsAt}
          onChange={(e) => onChange({ ...form, endsAt: e.target.value })}
          style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)", fontSize: "0.875rem" }}
        />
      </div>
      <SelectField
        label={t("admin.content.isActive")}
        value={form.isActive ? "true" : "false"}
        onChange={(v) => onChange({ ...form, isActive: v === "true" })}
        options={[
          { value: "true", label: t("admin.content.active") },
          { value: "false", label: t("admin.content.inactive") },
        ]}
      />
    </div>
  );
}

export function AdminPromosPage() {
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminContentApi.listPromos(), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(emptyForm());
  const [editItem, setEditItem] = useState<Promo | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [deleteItem, setDeleteItem] = useState<Promo | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <PageHeader title={t("admin.content.promos")} />
        <button
          type="button"
          onClick={() => { setCreateForm(emptyForm()); setCreateOpen(true); }}
          className={buttonStyles.primary}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
        >
          <Plus size={16} aria-hidden strokeWidth={2.5} />
          <span>{t("admin.content.add")}</span>
        </button>
      </div>
      <Section title="">
        <Loaded state={state} reload={reload}>
          {(items: Promo[]) =>
            items.length === 0 ? (
              <EmptyState
                icon={TicketPercent}
                text={t("admin.content.noItems")}
                action={
                  <button
                    type="button"
                    onClick={() => { setCreateForm(emptyForm()); setCreateOpen(true); }}
                    className={buttonStyles.primary}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "12px" }}
                  >
                    <Plus size={16} aria-hidden strokeWidth={2.5} />
                    <span>{t("admin.content.add")}</span>
                  </button>
                }
              />
            ) : (
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item.id} className={styles.item}>
                    <div className={styles.itemHeader}>
                      <span className={styles.itemTitle}>{item.title}</span>
                      <span className={styles.chip}>
                        {item.isActive ? t("admin.content.active") : t("admin.content.inactive")}
                      </span>
                    </div>
                    {item.promoCode && (
                      <span className={styles.chip} style={{ width: "fit-content" }}>{item.promoCode}</span>
                    )}
                    <span className={styles.muted}>
                      {formatDateTime(item.startsAt, i18n.language)} → {formatDateTime(item.endsAt, i18n.language)}
                    </span>
                    <div className={styles.row}>
                      <button
                        type="button"
                        onClick={() => { setEditItem(item); setEditForm(formFromItem(item)); }}
                        style={{ padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: "8px", background: "var(--color-surface)", color: "var(--color-text)", cursor: "pointer", fontSize: "0.8rem" }}
                      >
                        {t("admin.content.edit")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteItem(item)}
                        style={{ padding: "6px 12px", border: "1px solid var(--color-border)", borderRadius: "8px", background: "var(--color-surface)", color: "var(--status-red-fg)", cursor: "pointer", fontSize: "0.8rem" }}
                      >
                        {t("admin.content.delete")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </Loaded>
      </Section>

      {error && <p className={styles.muted} style={{ color: "var(--status-red-fg)" }}>{error}</p>}

      {/* Create sheet */}
      <ConfirmSheet
        title={t("admin.content.add") + " " + t("admin.content.promos")}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          try {
            await adminContentApi.createPromo(formToBody(createForm));
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <PromoForm form={createForm} onChange={setCreateForm} />
      </ConfirmSheet>

      {/* Edit sheet */}
      <ConfirmSheet
        title={t("admin.content.edit") + " " + t("admin.content.promos")}
        open={editItem !== null}
        onClose={() => setEditItem(null)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          if (!editItem) return;
          try {
            await adminContentApi.updatePromo(editItem.id, formToBody(editForm));
            setEditItem(null);
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <PromoForm form={editForm} onChange={setEditForm} />
      </ConfirmSheet>

      {/* Delete confirm */}
      <ConfirmSheet
        title={t("admin.content.deleteConfirm")}
        open={deleteItem !== null}
        onClose={() => setDeleteItem(null)}
        confirmLabel={t("admin.content.delete")}
        onConfirm={async () => {
          if (!deleteItem) return;
          try {
            await adminContentApi.deletePromo(deleteItem.id);
            setDeleteItem(null);
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <p>{deleteItem?.title}</p>
      </ConfirmSheet>
    </>
  );
}
