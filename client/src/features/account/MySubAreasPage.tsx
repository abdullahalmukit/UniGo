import { Check, Map as MapIcon, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert, TextField } from "../../components/form";
import { useToast } from "../../components/toast";
import { buttonStyles, EmptyState, Section } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { useDebounced } from "../../lib/use-debounced";
import { getMySubAreas, searchSubAreas, setMySubAreas, type SubArea } from "./account-api";
import { SEARCH_DEBOUNCE_MS } from "./rules";
import styles from "./settings.module.css";
import { SkeletonList, SubPageHeader } from "./SubPage";

// My Sub-Areas (proposal section 5, A7): pick from the admin master list only,
// add or remove at any time, up to the server's limit. Each change is saved at once.
export function MySubAreasPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [mine, setMine] = useState<SubArea[] | null>(null);
  const [max, setMax] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const result = await getMySubAreas();
      setMine(result.subAreas);
      setMax(result.max);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: SubArea[], message: string) => {
    setSaving(true);
    setError(null);
    try {
      const result = await setMySubAreas(next.map((s) => s.id));
      setMine(result.subAreas);
      toast.show(message);
    } catch (failure) {
      const { form, fields } = formErrors(failure, t);
      setError(form ?? Object.values(fields)[0] ?? t("errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  const selected = new Set(mine?.map((s) => s.id));
  const full = (mine?.length ?? 0) >= max;

  return (
    <div className={styles.page}>
      <SubPageHeader title={t("subAreas.title")} />
      <p className={styles.caption}>{t("subAreas.intro")}</p>
      {loadFailed && (
        <FormAlert>
          {t("subAreas.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!mine && !loadFailed && <SkeletonList rows={2} />}
      {mine && (
        <>
          <Section title={t("subAreas.selected", { count: mine.length, max })}>
            {mine.length === 0 ? (
              <EmptyState icon={MapIcon} text={t("subAreas.empty")} />
            ) : (
              <ul className={styles.chips} aria-label={t("subAreas.selectedList")}>
                {mine.map((subArea) => (
                  <li key={subArea.id} className={styles.chip}>
                    {subArea.name}
                    <button
                      type="button"
                      className={styles.chipRemove}
                      disabled={saving}
                      aria-label={t("subAreas.remove", { name: subArea.name })}
                      onClick={() =>
                        void save(
                          mine.filter((s) => s.id !== subArea.id),
                          t("subAreas.removed", { name: subArea.name }),
                        )
                      }
                    >
                      <X aria-hidden size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {error && <FormAlert>{error}</FormAlert>}
          <Section title={t("subAreas.addTitle")}>
            <SubAreaSearch
              selected={selected}
              disabled={saving}
              full={full}
              max={max}
              onAdd={(subArea) => void save([...mine, subArea], t("subAreas.added", { name: subArea.name }))}
            />
          </Section>
        </>
      )}
    </div>
  );
}

function SubAreaSearch({
  selected,
  disabled,
  full,
  max,
  onAdd,
}: {
  selected: Set<string>;
  disabled: boolean;
  full: boolean;
  max: number;
  onAdd: (subArea: SubArea) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState<SubArea[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    searchSubAreas(debounced.trim())
      .then((list) => active && setResults(list))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [debounced]);

  return (
    <div className={styles.stack}>
      <TextField
        label={t("subAreas.search")}
        value={query}
        onChange={setQuery}
        placeholder={t("subAreas.searchPlaceholder")}
        type="search"
        autoComplete="off"
        trailing={<Search aria-hidden size={18} className={styles.searchIcon} />}
      />
      {full && <p className={styles.caption}>{t("subAreas.full", { max })}</p>}
      {failed && <p className={styles.caption}>{t("subAreas.searchFailed")}</p>}
      {!results && !failed && <SkeletonList rows={2} />}
      {results && (
        <ul className={styles.results} aria-label={t("subAreas.results")}>
          {results.length === 0 && (
            <li>
              <span className={styles.result}>{t("subAreas.noResults")}</span>
            </li>
          )}
          {results.map((subArea) => {
            const isSelected = selected.has(subArea.id);
            return (
              <li key={subArea.id}>
                <button
                  type="button"
                  className={styles.result}
                  disabled={isSelected || full || disabled}
                  aria-label={isSelected ? t("subAreas.alreadyAdded", { name: subArea.name }) : t("subAreas.add", { name: subArea.name })}
                  onClick={() => onAdd(subArea)}
                >
                  {isSelected ? <Check aria-hidden size={18} /> : <Plus aria-hidden size={18} />}
                  <span>{subArea.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
