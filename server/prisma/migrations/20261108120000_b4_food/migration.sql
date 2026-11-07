-- B4: Food Delivery.
-- * food_requests: the order details both participants confirm (items, food
--   price, delivery charge, payment method) with a version number.
-- * food_budget_approvals: over-budget approvals asked in the chat.
-- * messages: kind APPROVAL and ref_id (the approval a card is about).
-- * notifications: FOOD_ORDER_TO_CONFIRM, FOOD_BUDGET_APPROVAL_REQUESTED,
--   FOOD_BUDGET_APPROVAL_DECIDED.
-- AlterTable
ALTER TABLE `food_requests` ADD COLUMN `order_delivery_charge` DECIMAL(10, 2) NULL,
    ADD COLUMN `order_food_price` DECIMAL(10, 2) NULL,
    ADD COLUMN `order_items` TEXT NULL,
    ADD COLUMN `order_payment_method` ENUM('CASH', 'BKASH', 'NAGAD') NULL,
    ADD COLUMN `order_updated_at` DATETIME(3) NULL,
    ADD COLUMN `order_updated_by_id` CHAR(36) NULL,
    ADD COLUMN `order_version` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `messages` ADD COLUMN `ref_id` CHAR(36) NULL,
    MODIFY `kind` ENUM('TEXT', 'IMAGE', 'SYSTEM', 'APPROVAL') NOT NULL DEFAULT 'TEXT';

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('REQUEST_ACCEPTED', 'SEAT_BOOKED', 'CARPOOL_BOOKING_REQUESTED', 'CARPOOL_BOOKING_ACCEPTED', 'CARPOOL_BOOKING_REJECTED', 'CARPOOL_CONTRACT_CREATED', 'CARPOOL_SESSION_REMINDER', 'ACTIVITY_REMINDER', 'COMPLETION_REQUESTED', 'AUTO_COMPLETED', 'AUTO_CLOSED_NOT_MARKED', 'ACTIVITY_CANCELLED', 'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED', 'NEW_CHAT_MESSAGE', 'SUB_AREA_NEW_REQUEST', 'STUDENT_VERIFICATION_RESULT', 'RIDER_VERIFICATION_RESULT', 'REQUEST_EXPIRED', 'CARPOOL_PAYMENT_DUE', 'REPORT_UPDATE', 'SUPPORT_UPDATE', 'ANNOUNCEMENT', 'ACCOUNT_STATUS_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'LICENCE_EXPIRY_REMINDER', 'PARTICIPANT_ACCOUNT_LOCKED', 'RIDER_ACCESS_CHANGED', 'REVIEW_PUBLISHED', 'FOOD_ORDER_TO_CONFIRM', 'FOOD_BUDGET_APPROVAL_REQUESTED', 'FOOD_BUDGET_APPROVAL_DECIDED') NOT NULL;

-- CreateTable
CREATE TABLE `food_budget_approvals` (
    `id` CHAR(36) NOT NULL,
    `food_request_id` CHAR(36) NOT NULL,
    `requested_by_id` CHAR(36) NOT NULL,
    `previous_amount` DECIMAL(10, 2) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `food_budget_approvals_food_request_id_status_idx`(`food_request_id`, `status`),
    INDEX `food_budget_approvals_requested_by_id_idx`(`requested_by_id`),
    INDEX `food_budget_approvals_decided_by_id_idx`(`decided_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `food_requests_order_updated_by_id_idx` ON `food_requests`(`order_updated_by_id`);

-- AddForeignKey
ALTER TABLE `food_requests` ADD CONSTRAINT `food_requests_order_updated_by_id_fkey` FOREIGN KEY (`order_updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_budget_approvals` ADD CONSTRAINT `food_budget_approvals_food_request_id_fkey` FOREIGN KEY (`food_request_id`) REFERENCES `food_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_budget_approvals` ADD CONSTRAINT `food_budget_approvals_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_budget_approvals` ADD CONSTRAINT `food_budget_approvals_decided_by_id_fkey` FOREIGN KEY (`decided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
