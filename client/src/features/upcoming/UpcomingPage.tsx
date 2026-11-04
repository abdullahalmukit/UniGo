import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState, PageHeader } from "../../components/ui";

// Placeholder until B3.
export function UpcomingPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("upcoming.title")} />
      <EmptyState icon={CalendarClock} text={t("upcoming.empty")} />
    </>
  );
}
