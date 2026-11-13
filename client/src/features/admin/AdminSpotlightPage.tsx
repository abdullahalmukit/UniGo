import { Image, Video } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, PageHeader, Section } from "../../components/ui";
import type { SpotlightItem } from "../content/content-api";
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

// Admin › Spotlight (B8): list, create, edit and delete spotlight items.

type FormState = {
  title: string;
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  linkUrl: string;
  linkLabel: string;
  startsAt: string;
  expiresAt: string;
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
  mediaType: "IMAGE",
  mediaUrl: "",
  linkUrl: "",
  linkLabel: "",
  startsAt: toLocal(new Date()),
  expiresAt: toLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
  sortOrder: "0",
  isActive: true,
});

function formFromItem(item: SpotlightItem): FormState {
  return {
    title: item.title ?? "",
    mediaType: item.mediaType,
    mediaUrl: item.mediaUrl,
    linkUrl: item.linkUrl ?? "",
    linkLabel: item.linkLabel ?? "",
    startsAt: toLocal(item.startsAt),
    expiresAt: toLocal(item.expiresAt),
    sortOrder: String(item.sortOrder),
    isActive: item.isActive,
  };
}

function formToBody(form: FormState) {
  return {
    title: form.title.trim() || undefined,
    mediaType: form.mediaType,
    mediaUrl: form.mediaUrl.trim(),
    linkUrl: form.linkUrl.trim() || undefined,
    linkLabel: form.linkLabel.trim() || undefined,
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
    sortOrder: parseInt(form.sortOrder, 10) || 0,
    isActive: form.isActive,
  };
}

function SpotlightForm({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.stack}>
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.title")}
        </label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
        />
      </div>
      <SelectField
        label={t("admin.content.mediaType")}
        value={form.mediaType}
        onChange={(v) => onChange({ ...form, mediaType: v as "IMAGE" | "VIDEO" })}
        options={[
          { value: "IMAGE", label: t("admin.content.IMAGE") },
          { value: "VIDEO", label: t("admin.content.VIDEO") },
        ]}
      />
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.mediaUrl")} *
        </label>
        <input
          type="url"
          value={form.mediaUrl}
          onChange={(e) => onChange({ ...form, mediaUrl: e.target.value })}
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
          {t("admin.content.linkLabel")}
        </label>
        <input
          type="text"
          value={form.linkLabel}
          onChange={(e) => onChange({ ...form, linkLabel: e.target.value })}
          style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-card)", color: "var(--color-text)" }}
        />
      </div>
      <div>
        <label style={{ fontSize: "0.875rem", display: "block", marginBottom: "4px" }}>
          {t("admin.content.startsAt")}
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
          {t("admin.content.expiresAt")}
        </label>
        <input
          type="datetime-local"
          value={form.expiresAt}
          onChange={(e) => onChange({ ...form, expiresAt: e.target.value })}
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

export function AdminSpotlightPage() {
  const { t, i18n } = useTranslation();
  const { state, reload } = useLoad(() => adminContentApi.listSpotlight(), []);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(emptyForm());
  const [editItem, setEditItem] = useState<SpotlightItem | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());
  const [deleteItem, setDeleteItem] = useState<SpotlightItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t("admin.content.spotlight")} />
      <Section
        title=""
        action={
          <button
            type="button"
            onClick={() => { setCreateForm(emptyForm()); setCreateOpen(true); }}
            style={{ padding: "8px 16px", background: "var(--color-brand)", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "0.875rem" }}
          >
            {t("admin.content.add")}
          </button>
        }
      >
        <Loaded state={state} reload={reload}>
          {(items: SpotlightItem[]) =>
            items.length === 0 ? (
              <EmptyState icon={Image} text={t("admin.content.noItems")} />
            ) : (
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item.id} className={styles.item}>
                    <div className={styles.itemHeader}>
                      <span className={styles.itemTitle}>
                        {item.mediaType === "VIDEO" ? <Video aria-hidden size={16} /> : <Image aria-hidden size={16} />}{" "}
                        {item.title ?? item.mediaUrl}
                      </span>
                      <span className={styles.chip}>
                        {item.isActive ? t("admin.content.active") : t("admin.content.inactive")}
                      </span>
                    </div>
                    <span className={styles.muted}>
                      {t("admin.content.mediaType")}: {t(`admin.content.${item.mediaType}`)} · {t("admin.content.startsAt")}: {formatDateTime(item.startsAt, i18n.language)}
                      {item.expiresAt ? ` · ${t("admin.content.expiresAt")}: ${formatDateTime(item.expiresAt, i18n.language)}` : ""}
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
        title={t("admin.content.add") + " " + t("admin.content.spotlight")}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          try {
            await adminContentApi.createSpotlight(formToBody(createForm) as Parameters<typeof adminContentApi.createSpotlight>[0]);
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <SpotlightForm form={createForm} onChange={setCreateForm} />
      </ConfirmSheet>

      {/* Edit sheet */}
      <ConfirmSheet
        title={t("admin.content.edit") + " " + t("admin.content.spotlight")}
        open={editItem !== null}
        onClose={() => setEditItem(null)}
        confirmLabel={t("admin.save")}
        onConfirm={async () => {
          if (!editItem) return;
          try {
            await adminContentApi.updateSpotlight(editItem.id, formToBody(editForm));
            setEditItem(null);
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <SpotlightForm form={editForm} onChange={setEditForm} />
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
            await adminContentApi.deleteSpotlight(deleteItem.id);
            setDeleteItem(null);
            setError(null);
            void reload();
          } catch (failure) {
            setError(adminError(failure, t));
            throw failure;
          }
        }}
      >
        <p>{deleteItem?.title ?? deleteItem?.mediaUrl}</p>
      </ConfirmSheet>
    </>
  );
}
