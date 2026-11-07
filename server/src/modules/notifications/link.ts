import type { NotificationType } from "../../generated/prisma/client.js";
import type { NotificationData } from "./catalogue.js";

// The page a notification opens, in the app and from a push. One place, so
// B3-B8 change a link here when their pages arrive. Always a path on this
// site (the service worker refuses anything else).
export function notificationLink(type: NotificationType, data: NotificationData | null | undefined, activityId?: string | null): string {
  const d = data ?? {};
  const chat = d.chatId ? `/inbox/${encodeURIComponent(d.chatId)}` : null;
  // B3b-2: a published review opens the user's own profile
  if (type === "REVIEW_PUBLISHED") return d.userId ? `/u/${encodeURIComponent(d.userId)}` : "/account";
  // B3a: ride notifications open the ride's own page
  if (activityId && type !== "NEW_CHAT_MESSAGE") {
    if (d.activityType === "RIDE_REQUEST") return `/ride/requests/${encodeURIComponent(activityId)}`;
    if (d.activityType === "RIDE_BOOKING") return `/ride/bookings/${encodeURIComponent(activityId)}`;
    // B4: food notifications open the food request's page
    if (d.activityType === "FOOD") return `/food/requests/${encodeURIComponent(activityId)}`;
  }
  switch (type) {
    case "NEW_CHAT_MESSAGE":
      return chat ?? "/inbox";
    case "SUB_AREA_NEW_REQUEST":
      // Food and Service pages come in B4/B5 (ride requests are handled above).
      return "/services";
    case "REQUEST_EXPIRED":
      return "/activity";
    case "CARPOOL_SESSION_REMINDER":
      return chat ?? "/upcoming";
    case "STUDENT_VERIFICATION_RESULT":
      return "/verify-student";
    case "RIDER_VERIFICATION_RESULT":
    case "RIDER_ACCESS_CHANGED":
    case "LICENCE_EXPIRY_REMINDER":
      return "/drive";
    case "ACCOUNT_STATUS_CHANGED":
    case "REPORT_UPDATE":
    case "SUPPORT_UPDATE":
      return "/account";
    case "PASSWORD_RESET_REQUESTED":
    case "PASSWORD_CHANGED":
      return "/account/profile";
    case "ANNOUNCEMENT":
      return "/";
    default:
      // Activity notifications: the activity's chat while it has one (B3 adds detail pages)
      return chat ?? "/activity";
  }
}
