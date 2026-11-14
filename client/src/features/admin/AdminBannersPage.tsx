import { Image, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonStyles, EmptyState, PageHeader, Section } from "../../components/ui";
import type { Banner } from "../content/content-api";
import { adminContentApi } from "../content/content-api";
import {
  adminError,
  ConfirmSheet,
  formatDateTime,
  Loaded,
  SelectField,
  useLoad,
} from "./admin-ui";
import styles from "./admin.module.css";

// Admin › Banners (B8): list, create, edit and delete banners.

type FormState = {
  title: string;
  imageUrl: string;
  linkUrl: string;
  startsAt: string;
  endsAt: string;
  sortOrder: string;
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
  imageUrl: "",
  linkUrl: "",
  startsAt: toLocal(new Date()),
  endsAt: toLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  sortOrder: "0",
  isActive: true,
});

function formFromItem(item: Banner): FormState {
  return {
    title: item.title,
    imageUrl: item.imageUrl,
    linkUrl: item.linkUrl ?? "",
    startsAt: toLocal(item.startsAt),
    endsAt: toLocal(item.endsAt),
    sortOrder: String(item.sortOrder),
    isActive: item.isActive,
  };
}

function formToBody(form: FormState) {
  return {
    title: form.title.trim(),
    imageUrl: form.imageUrl.trim(),
    linkUrl: form.linkUrl.trim() || undefined,
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : new Date().toISOString(),
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : new Date().toISOString(),
    sortOrder: parseInt(form.sortOrder, 10) || 0,
    isActive: form.isActive,
  };
}

function BannerForm({ form, onChange }: { form: FormState; onChange: (f: FormState) => void }) {
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
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.imageUrl")} *
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
          {t("admin.content.linkUrl")}
        </label>
        <input
          type="url"
          value={form.linkUrl}
          onChange={(e) => onChange({ ...form, linkUrl: e.target.value })}
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
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.sortOrder")}
        </label>
        <input
          type="number"
          value={form.sortOrder}
          onChange={(e) => onChange({ ...form, sortOrder: e.target.value })}
          style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
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

export function AdminBannersPage() {
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminContentApi.listBanners(), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(emptyForm());
  const [editItem, setEditItem] = useState<Banner | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [deleteItem, setDeleteItem] = useState<Banner | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <PageHeader title={t("admin.content.banners")} />
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
          {(items: Banner[]) =>
            items.length === 0 ? (
              <EmptyState
                icon={Image}
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
        title={t("admin.content.add") + " " + t("admin.content.banners")}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          try {
            await adminContentApi.createBanner(formToBody(createForm));
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <BannerForm form={createForm} onChange={setCreateForm} />
      </ConfirmSheet>

      {/* Edit sheet */}
      <ConfirmSheet
        title={t("admin.content.edit") + " " + t("admin.content.banners")}
        open={editItem !== null}
        onClose={() => setEditItem(null)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          if (!editItem) return;
          try {
            await adminContentApi.updateBanner(editItem.id, formToBody(editForm));
            setEditItem(null);
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <BannerForm form={editForm} onChange={setEditForm} />
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
            await adminContentApi.deleteBanner(deleteItem.id);
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
