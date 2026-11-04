import { Link } from "react-router";
import { BrandMark } from "../../components/Brand";
import styles from "./layout.module.css";

export function Logo() {
  return (
    <Link to="/" className={styles.logo} aria-label="UniGo">
      <BrandMark />
    </Link>
  );
}
