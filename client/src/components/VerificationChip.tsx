import { useTranslation } from "react-i18next";
import type { StudentVerificationStatus } from "../features/verification/verification-api";
import styles from "./StatusChip.module.css";

// Same colour rules as the activity chips: green = done, amber = pending,
// red = rejected, grey = not started. Reused on Profile in A7.
const TONE: Record<StudentVerificationStatus, "green" | "amber" | "red" | "grey"> = {
  VERIFIED: "green",
  PENDING: "amber",
  REJECTED: "red",
  UNVERIFIED: "grey",
};

export function VerificationChip({ status }: { status: StudentVerificationStatus }) {
  const { t } = useTranslation();
  const tone = TONE[status];

  return (
    <span className={`${styles.chip} ${styles[tone]}`} data-tone={tone}>
      {t(`verification.status.${status}`)}
    </span>
  );
}
