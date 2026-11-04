import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { buttonStyles, EmptyState, PageHeader } from "../components/ui";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("notFound.title")} />
      <EmptyState
        icon={SearchX}
        text={t("notFound.title")}
        action={
          <Link to="/" className={buttonStyles.primary}>
            {t("notFound.back")}
          </Link>
        }
      />
    </>
  );
}
