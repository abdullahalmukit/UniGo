import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState, PageHeader } from "../../components/ui";

// Placeholder until notifications (B2).
export function NotificationsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("notifications.title")} />
      <EmptyState icon={Bell} text={t("notifications.empty")} />
    </>
  );
}
