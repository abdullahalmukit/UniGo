// The page that shows an activity, by its type (B3b-1, Food B4). Carpool and
// Service add theirs when their pages arrive; until then Activity is used.
export function activityPath(type: string, id: string) {
  const e = encodeURIComponent(id);
  switch (type) {
    case "RIDE_REQUEST":
      return `/ride/requests/${e}`;
    case "RIDE_BOOKING":
      return `/ride/bookings/${e}`;
    case "RIDE_OFFER":
      return `/ride/offers/${e}`;
    case "FOOD":
      return `/food/requests/${e}`;
    default:
      return "/activity";
  }
}

export const profilePath = (userId: string) => `/u/${encodeURIComponent(userId)}`;
