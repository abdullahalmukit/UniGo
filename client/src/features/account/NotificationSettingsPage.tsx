import { useState } from "react";
import { useTranslation } from "react-i18next";
import formStyles from "../../components/form.module.css";
import { useToast } from "../../components/toast";
import { Card } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { updatePreferences, useMe } from "./account-api";
import styles from "./settings.module.css";
import { SubPageHeader } from "./SubPage";

// Notifications (proposal sections 5 and 14, A7): Web Push arrives with the
// notification system in B2. The email switch covers activity emails; account
// and security emails are always sent.
export function NotificationSettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const toggleEmail = async () => {
    const next = !me.emailNotificationsEnabled;
    setBusy(true);
    try {
      await updatePreferences({ emailNotificationsEnabled: next });
      toast.show(next ? t("notificationSettings.emailOn") : t("notificationSettings.emailOff"));
    } catch (failure) {
      toast.show(formErrors(failure, t).form ?? t("errors.generic"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <SubPageHeader title={t("notificationSettings.title")} />
      <Card className={styles.stack}>
        <div className={formStyles.switchRow}>
          <span className={formStyles.switchText}>
            <span id="push-label" className={styles.rowTitle}>
              {t("notificationSettings.push")}
            </span>
            <span className={styles.caption}>{t("notificationSettings.pushComing")}</span>
          </span>
          <button type="button" role="switch" aria-checked={false} aria-labelledby="push-label" className={formStyles.switch} disabled />
        </div>
        <div className={formStyles.switchRow}>
          <span className={formStyles.switchText}>
            <span id="email-label" className={styles.rowTitle}>
              {t("notificationSettings.email")}
            </span>
            <span className={styles.caption}>{t("notificationSettings.emailHint")}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={me.emailNotificationsEnabled}
            aria-labelledby="email-label"
            className={formStyles.switch}
            disabled={busy}
            onClick={() => void toggleEmail()}
          />
        </div>
      </Card>
      <p className={styles.caption}>{t("notificationSettings.alwaysSent")}</p>
    </div>
  );
}
