-- B3b-2: reviews, payment records and the admin Ride Sharing module.
-- * payment_records.payee_id: who receives the money (the rider for rides);
--   only they can mark a record PAID. payment_records has no rows before
--   B3b-2, so the required column needs no default.
-- * ride_offers.close_reason ADMIN_REMOVED, notifications type REVIEW_PUBLISHED.
-- * Backfill: one UNPAID payment record for every ride already accepted,
--   from the stored amount (B3b-2 decision).
-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('REQUEST_ACCEPTED', 'SEAT_BOOKED', 'CARPOOL_BOOKING_REQUESTED', 'CARPOOL_BOOKING_ACCEPTED', 'CARPOOL_BOOKING_REJECTED', 'CARPOOL_CONTRACT_CREATED', 'CARPOOL_SESSION_REMINDER', 'ACTIVITY_REMINDER', 'COMPLETION_REQUESTED', 'AUTO_COMPLETED', 'AUTO_CLOSED_NOT_MARKED', 'ACTIVITY_CANCELLED', 'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED', 'NEW_CHAT_MESSAGE', 'SUB_AREA_NEW_REQUEST', 'STUDENT_VERIFICATION_RESULT', 'RIDER_VERIFICATION_RESULT', 'REQUEST_EXPIRED', 'CARPOOL_PAYMENT_DUE', 'REPORT_UPDATE', 'SUPPORT_UPDATE', 'ANNOUNCEMENT', 'ACCOUNT_STATUS_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'LICENCE_EXPIRY_REMINDER', 'PARTICIPANT_ACCOUNT_LOCKED', 'RIDER_ACCESS_CHANGED', 'REVIEW_PUBLISHED') NOT NULL;

-- AlterTable
ALTER TABLE `payment_records` ADD COLUMN `payee_id` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `ride_offers` MODIFY `close_reason` ENUM('DEPARTED', 'CANCELLED_BY_RIDER', 'STOPPED_BY_RIDER', 'REMOVED_BY_RIDER', 'ACCOUNT_MODERATED', 'ADMIN_REMOVED') NULL;

-- CreateIndex
CREATE INDEX `payment_records_payee_id_status_idx` ON `payment_records`(`payee_id`, `status`);

-- CreateIndex
CREATE INDEX `reviews_activity_id_published_at_idx` ON `reviews`(`activity_id`, `published_at`);

-- AddForeignKey
ALTER TABLE `payment_records` ADD CONSTRAINT `payment_records_payee_id_fkey` FOREIGN KEY (`payee_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: accepted passenger requests (the rider is the accepter and receives the money)
INSERT INTO `payment_records` (`id`, `activity_id`, `amount`, `status`, `payee_id`, `created_at`, `updated_at`)
SELECT UUID(), a.`id`, r.`offered_amount`, 'UNPAID', a.`accepter_id`, NOW(3), NOW(3)
FROM `activities` a JOIN `ride_requests` r ON r.`activity_id` = a.`id`
WHERE a.`accepter_id` IS NOT NULL AND a.`accepted_at` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `payment_records` p WHERE p.`activity_id` = a.`id`);

-- Backfill: seat bookings (the rider is the creator and receives the money)
INSERT INTO `payment_records` (`id`, `activity_id`, `amount`, `status`, `payee_id`, `created_at`, `updated_at`)
SELECT UUID(), a.`id`, b.`amount`, 'UNPAID', a.`creator_id`, NOW(3), NOW(3)
FROM `activities` a JOIN `ride_bookings` b ON b.`activity_id` = a.`id`
WHERE NOT EXISTS (SELECT 1 FROM `payment_records` p WHERE p.`activity_id` = a.`id`);
