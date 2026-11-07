import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";
import { FormAlert } from "../../components/form";
import { buttonStyles, PageHeader } from "../../components/ui";
import { useMe } from "../account/account-api";
import rideStyles from "../ride/ride.module.css";

// Carpool is for verified students (CLAUDE.md section 4); the server checks
// it on every call.
export function CarpoolGate() {
  const { t } = useTranslation();
  const me = useMe();
  if (me && me.studentVerificationStatus !== "VERIFIED") {
    return (
      <div className={rideStyles.narrow}>
        <PageHeader title={t("carpool.title")} />
        <FormAlert tone="info">{t("carpool.verifyFirst")}</FormAlert>
        <Link to="/verify-student" className={buttonStyles.primary}>
          {t("account.verifyNow")}
        </Link>
      </div>
    );
  }
  return <Outlet />;
}
