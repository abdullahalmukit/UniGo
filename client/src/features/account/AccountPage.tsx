import { ChevronRight, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useTheme } from "../../app/theme-provider";
import { useSession } from "../../app/use-session";
import { buttonStyles, PageHeader, Section } from "../../components/ui";
import { VerificationChip } from "../../components/VerificationChip";
import { isAdminRole, useAdminRole } from "../admin/admin-ui";
import { getStudentVerification, type StudentVerificationStatus } from "../verification/verification-api";
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
// kept on this device until A7 saves them to the account. The student
// verification status shows at the top and in the menu (A6).
export function AccountPage() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const signedIn = useSession().status === "authenticated";
  const verification = useVerificationStatus(signedIn);
  const role = useAdminRole();

  return (
    <>
      <PageHeader title={t("account.title")} />

      {verification && (
        <Link to="/verify-student?next=%2Faccount" className={styles.verificationCard}>
          <ShieldCheck aria-hidden size={22} className={styles.verificationIcon} />
          <span className={styles.verificationText}>
            <span className={styles.verificationTitle}>{t("verification.statusTitle")}</span>
            <span className={styles.verificationAction}>
              {verification === "VERIFIED" || verification === "PENDING"
                ? t("account.viewVerification")
                : t("account.verifyNow")}
            </span>
          </span>
          <VerificationChip status={verification} />
          <ChevronRight aria-hidden size={18} />
        </Link>
      )}

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
        {isAdminRole(role) && (
          <li>
            <Link to="/admin" className={`${styles.menuItem} ${styles.menuLink}`}>
              <span className={styles.adminLink}>
                <LayoutDashboard aria-hidden size={18} />
                {t("account.adminPanel")}
              </span>
              <ChevronRight aria-hidden size={18} />
            </Link>
          </li>
        )}
        {menu.map((key) =>
          key === "verification" ? (
            <li key={key}>
              <Link to="/verify-student?next=%2Faccount" className={`${styles.menuItem} ${styles.menuLink}`}>
                <span>{t(`account.menu.${key}`)}</span>
                <span className={styles.soon}>
                  {verification && <VerificationChip status={verification} />}
                  <ChevronRight aria-hidden size={18} />
                </span>
              </Link>
            </li>
          ) : (
            <li key={key} className={styles.menuItem}>
              <span>{t(`account.menu.${key}`)}</span>
              <span className={styles.soon}>
                {t("account.comingSoon")}
                <ChevronRight aria-hidden size={18} />
              </span>
            </li>
          ),
        )}
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

// The logged-in user's student verification status, fresh from the server.
function useVerificationStatus(signedIn: boolean) {
  const [status, setStatus] = useState<StudentVerificationStatus | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setStatus(null);
      return;
    }
    let active = true;
    getStudentVerification()
      .then((result) => active && setStatus(result.status))
      .catch(() => active && setStatus(null));
    return () => {
      active = false;
    };
  }, [signedIn]);

  return status;
}
