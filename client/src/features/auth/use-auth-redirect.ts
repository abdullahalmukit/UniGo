import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useSession } from "../../app/use-session";
import { safeNext } from "../../lib/safe-next";

// Where this auth page should send the user afterwards: the `next` query (if it
// is a path on this site), otherwise Home.
export function useNext() {
  const [params] = useSearchParams();
  return safeNext(params.get("next"));
}

// Someone who is already logged in (for example a second tab) is sent on to
// `target`. A page that signs in itself sets `leaving.current` first, so it
// decides where to go instead.
export function useRedirectIfSignedIn(target: string) {
  const status = useSession().status;
  const navigate = useNavigate();
  const leaving = useRef(false);

  useEffect(() => {
    if (status === "authenticated" && !leaving.current) navigate(target, { replace: true });
  }, [status, target, navigate]);

  return leaving;
}

// "?next=…" to carry the destination through registration and verification.
export function nextQuery(next: string) {
  return next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
}
