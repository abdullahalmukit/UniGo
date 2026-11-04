import { Briefcase, Building2, House, MapPin, Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ConfirmSheet } from "../../components/ConfirmSheet";
import { FormAlert } from "../../components/form";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { deleteAddress, listAddresses, type AddressLabel, type SavedAddress } from "./account-api";
import styles from "./settings.module.css";
import { SkeletonList, SubPageHeader } from "./SubPage";

export const LABEL_ICONS: Record<AddressLabel, LucideIcon> = {
  HOME: House,
  HALL: Building2,
  WORK: Briefcase,
  CUSTOM: MapPin,
};

const SINGLE_LABELS = ["HOME", "HALL", "WORK"] as const;

// Saved Addresses (proposal section 5, A7): Home, Hall and Work once each, and
// custom places, up to 10 in total.
export function SavedAddressesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [max, setMax] = useState(0);
  const [failed, setFailed] = useState(false);
  const [removing, setRemoving] = useState<SavedAddress | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const result = await listAddresses();
      setAddresses(result.addresses);
      setMax(result.max);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const name = (address: SavedAddress) =>
    address.label === "CUSTOM" ? (address.customLabel ?? "") : t(`addresses.labels.${address.label}`);

  const full = (addresses?.length ?? 0) >= max;
  const custom = addresses?.filter((a) => a.label === "CUSTOM") ?? [];

  return (
    <div className={styles.page}>
      <SubPageHeader title={t("addresses.title")} />
      {failed && (
        <FormAlert>
          {t("addresses.loadFailed")}{" "}
          <button type="button" className={buttonStyles.secondary} onClick={() => void load()}>
            {t("auth.retry")}
          </button>
        </FormAlert>
      )}
      {!addresses && !failed && <SkeletonList rows={4} />}
      {addresses && (
        <>
          <ul className={styles.list}>
            {SINGLE_LABELS.map((label) => {
              const saved = addresses.find((a) => a.label === label);
              return saved ? (
                <AddressRow key={label} address={saved} name={name(saved)} onDelete={() => setRemoving(saved)} />
              ) : (
                <li key={label}>
                  <Link
                    to={`/account/addresses/new?label=${label}`}
                    className={`${styles.row} ${styles.rowLink}`}
                    aria-disabled={full || undefined}
                    onClick={(event) => full && event.preventDefault()}
                  >
                    <LabelIcon label={label} />
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{t(`addresses.labels.${label}`)}</span>
                      <span className={styles.caption}>{t(`addresses.add${label}`)}</span>
                    </span>
                    <Plus aria-hidden size={20} />
                  </Link>
                </li>
              );
            })}
            {custom.map((address) => (
              <AddressRow key={address.id} address={address} name={name(address)} onDelete={() => setRemoving(address)} />
            ))}
          </ul>

          <p className={styles.caption}>{t("addresses.count", { count: addresses.length, max: max })}</p>
          {full ? (
            <p className={styles.caption}>{t("addresses.full", { max: max })}</p>
          ) : (
            <Link to="/account/addresses/new?label=CUSTOM" className={buttonStyles.primary}>
              <Plus aria-hidden size={18} />
              {t("addresses.addCustom")}
            </Link>
          )}
        </>
      )}

      <ConfirmSheet
        title={t("addresses.deleteTitle")}
        open={removing !== null}
        onClose={() => setRemoving(null)}
        confirmLabel={t("addresses.delete")}
        onConfirm={async () => {
          if (!removing) return;
          await deleteAddress(removing.id);
          setAddresses((current) => current?.filter((a) => a.id !== removing.id) ?? null);
          toast.show(t("addresses.deleted"));
        }}
      >
        {removing && <p>{t("addresses.deleteText", { name: name(removing) })}</p>}
      </ConfirmSheet>
    </div>
  );
}

function LabelIcon({ label }: { label: AddressLabel }) {
  const Icon = LABEL_ICONS[label];
  return (
    <span className={styles.rowIcon}>
      <Icon aria-hidden size={20} />
    </span>
  );
}

function AddressRow({ address, name, onDelete }: { address: SavedAddress; name: string; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <li className={styles.row}>
      <LabelIcon label={address.label} />
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{name}</span>
        <span className={`${styles.caption} ${styles.ellipsis}`}>{address.address}</span>
      </span>
      <Link to={`/account/addresses/${address.id}`} className={styles.iconButton} aria-label={t("addresses.editNamed", { name })}>
        <Pencil aria-hidden size={18} />
      </Link>
      <button type="button" className={styles.iconButton} aria-label={t("addresses.deleteNamed", { name })} onClick={onDelete}>
        <Trash2 aria-hidden size={18} />
      </button>
    </li>
  );
}
