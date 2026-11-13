import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, FormAlert } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { raiseDispute, type DisputeKind } from "./dispute-api";

export function RaiseDisputeSheet({
  activityId,
  open,
  onClose,
  onRaised,
  allowKind,
}: {
  activityId: string;
  open: boolean;
  onClose: () => void;
  onRaised: () => void;
  allowKind?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [kind, setKind] = useState<DisputeKind>("COMPLAINT");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind("COMPLAINT");
    setReason("");
    setDescription("");
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError(t("dispute.reasonTooShort"));
      return;
    }
    if (description.trim().length < 3) {
      setError(t("dispute.descriptionTooShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await raiseDispute({
        activityId,
        kind: allowKind ? kind : undefined,
        reason: reason.trim(),
        description: description.trim(),
      });
      toast.show(t("dispute.raised"));
      onClose();
      onRaised();
    } catch (failure) {
      const errors = formErrors(failure, t);
      setError(errors.form ?? Object.values(errors.fields)[0] ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={t("dispute.raiseTitle")} open={open} onClose={onClose}>
      <form className={formStyles.sheetBody} onSubmit={(event) => void submit(event)} noValidate>
        {allowKind && (
          <div>
            <p className={formStyles.label}>{t("dispute.kind")}</p>
            <div role="radiogroup" aria-label={t("dispute.kind")}>
              {(["COMPLAINT", "COMPLETION_DISPUTE"] as DisputeKind[]).map((k) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36 }}>
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  {t(`dispute.kinds.${k}`)}
                </label>
              ))}
            </div>
          </div>
        )}

        <label className={formStyles.field}>
          <span className={formStyles.label}>{t("dispute.reason")}</span>
          <div className={formStyles.control}>
            <input
              className={formStyles.input}
              type="text"
              value={reason}
              maxLength={200}
              placeholder={t("dispute.reasonHint")}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </div>
        </label>

        <label className={formStyles.field}>
          <span className={formStyles.label}>{t("dispute.description")}</span>
          <textarea
            style={{
              width: "100%",
              minHeight: 120,
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
            maxLength={2000}
            placeholder={t("dispute.descriptionHint")}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </label>

        {error && <FormAlert>{error}</FormAlert>}

        <div className={formStyles.sheetButtons}>
          <button type="button" className={buttonStyles.secondary} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className={buttonStyles.primary} disabled={busy} aria-busy={busy || undefined}>
            {t("dispute.submit")}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
