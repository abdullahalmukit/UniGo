// The UniGo logo, from the files in client/brand (designs and colours unchanged;
// see client/scripts/build-brand-assets.mjs).
import icon from "../assets/brand/unigo-icon.png";
import logoDark from "../assets/brand/unigo-logo-dark.png";
import logo from "../assets/brand/unigo-logo.png";
import wordmark from "../assets/brand/unigo-wordmark.png";
import styles from "./Brand.module.css";

// Navbar and top bar: round icon + "UNIGO" wordmark, no tagline. In dark mode
// the icon sits on a small white circle and the wordmark turns white.
export function BrandMark() {
  return (
    <span className={styles.mark}>
      <span className={styles.iconPlate}>
        <img src={icon} alt="" className={styles.icon} width={32} height={32} />
      </span>
      <img src={wordmark} alt="" className={styles.wordmark} height={16} />
    </span>
  );
}

// Login, Register and splash: the full logo with its tagline. The dark version
// has white lettering and the circle on a white disc.
export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`${styles.logo} ${className}`}>
      <img src={logo} alt="UniGo: Ride, Food, Service" className={styles.logoLight} />
      <img src={logoDark} alt="UniGo: Ride, Food, Service" className={styles.logoDark} />
    </span>
  );
}
