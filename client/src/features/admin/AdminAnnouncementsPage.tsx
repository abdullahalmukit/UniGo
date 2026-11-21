import { Megaphone } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert, TextField } from "../../components/form";
import { buttonStyles, EmptyState, PageHeader, Section } from "../../components/ui";
import { api } from "../../lib/api";
import { adminError, formatDateTime, Loaded, SelectField, TextAreaField, useLoad } from "./admin-ui";
import styles from "./admin.module.css";

// Admin › Notifications (proposal 17): send an announcement to everyone, one
// university or the users who saved one sub-area (in-app + push). The number
// of people is shown before sending. Moderators and Super Admins.

type Audience = { kind: "ALL" } | { kind: "UNIVERSITY"; universityId: string } | { kind: "SUB_AREA"; subAreaId: string };
type Announcement = { id: string; title: string; body: string; audience: Audience; recipients: number; sentAt: string; sentBy: string };
type Option = { id: string; name: string };

const announcementsApi = {
  list: () => api<{ announcements: Announcement[] }>("/admin/announcements").then((r) => r.announcements),
  count: (audience: Audience) => api<{ recipients: number }>("/admin/announcements/count", { method: "POST", body: { audience } }),
  send: (body: { title: string; body: string; audience: Audience }) => api<{ id: string; recipients: number }>("/admin/announcements", { method: "POST", body }),
};

export function AdminAnnouncementsPage() {
  const { t, i18n } = useTranslation();
  const [kind, setKind] = useState<Audience["kind"]>("ALL");
  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [universities, setUniversities] = useState<Option[]>([]);
  const [subAreas, setSubAreas] = useState<Option[]>([]);
  const [recipients, setRecipients] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useLoad(announcementsApi.list, []);

  useEffect(() => {
    api<{ universities: Option[] }>("/universities", { auth: false })
      .then((r) => setUniversities(r.universities))
      .catch(() => undefined);
    api<{ subAreas: Option[] }>("/sub-areas")
      .then((r) => setSubAreas(r.subAreas))
      .catch(() => undefined);
  }, []);

  const audience: Audience | null =
    kind === "ALL" ? { kind } : !targetId ? null : kind === "UNIVERSITY" ? { kind, universityId: targetId } : { kind, subAreaId: targetId };

  useEffect(() => {
    setRecipients(null);
    if (!audience) return;
    let cancelled = false;
    announcementsApi.count(audience).then(
      (r) => !cancelled && setRecipients(r.recipients),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // `audience` is rebuilt from these each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, targetId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!audience) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const result = await announcementsApi.send({ title: title.trim(), body: body.trim(), audience });
      setSent(t("admin.announcements.sent", { count: result.recipients }));
      setTitle("");
      setBody("");
      void history.reload();
    } catch (failure) {
      setError(adminError(failure, t));
    } finally {
      setBusy(false);
    }
  };

  const audienceText = (a: Audience) =>
    a.kind === "ALL"
      ? t("admin.announcements.audience.ALL")
      : a.kind === "UNIVERSITY"
        ? `${t("admin.announcements.audience.UNIVERSITY")}: ${universities.find((u) => u.id === a.universityId)?.name ?? "—"}`
        : `${t("admin.announcements.audience.SUB_AREA")}: ${subAreas.find((s) => s.id === a.subAreaId)?.name ?? "—"}`;

  return (
    <>
      <PageHeader title={t("admin.nav.announcements")} />
      <div className={styles.stack}>
        <Section title={t("admin.announcements.new")}>
          <form className={styles.stack} onSubmit={(event) => void submit(event)}>
            <SelectField
              label={t("admin.announcements.to")}
              value={kind}
              onChange={(value) => (setKind(value as Audience["kind"]), setTargetId(""))}
              options={(["ALL", "UNIVERSITY", "SUB_AREA"] as const).map((value) => ({ value, label: t(`admin.announcements.audience.${value}`) }))}
            />
            {kind !== "ALL" && (
              <SelectField
                label={t(kind === "UNIVERSITY" ? "admin.announcements.audience.UNIVERSITY" : "admin.announcements.audience.SUB_AREA")}
                value={targetId}
                onChange={setTargetId}
                options={[
                  { value: "", label: t("admin.announcements.choose") },
                  ...(kind === "UNIVERSITY" ? universities : subAreas).map((option) => ({ value: option.id, label: option.name })),
                ]}
              />
            )}
            <TextField label={t("admin.announcements.title")} value={title} onChange={setTitle} maxLength={100} required />
            <TextAreaField label={t("admin.announcements.body")} value={body} onChange={setBody} />
            {recipients !== null && <p className={styles.muted}>{t("admin.announcements.willReach", { count: recipients })}</p>}
            {error && <FormAlert>{error}</FormAlert>}
            {sent && <FormAlert tone="success">{sent}</FormAlert>}
            <button
              type="submit"
              className={buttonStyles.primary}
              disabled={busy || !audience || recipients === 0 || title.trim().length < 3 || body.trim().length < 3}
            >
              {t("admin.announcements.send")}
            </button>
          </form>
        </Section>
        <Section title={t("admin.announcements.history")}>
          <Loaded state={history.state} reload={history.reload}>
            {(items) =>
              items.length === 0 ? (
                <EmptyState icon={Megaphone} text={t("admin.announcements.none")} />
              ) : (
                <ul className={styles.list}>
                  {items.map((item) => (
                    <li key={item.id} className={styles.item}>
                      <span className={styles.itemTitle}>{item.title}</span>
                      <span>{item.body}</span>
                      <span className={styles.muted}>
                        {formatDateTime(item.sentAt, i18n.language)} · {audienceText(item.audience)} · {t("admin.announcements.people", { count: item.recipients })}
                        {item.sentBy ? ` · ${item.sentBy}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }
          </Loaded>
        </Section>
      </div>
    </>
  );
}
