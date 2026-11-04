import styles from "./Avatar.module.css";

// A round profile photo, or the person's initials when there is none.
export function Avatar({ name, src, size = 48 }: { name: string; src?: string | null; size?: number }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <span className={styles.avatar} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {src ? <img src={src} alt="" className={styles.image} /> : initials}
    </span>
  );
}
