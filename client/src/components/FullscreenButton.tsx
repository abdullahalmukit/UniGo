import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

// Shows a map (or any element) on the whole screen and back. Hidden where the
// browser cannot do it (for example Safari on iPhone); the map still works.
export function FullscreenButton({ target, className }: { target: RefObject<HTMLElement | null>; className: string }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const supported = typeof document !== "undefined" && document.fullscreenEnabled === true;

  useEffect(() => {
    const onChange = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === target.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [target]);

  if (!supported) return null;
  const toggle = () => {
    if (active) void document.exitFullscreen().catch(() => undefined);
    else void target.current?.requestFullscreen().catch(() => undefined);
  };
  const label = active ? t("map.exitFullscreen") : t("map.fullscreen");
  return (
    <button type="button" className={className} onClick={toggle} aria-label={label} title={label}>
      {active ? <Minimize2 aria-hidden size={20} /> : <Maximize2 aria-hidden size={20} />}
    </button>
  );
}
