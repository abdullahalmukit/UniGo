import { useTranslation } from "react-i18next";
import styles from "./StatusChip.module.css";

export type ActivityStatus =
  | "OPEN"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "DISPUTED"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "NOT_MARKED";

// CLAUDE.md: green = completed, amber = open/pending, indigo = accepted,
// purple = in progress, red = cancelled/disputed, grey = expired/not marked.
export const STATUS_TONE: Record<ActivityStatus, "green" | "amber" | "indigo" | "purple" | "red" | "grey"> = {
  COMPLETED: "green",
  OPEN: "amber",
  ACCEPTED: "indigo",
  IN_PROGRESS: "purple",
  CANCELLED: "red",
  DISPUTED: "red",
  EXPIRED: "grey",
  NOT_MARKED: "grey",
};

export function StatusChip({ status }: { status: ActivityStatus }) {
  const { t } = useTranslation();
  const tone = STATUS_TONE[status];

  return (
    <span className={`${styles.chip} ${styles[tone]}`} data-tone={tone}>
      {t(`status.${status}`)}
    </span>
  );
}
