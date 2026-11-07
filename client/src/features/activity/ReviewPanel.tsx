import { Star } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FormAlert } from "../../components/form";
import { useToast } from "../../components/toast";
import { buttonStyles } from "../../components/ui";
import { formatDate } from "../../lib/dates";
import { formErrors } from "../../lib/errors";
import { getReviews, submitReview, type ActivityReviews, type Review } from "./extras-api";
import styles from "./extras.module.css";

export function Stars({ rating }: { rating: number }) {
  const { t } = useTranslation();
  return (
    <span className={styles.stars} role="img" aria-label={t("review.starsLabel", { count: rating })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} aria-hidden size={16} className={n <= rating ? styles.starOn : styles.starOff} />
      ))}
    </span>
  );
}

export function ReviewItem({ review, title }: { review: Review; title?: string }) {
  const { i18n } = useTranslation();
  return (
    <div className={styles.review}>
      <div className={styles.row}>
        <span className={styles.reviewer}>{title ?? review.reviewer.name}</span>
        <Stars rating={review.rating} />
      </div>
      {review.comment && <p className={styles.comment}>{review.comment}</p>}
      <span className={styles.note}>{formatDate(review.publishedAt ?? review.createdAt, i18n.language)}</span>
    </div>
  );
}

// Blind reviews on a completed activity (proposal 15.1, B3b-2): the form while
// the 7 days are open; your own review; the other person's once published.
export function ReviewPanel({ activityId }: { activityId: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<ActivityReviews | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getReviews(activityId)
      .then(setData)
      .catch(() => setData(null));
  }, [activityId]);
  useEffect(load, [load]);

  if (!data) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (rating === 0) return setError(t("review.pickStars"));
    setBusy(true);
    setError(null);
    try {
      setData(await submitReview(activityId, rating, comment));
      toast.show(t("review.sent"));
    } catch (failure) {
      setError(formErrors(failure, t).form ?? t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="review" className={styles.card} aria-labelledby={`review-${activityId}`}>
      <h2 id={`review-${activityId}`} className={styles.title}>
        {t("review.title")}
      </h2>
      {data.canReview && (
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          {error && <FormAlert>{error}</FormAlert>}
          <div className={styles.starPicker} role="radiogroup" aria-label={t("review.rating")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={t("review.starsLabel", { count: n })}
                className={styles.starButton}
                onClick={() => setRating(n)}
              >
                <Star aria-hidden size={28} className={n <= rating ? styles.starOn : styles.starOff} />
              </button>
            ))}
          </div>
          <label className={styles.form}>
            <span>{t("review.comment")}</span>
            <textarea className={styles.textarea} value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} />
          </label>
          <p className={styles.note}>
            {t("review.blindHint")} {data.closesAt && t("review.closes", { date: formatDate(data.closesAt, i18n.language) })}
          </p>
          <button type="submit" className={buttonStyles.primary} disabled={busy}>
            {t("review.send")}
          </button>
        </form>
      )}
      {data.mine && <ReviewItem review={data.mine} title={t("review.yours")} />}
      {data.mine && !data.theirs && <p className={styles.note}>{t("review.waiting")}</p>}
      {data.theirs && <ReviewItem review={data.theirs} />}
      {!data.canReview && !data.mine && !data.theirs && <p className={styles.note}>{t("review.closed")}</p>}
    </section>
  );
}
