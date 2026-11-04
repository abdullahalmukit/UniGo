import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../app/theme-provider";
import { googleClientId, loadGoogleIdentity } from "../../lib/google-identity";
import styles from "./auth.module.css";

// Google's official "Sign in with Google" button, in the app's language and
// theme. Hands the ID token to `onCredential`. Hidden if no client ID is set.
export function GoogleButton({ onCredential }: { onCredential: (idToken: string) => void }) {
  const { t, i18n } = useTranslation();
  const { resolved } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const [failed, setFailed] = useState(false);
  callback.current = onCredential;

  useEffect(() => {
    if (!googleClientId) return;
    let cancelled = false;
    loadGoogleIdentity().then(
      (google) => {
        if (cancelled || !container.current) return;
        google.accounts.id.initialize({
          client_id: googleClientId!,
          callback: (response) => callback.current(response.credential),
          ux_mode: "popup",
        });
        container.current.replaceChildren();
        google.accounts.id.renderButton(container.current, {
          theme: resolved === "dark" ? "filled_black" : "outline",
          size: "large",
          shape: "pill",
          text: "continue_with",
          width: Math.min(400, container.current.clientWidth || 320),
          locale: i18n.language === "bn" ? "bn" : "en",
        });
      },
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [resolved, i18n.language]);

  if (!googleClientId) return null;
  return (
    <>
      <div className={styles.divider}>{t("auth.or")}</div>
      {failed ? (
        <p className={styles.footer}>{t("auth.google.unavailable")}</p>
      ) : (
        <div ref={container} className={styles.google} data-testid="google-button" />
      )}
    </>
  );
}
