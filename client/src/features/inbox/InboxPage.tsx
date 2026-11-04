import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState, PageHeader } from "../../components/ui";

// Placeholder until chat (B2).
export function InboxPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("inbox.title")} />
      <EmptyState icon={MessageCircle} text={t("inbox.empty")} />
    </>
  );
}
