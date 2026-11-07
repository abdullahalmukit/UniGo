import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import formStyles from "../../components/form.module.css";
import { useToast } from "../../components/toast";
import { Card } from "../../components/ui";
import { formErrors } from "../../lib/errors";
import { disablePush, enablePush, pushState, type PushState } from "../../lib/push";
import { updatePreferences, useMe } from "./account-api";
import styles from "./settings.module.css";
import { SubPageHeader } from "./SubPage";

// Notifications (proposal sections 5 and 14, A7, B2c). Web Push is switched on
// or off for this device. The email switch covers activity emails; account
// and security emails are always sent.
export function NotificationSettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void pushState()
      .then((state) => !cancelled && setPush(state))
      .catch(() => !cancelled && setPush("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

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

  const togglePush = async () => {
    setPushBusy(true);
    try {
      const next = push === "on" ? await disablePush() : await enablePush();
      setPush(next);
      if (next === "on") toast.show(t("notificationSettings.pushOn"));
      else if (next === "denied") toast.show(t("notificationSettings.pushDenied"), "error");
      else if (push === "on") toast.show(t("notificationSettings.pushOff"));
    } catch (failure) {
      toast.show(formErrors(failure, t).form ?? t("notificationSettings.pushFailed"), "error");
    } finally {
      setPushBusy(false);
    }
  };

  const pushHint =
    push === "unsupported"
      ? t("notificationSettings.pushUnsupported")
      : push === "denied"
        ? t("notificationSettings.pushDenied")
        : t("notificationSettings.pushHint");

  return (
    <div className={styles.page}>
      <SubPageHeader title={t("notificationSettings.title")} />
      <Card className={styles.stack}>
        <div className={formStyles.switchRow}>
          <span className={formStyles.switchText}>
            <span id="push-label" className={styles.rowTitle}>
              {t("notificationSettings.push")}
            </span>
            <span id="push-hint" className={styles.caption}>
              {pushHint}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={push === "on"}
            aria-labelledby="push-label"
            aria-describedby="push-hint"
            className={formStyles.switch}
            disabled={pushBusy || push === null || push === "unsupported" || push === "denied"}
            onClick={() => void togglePush()}
          />
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
