import { ChevronRight, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../app/theme-provider";
import { useSession } from "../../app/use-session";
import { buttonStyles, PageHeader, Section } from "../../components/ui";
import { setLanguage, type AppLanguage } from "../../i18n";
import { session } from "../../lib/api";
import type { ThemeChoice } from "../../lib/theme";
import styles from "./AccountPage.module.css";

const menu = [
  "profile",
  "verification",
  "drive",
  "savedAddresses",
  "subAreas",
  "paymentMethods",
  "notifications",
  "blocked",
  "promos",
  "support",
  "policy",
  "rateUs",
] as const;

const languages: AppLanguage[] = ["bn", "en"];
const themes: ThemeChoice[] = ["light", "dark", "system"];

// Placeholder Account & Settings. Language and Appearance already work; they are
// kept on this device until A7 saves them to the account.
export function AccountPage() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const signedIn = useSession().status === "authenticated";

  return (
    <>
      <PageHeader title={t("account.title")} />

      <Section title={t("account.language")}>
        <Choice
          label={t("account.language")}
          options={languages.map((value) => ({ value, label: t(`account.languages.${value}`) }))}
          value={i18n.language as AppLanguage}
          onChange={setLanguage}
        />
      </Section>

      <Section title={t("account.appearance")}>
        <Choice
          label={t("account.appearance")}
          options={themes.map((value) => ({ value, label: t(`account.theme.${value}`) }))}
          value={theme.choice}
          onChange={theme.setChoice}
        />
      </Section>

      <ul className={styles.menu}>
        {menu.map((key) => (
          <li key={key} className={styles.menuItem}>
            <span>{t(`account.menu.${key}`)}</span>
            <span className={styles.soon}>
              {t("account.comingSoon")}
              <ChevronRight aria-hidden size={18} />
            </span>
          </li>
        ))}
      </ul>

      {signedIn && (
        <button type="button" className={`${buttonStyles.secondary} ${styles.logout}`} onClick={() => void session.logout()}>
          <LogOut aria-hidden size={18} />
          {t("account.logout")}
        </button>
      )}
    </>
  );
}

// A row of radio buttons styled as a segmented control.
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.choice}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={styles.choiceOption}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
