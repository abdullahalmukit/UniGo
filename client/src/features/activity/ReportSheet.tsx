import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, FormAlert } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { REPORT_REASONS, submitReport, type ReportReason } from "./report-api";

export function ReportSheet({
  open,
  onClose,
  activityId,
  reportedUserId,
  messageId,
}: {
  open: boolean;
  onClose: () => void;
  activityId?: string;
  reportedUserId?: string;
  messageId?: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setDescription("");
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason) {
      setError(t("report.pickReason"));
      return;
    }
    if (reason === "OTHER" && !description.trim()) {
      setError(t("report.descriptionRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitReport({
        reason,
        description: description.trim() || undefined,
        activityId,
        reportedUserId,
        messageId,
      });
      toast.show(t("report.submitted"));
      onClose();
    } catch (failure) {
      const errors = formErrors(failure, t);
      setError(errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={t("report.title")} open={open} onClose={onClose}>
      <form className={formStyles.sheetBody} onSubmit={(event) => void submit(event)} noValidate>
        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className={formStyles.label}>{t("report.reason")}</legend>
          {REPORT_REASONS.map((value) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36 }}>
              <input
                type="radio"
                name="report-reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {t(`report.reasons.${value}`)}
            </label>
          ))}
        </fieldset>

        <label className={formStyles.field}>
          <span className={formStyles.label}>
            {reason === "OTHER" ? t("report.descriptionRequired") : t("report.description")}
          </span>
          <textarea
            style={{
              width: "100%",
              minHeight: 90,
              padding: "10px 12px",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-control)",
              background: "var(--color-surface)",
              color: "var(--color-text)",
              font: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        {error && <FormAlert>{error}</FormAlert>}

        <div className={formStyles.sheetButtons}>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={buttonStyles.primary} disabled={busy} aria-busy={busy || undefined}>
            {t("report.submit")}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
