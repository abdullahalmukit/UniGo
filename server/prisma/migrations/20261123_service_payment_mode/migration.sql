-- Migration: service_payment_mode
-- Adds payment mode negotiation (Pre-pay / Post-pay) to Uni Service

-- Step 1: Extend ActivitySubStatus enum with service payment negotiation states
ALTER TABLE `activities`
  MODIFY COLUMN `sub_status` ENUM(
    'RIDE_CONFIRMED',
    'CONTRACT_ACTIVE',
    'ORDER_CONFIRMED',
    'FOOD_COLLECTED',
    'SERVICE_DELIVERED',
    'COMPLETION_REQUESTED',
    'PAYMENT_MODE_PROPOSED',
    'AWAITING_PAYMENT',
    'PAYMENT_SENT'
  );

ALTER TABLE `activity_status_history`
  MODIFY COLUMN `from_sub_status` ENUM(
    'RIDE_CONFIRMED',
    'CONTRACT_ACTIVE',
    'ORDER_CONFIRMED',
    'FOOD_COLLECTED',
    'SERVICE_DELIVERED',
    'COMPLETION_REQUESTED',
    'PAYMENT_MODE_PROPOSED',
    'AWAITING_PAYMENT',
    'PAYMENT_SENT'
  ),
  MODIFY COLUMN `to_sub_status` ENUM(
    'RIDE_CONFIRMED',
    'CONTRACT_ACTIVE',
    'ORDER_CONFIRMED',
    'FOOD_COLLECTED',
    'SERVICE_DELIVERED',
    'COMPLETION_REQUESTED',
    'PAYMENT_MODE_PROPOSED',
    'AWAITING_PAYMENT',
    'PAYMENT_SENT'
  );

-- Step 2: Add payment mode fields to service_requests
ALTER TABLE `service_requests`
  ADD COLUMN `payment_mode` ENUM('PRE_PAY', 'POST_PAY') NULL AFTER `instructions`,
  ADD COLUMN `payment_mode_proposed_by` CHAR(36) NULL AFTER `payment_mode`;
