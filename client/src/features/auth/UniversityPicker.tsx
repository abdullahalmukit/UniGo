import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, TextField } from "../../components/form";
import formStyles from "../../components/form.module.css";
import { listUniversities, type University } from "./auth-api";
import styles from "./auth.module.css";

// The university field: a button that opens a searchable bottom sheet with the
// admin-managed list (GET /api/universities).
export function UniversityPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ status: "loading" | "failed" | "ready"; items: University[] }>({
    status: "loading",
    items: [],
  });

  const load = useCallback(() => {
    setState({ status: "loading", items: [] });
    listUniversities().then(
      (items) => setState({ status: "ready", items }),
      () => setState({ status: "failed", items: [] }),
    );
  }, []);
  useEffect(load, [load]);

  const selected = state.items.find((university) => university.id === value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.items.filter(
      (university) => !q || university.name.toLowerCase().includes(q) || university.shortName?.toLowerCase().includes(q),
    );
  }, [query, state.items]);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className={formStyles.field}>
      <span id={labelId} className={formStyles.label}>
        {t("auth.university")}
      </span>
      <button
        type="button"
        className={styles.picker}
        aria-labelledby={labelId}
        aria-haspopup="dialog"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={() => setOpen(true)}
      >
        <span className={selected ? undefined : styles.pickerPlaceholder}>
          {selected?.name ?? t("auth.universityPlaceholder")}
        </span>
        <ChevronDown aria-hidden size={20} />
      </button>
      {error && (
        <p id={errorId} className={formStyles.error}>
          {error}
        </p>
      )}

      <BottomSheet title={t("auth.university")} open={open} onClose={close}>
        <TextField label={t("auth.universitySearch")} value={query} onChange={setQuery} type="search" autoComplete="off" />
        {state.status === "failed" && (
          <p className={styles.empty}>
            {t("auth.universityLoadFailed")}{" "}
            <button type="button" className={styles.linkButton} onClick={load}>
              {t("auth.retry")}
            </button>
          </p>
        )}
        {state.status === "loading" && <p className={styles.empty}>{t("app.loading")}</p>}
        {state.status === "ready" && matches.length === 0 && <p className={styles.empty}>{t("auth.universityNone")}</p>}
        <ul role="radiogroup" aria-label={t("auth.university")} className={styles.choices}>
          {matches.map((university) => (
            <li key={university.id}>
              <button
                type="button"
                role="radio"
                aria-checked={university.id === value}
                className={styles.choice}
                onClick={() => {
                  onChange(university.id);
                  setOpen(false);
                }}
              >
                <span>
                  {university.name}
                  {university.shortName && <span className={styles.choiceShort}> · {university.shortName}</span>}
                </span>
                {university.id === value && <Check aria-hidden size={18} />}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}
