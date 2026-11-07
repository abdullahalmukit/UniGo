import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, PageHeader } from "../../components/ui";
import { useMe } from "../account/account-api";
import styles from "./ride.module.css";

// Ride Sharing is for verified students (CLAUDE.md section 4); others are
// asked to verify first. The server checks it on every call.
export function RideGate() {
  const { t } = useTranslation();
  const me = useMe();
  if (me && me.studentVerificationStatus !== "VERIFIED") {
    return (
      <div className={styles.narrow}>
        <PageHeader title={t("ride.title")} />
        <FormAlert tone="info">{t("ride.verifyFirst")}</FormAlert>
        <Link to="/verify-student" className={buttonStyles.primary}>
          {t("account.verifyNow")}
        </Link>
      </div>
    );
  }
  return <Outlet />;
}
