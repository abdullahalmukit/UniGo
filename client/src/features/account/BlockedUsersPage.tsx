import { UserX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../../components/Avatar";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { FormAlert } from "../../components/form";
import { useToast } from "../../components/toast";
import { buttonStyles, EmptyState } from "../../components/ui";
import { fileUrl, listBlockedUsers, unblockUser, type BlockedUser } from "./account-api";
import styles from "./settings.module.css";
import { SkeletonList, SubPageHeader } from "./SubPage";

// Blocked Users (proposal section 5): see whom you blocked and unblock them.
// Blocking itself arrives with chat in B2.
export function BlockedUsersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [unblocking, setUnblocking] = useState<BlockedUser | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setUsers(await listBlockedUsers());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <SubPageHeader title={t("blocked.title")} />
      {failed && (
        <FormAlert>
          {t("blocked.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!users && !failed && <SkeletonList rows={2} />}
      {users && users.length === 0 && <EmptyState icon={UserX} text={t("blocked.empty")} />}
      {users && users.length > 0 && (
        <ul className={styles.list}>
          {users.map((user) => (
            <li key={user.id} className={styles.row}>
              <Avatar name={user.name} src={fileUrl(user.photo)} size={40} />
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{user.name}</span>
                <span className={styles.caption}>{user.university.shortName ?? user.university.name}</span>
              </span>
              <button type="button" className={buttonStyles.secondary} onClick={() => setUnblocking(user)}>
                {t("blocked.unblock")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmSheet
        title={t("blocked.unblockTitle")}
        open={unblocking !== null}
        onClose={() => setUnblocking(null)}
        confirmLabel={t("blocked.unblock")}
        onConfirm={async () => {
          if (!unblocking) return;
          await unblockUser(unblocking.id);
          setUsers((current) => current?.filter((u) => u.id !== unblocking.id) ?? null);
          toast.show(t("blocked.unblocked", { name: unblocking.name }));
        }}
      >
        {unblocking && <p>{t("blocked.unblockText", { name: unblocking.name })}</p>}
      </ConfirmSheet>
    </div>
  );
}
