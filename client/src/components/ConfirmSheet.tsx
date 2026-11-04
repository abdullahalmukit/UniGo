import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formErrors } from "../lib/errors";
import { BottomSheet, FormAlert } from "./form";
import formStyles from "./form.module.css";
import { buttonStyles } from "./ui";

// Confirm before a delete or other undoable action (CLAUDE.md UI rule). Shows
// the server's error in the sheet if the action fails.
export function ConfirmSheet({
  title,
  open,
  onClose,
  confirmLabel,
  onConfirm,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      close();
    } catch (failure) {
      const { form, fields } = formErrors(failure, t);
      setError(form ?? Object.values(fields)[0] ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet title={title} open={open} onClose={close}>
      <div className={formStyles.sheetBody}>
        {children}
        {error && <FormAlert>{error}</FormAlert>}
        <div className={formStyles.sheetButtons}>
          <button type="button" className={buttonStyles.secondary} onClick={close}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={buttonStyles.primary}
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
