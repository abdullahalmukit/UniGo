import { BadgeCheck, ChevronRight, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useTheme } from "../../app/theme-provider";
import { useSession } from "../../app/use-session";
import { Avatar } from "../../components/Avatar";
import { useToast } from "../../components/toast";
import { buttonStyles, Section } from "../../components/ui";
import { VerificationChip } from "../../components/VerificationChip";
import { setLanguage, type AppLanguage } from "../../i18n";
import { logoutWithPush } from "../../lib/push";
import { formErrors } from "../../lib/errors";
import type { ThemeChoice } from "../../lib/theme";
import { isAdminRole, useAdminRole } from "../admin/admin-ui";
import { getStudentVerification, type StudentVerificationStatus } from "../verification/verification-api";
import { fileUrl, updatePreferences, useMe } from "./account-api";
import styles from "./AccountPage.module.css";

// Every menu of proposal section 5. Items for later steps say "Coming soon".
const menu: { key: string; to?: string }[] = [
  { key: "profile", to: "/account/profile" },
  { key: "verification", to: "/verify-student?next=%2Faccount" },
  { key: "drive", to: "/drive" },
  { key: "savedAddresses", to: "/account/addresses" },
  { key: "subAreas", to: "/account/sub-areas" },
  { key: "paymentMethods" },
  { key: "notifications", to: "/account/notifications" },
  { key: "blocked", to: "/account/blocked" },
  { key: "promos", to: "/promos" },
  { key: "support", to: "/account/support" },
  { key: "policy" },
  { key: "rateUs" },
];

const languages: AppLanguage[] = ["bn", "en"];
const themes: ThemeChoice[] = ["light", "dark", "system"];

// Account & Settings (proposal section 5). Language and Appearance apply at
// once on this device and are saved to the account (A7).
export function AccountPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const theme = useTheme();
  const me = useMe();
  const signedIn = useSession().status === "authenticated";
  const verification = useVerificationStatus(signedIn);
  const role = useAdminRole();

  // Applied here first, so the change shows even when saving fails.
  const save = async (preferences: Parameters<typeof updatePreferences>[0]) => {
    if (!signedIn) return;
    try {
      await updatePreferences(preferences);
    } catch (failure) {
      toast.show(formErrors(failure, t).form ?? t("errors.generic"), "error");
    }
  };

  const chooseLanguage = (language: AppLanguage) => {
    setLanguage(language);
    void save({ language: language === "bn" ? "BN" : "EN" });
  };

  const chooseTheme = (choice: ThemeChoice) => {
    theme.setChoice(choice);
    void save({ theme: choice.toUpperCase() as "LIGHT" | "DARK" | "SYSTEM" });
  };

  const name = me?.profile?.fullName ?? "";

  return (
    <>
      <h1 className={styles.visuallyHidden}>{t("account.title")}</h1>

      {me && (
        <Link to="/account/profile" className={styles.profileCard}>
          <Avatar name={name} src={fileUrl(me.photo)} size={56} />
          <span className={styles.profileText}>
            <span className={styles.profileName}>{name}</span>
            <span className={styles.profileMeta}>{me.university?.shortName ?? me.university?.name}</span>
            {me.isVerifiedRider && (
              <span className={styles.riderBadge}>
                <BadgeCheck aria-hidden size={14} />
                {t("rider.badge")}
              </span>
            )}
          </span>
          <ChevronRight aria-hidden size={18} />
        </Link>
      )}

      {verification && verification !== "VERIFIED" && (
        <Link to="/verify-student?next=%2Faccount" className={styles.verificationCard}>
          <ShieldCheck aria-hidden size={22} className={styles.verificationIcon} />
          <span className={styles.verificationText}>
            <span className={styles.verificationTitle}>{t("verification.statusTitle")}</span>
            <span className={styles.verificationAction}>
              {verification === "PENDING" ? t("account.viewVerification") : t("account.verifyNow")}
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
          onChange={chooseLanguage}
        />
      </Section>

      <Section title={t("account.appearance")}>
        <Choice
          label={t("account.appearance")}
          options={themes.map((value) => ({ value, label: t(`account.theme.${value}`) }))}
          value={theme.choice}
          onChange={chooseTheme}
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
        {menu.map(({ key, to }) =>
          to ? (
            <li key={key}>
              <Link to={to} className={`${styles.menuItem} ${styles.menuLink}`}>
                <span>{t(`account.menu.${key}`)}</span>
                <span className={styles.soon}>
                  {key === "verification" && verification && <VerificationChip status={verification} />}
                  <ChevronRight aria-hidden size={18} />
                </span>
              </Link>
            </li>
          ) : (
            <li key={key} className={styles.menuItem} aria-disabled="true">
              <span className={styles.menuMuted}>{t(`account.menu.${key}`)}</span>
              <span className={styles.soonBadge}>{t("account.comingSoon")}</span>
            </li>
          ),
        )}
      </ul>

      {signedIn && (
        <button type="button" className={`${buttonStyles.secondary} ${styles.logout}`} onClick={() => void logoutWithPush()}>
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
          onClick={() => option.value !== value && onChange(option.value)}
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
