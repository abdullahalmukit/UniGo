import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { formatRideTime } from "../../lib/dates";
import styles from "./matching.module.css";
import { getSuggestions, suggestionLink, type MatchReason, type Suggestion, type SuggestionsQuery } from "./matching-api";

// "Best matches" (B9, proposal section 20): the top open items for a request,
// an offer or the filters the user set, ranked by the Stage 1 score, each with
// a short reason. Only a recommendation: the user opens the item and decides.
// Renders nothing when there is nothing to suggest or the request fails.

const minuteText = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function BestMatches({ query, title }: { query: SuggestionsQuery | null; title?: string }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const key = query ? JSON.stringify(query) : null;

  useEffect(() => {
    if (!query) {
      setItems(null);
      return;
    }
    let cancelled = false;
    getSuggestions(query).then(
      (result) => !cancelled && setItems(result.suggestions),
      () => !cancelled && setItems([]),
    );
    return () => {
      cancelled = true;
    };
    // `key` stands for the query's contents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!items || items.length === 0) return null;

  const reasonText = (reason: MatchReason) => {
    switch (reason.code) {
      case "PICKUP_NEAR":
        return t("matching.reasons.PICKUP_NEAR", { km: reason.km.toLocaleString(i18n.language) });
      case "DESTINATION_NEAR":
        return t("matching.reasons.DESTINATION_NEAR", { km: reason.km.toLocaleString(i18n.language) });
      case "TIME_CLOSE":
        return t("matching.reasons.TIME_CLOSE", { count: reason.minutes });
      case "HIGH_RATING":
        return t("matching.reasons.HIGH_RATING", { rating: reason.rating });
      case "RELIABLE":
        return t("matching.reasons.RELIABLE", { percent: reason.percent });
      default:
        return t("matching.reasons.SAME_DIRECTION");
    }
  };

  return (
    <section className={styles.card} aria-label={title ?? t("matching.title")}>
      <h2 className={styles.title}>
        <Sparkles aria-hidden size={18} /> {title ?? t("matching.title")}
      </h2>
      <p className={styles.hint}>{t("matching.hint")}</p>
      <ul className={styles.list}>
        {items.map((suggestion) => {
          const item = suggestion.item;
          const from = item.pickup ?? item.restaurant ?? null;
          const to = item.destination ?? item.delivery ?? null;
          const when = item.departureTime ?? item.startTime ?? item.expectedDeliveryTime;
          const person = item.rider ?? item.passenger ?? item.requester;
          const heading = item.restaurantName ?? item.taskTitle ?? (from && to ? `${from.address} → ${to.address}` : (to?.address ?? ""));
          return (
            <li key={`${suggestion.target}:${item.id}`}>
              <Link to={suggestionLink(suggestion.target, item.id)} className={styles.item}>
                <span className={styles.row}>
                  <span className={styles.heading}>{heading}</span>
                  <span className={styles.score} aria-label={t("matching.scoreLabel", { percent: Math.round(suggestion.score * 100) })}>
                    {t("matching.score", { percent: Math.round(suggestion.score * 100) })}
                  </span>
                </span>
                <span className={styles.meta}>
                  {when ? formatRideTime(when, i18n.language) : item.departureMinute !== undefined ? minuteText(item.departureMinute) : ""}
                  {person?.name ? ` · ${person.name}` : ""}
                </span>
                {suggestion.reasons.length > 0 && (
                  <span className={styles.reasons}>
                    {suggestion.reasons.map((reason) => (
                      <span key={reason.code} className={styles.reason}>
                        {reasonText(reason)}
                      </span>
                    ))}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
