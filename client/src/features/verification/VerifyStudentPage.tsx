import { IdCard, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useNext } from "../auth/use-auth-redirect";
import { AuthCard } from "../auth/AuthLayout";
import authStyles from "../auth/auth.module.css";
import formStyles from "../../components/form.module.css";

// Shown after registration. Unverified users cannot create, accept or book
// anything; the two ways to verify arrive in A6.
export function VerifyStudentPage() {
  const { t } = useTranslation();
  const next = useNext();
  const options = [
    { key: "email", icon: Mail },
    { key: "idCard", icon: IdCard },
  ] as const;

  return (
    <AuthCard title={t("auth.verify.title")} subtitle={t("auth.verify.subtitle")}>
      <ul className={authStyles.options} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {options.map(({ key, icon: Icon }) => (
          <li key={key} className={authStyles.option} aria-disabled="true">
            <span className={authStyles.optionIcon}>
              <Icon aria-hidden size={22} />
            </span>
            <span className={authStyles.optionText}>
              <span className={authStyles.optionTitle}>{t(`auth.verify.${key}`)}</span>
              <span className={authStyles.optionHint}>{t(`auth.verify.${key}Hint`)}</span>
            </span>
            <span className={authStyles.soon}>{t("auth.verify.soon")}</span>
          </li>
        ))}
      </ul>
      <div className={formStyles.actions}>
        <Link to={next} replace className={formStyles.submit} style={{ display: "grid", placeItems: "center" }}>
          {t("auth.verify.continue")}
        </Link>
      </div>
    </AuthCard>
  );
}
