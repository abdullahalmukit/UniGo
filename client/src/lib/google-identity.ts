// Google's own sign-in library (Google Identity Services), loaded once from
// accounts.google.com. It draws Google's official button and hands back the ID
// token that POST /api/auth/google checks (A5b decision).
export const googleClientId: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined;

const SCRIPT_URL = "https://accounts.google.com/gsi/client";

type ButtonOptions = {
  theme: "outline" | "filled_black";
  size: "large";
  shape: "pill";
  text: "signin_with" | "continue_with";
  width: number;
  locale: string;
};

export type GoogleIdentity = {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void; ux_mode: "popup" }): void;
      renderButton(element: HTMLElement, options: ButtonOptions): void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let loading: Promise<GoogleIdentity> | undefined;

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google sign-in did not load")));
    script.onerror = () => {
      loading = undefined;
      reject(new Error("Google sign-in did not load"));
    };
    document.head.append(script);
  });
  return loading;
}
