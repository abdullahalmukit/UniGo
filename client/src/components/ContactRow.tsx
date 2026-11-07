import { Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonStyles } from "./ui";
import styles from "./ContactRow.module.css";

// The other participant's phone number as text plus a Call button (B3b-1 D).
// The server sends a phone only after acceptance, while the activity runs and
// when nobody has blocked the other; nothing is shown otherwise.
export function ContactRow({ phone, name }: { phone: string | null | undefined; name?: string }) {
  const { t } = useTranslation();
  if (!phone) return null;
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span className={styles.label}>{name ? t("contact.phoneOf", { name }) : t("contact.phone")}</span>
        <span className={styles.number} dir="ltr">
          {phone}
        </span>
      </span>
      <a href={`tel:${phone}`} className={buttonStyles.secondary} aria-label={t("contact.call", { phone })}>
        <Phone aria-hidden size={18} /> {t("contact.callShort")}
      </a>
    </div>
  );
}
