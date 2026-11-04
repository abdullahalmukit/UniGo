-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `google_id` VARCHAR(64) NULL,
    `university_id` CHAR(36) NOT NULL,
    `role` ENUM('USER', 'MODERATOR', 'SUPER_ADMIN') NOT NULL DEFAULT 'USER',
    `account_status` ENUM('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED') NOT NULL DEFAULT 'ACTIVE',
    `suspended_until` DATETIME(3) NULL,
    `student_verification_status` ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
    `verified_university_email` VARCHAR(254) NULL,
    `is_verified_rider` BOOLEAN NOT NULL DEFAULT false,
    `rider_active` BOOLEAN NOT NULL DEFAULT false,
    `rider_suspended` BOOLEAN NOT NULL DEFAULT false,
    `rider_suspended_until` DATETIME(3) NULL,
    `carpool_suspended_until` DATETIME(3) NULL,
    `language` ENUM('BN', 'EN') NOT NULL DEFAULT 'EN',
    `theme` ENUM('LIGHT', 'DARK', 'SYSTEM') NOT NULL DEFAULT 'SYSTEM',
    `push_enabled` BOOLEAN NOT NULL DEFAULT false,
    `email_notifications_enabled` BOOLEAN NOT NULL DEFAULT true,
    `password_changed_at` DATETIME(3) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    UNIQUE INDEX `users_google_id_key`(`google_id`),
    UNIQUE INDEX `users_verified_university_email_key`(`verified_university_email`),
    INDEX `users_university_id_idx`(`university_id`),
    INDEX `users_account_status_idx`(`account_status`),
    INDEX `users_student_verification_status_idx`(`student_verification_status`),
    INDEX `users_is_verified_rider_rider_active_idx`(`is_verified_rider`, `rider_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profiles` (
    `user_id` CHAR(36) NOT NULL,
    `full_name` VARCHAR(100) NOT NULL,
    `photo_url` VARCHAR(512) NULL,
    `student_id_number` VARCHAR(50) NULL,
    `department` VARCHAR(100) NULL,
    `batch` VARCHAR(50) NULL,
    `location` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_idx`(`user_id`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `password_reset_tokens_token_hash_key`(`token_hash`),
    INDEX `password_reset_tokens_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `universities` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `short_name` VARCHAR(30) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `universities_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `university_domains` (
    `id` CHAR(36) NOT NULL,
    `university_id` CHAR(36) NOT NULL,
    `domain` VARCHAR(253) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `university_domains_domain_key`(`domain`),
    INDEX `university_domains_university_id_idx`(`university_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_verifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `method` ENUM('UNIVERSITY_EMAIL', 'ID_CARD') NOT NULL,
    `status` ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `university_email` VARCHAR(254) NULL,
    `otp_hash` CHAR(64) NULL,
    `otp_expires_at` DATETIME(3) NULL,
    `otp_attempts` INTEGER NOT NULL DEFAULT 0,
    `id_card_file_key` VARCHAR(512) NULL,
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `student_verifications_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `student_verifications_status_method_idx`(`status`, `method`),
    INDEX `student_verifications_university_email_idx`(`university_email`),
    INDEX `student_verifications_reviewed_by_id_idx`(`reviewed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `saved_addresses` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `label` ENUM('HOME', 'HALL', 'WORK', 'CUSTOM') NOT NULL,
    `custom_label` VARCHAR(50) NULL,
    `address` VARCHAR(255) NOT NULL,
    `lat` DECIMAL(9, 6) NOT NULL,
    `lng` DECIMAL(9, 6) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `saved_addresses_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blocks` (
    `blocker_id` CHAR(36) NOT NULL,
    `blocked_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `blocks_blocked_id_idx`(`blocked_id`),
    PRIMARY KEY (`blocker_id`, `blocked_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `moderation_actions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `type` ENUM('WARN', 'RESTRICT', 'SUSPEND', 'BAN', 'UNBAN', 'REACTIVATE', 'RIDER_SUSPEND', 'RIDER_REINSTATE', 'CARPOOL_SUSPEND', 'CARPOOL_REINSTATE') NOT NULL,
    `reason` TEXT NOT NULL,
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `previous_status` ENUM('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED') NULL,
    `new_status` ENUM('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED') NULL,
    `dispute_id` CHAR(36) NULL,
    `report_id` CHAR(36) NULL,
    `no_show_report_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `moderation_actions_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `moderation_actions_admin_id_idx`(`admin_id`),
    INDEX `moderation_actions_type_ends_at_idx`(`type`, `ends_at`),
    INDEX `moderation_actions_dispute_id_idx`(`dispute_id`),
    INDEX `moderation_actions_report_id_idx`(`report_id`),
    INDEX `moderation_actions_no_show_report_id_idx`(`no_show_report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sub_areas` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sub_areas_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_sub_areas` (
    `user_id` CHAR(36) NOT NULL,
    `sub_area_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `user_sub_areas_sub_area_id_idx`(`sub_area_id`),
    PRIMARY KEY (`user_id`, `sub_area_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rider_applications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `kind` ENUM('INITIAL', 'REVERIFICATION') NOT NULL DEFAULT 'INITIAL',
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `licence_expires_on` DATE NOT NULL,
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rider_applications_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `rider_applications_status_created_at_idx`(`status`, `created_at`),
    INDEX `rider_applications_licence_expires_on_idx`(`licence_expires_on`),
    INDEX `rider_applications_reviewed_by_id_idx`(`reviewed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rider_documents` (
    `id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `type` ENUM('NID_FRONT', 'NID_BACK', 'CAR_LICENCE', 'MOTORCYCLE_LICENCE') NOT NULL,
    `file_key` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(50) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rider_documents_application_id_type_key`(`application_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` CHAR(36) NOT NULL,
    `owner_id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NULL,
    `type` ENUM('BIKE', 'CAR') NOT NULL,
    `brand` VARCHAR(50) NOT NULL,
    `model` VARCHAR(50) NOT NULL,
    `colour` VARCHAR(30) NOT NULL,
    `registration_number` VARCHAR(30) NOT NULL,
    `registration_number_normalized` VARCHAR(30) NOT NULL,
    `photo_key` VARCHAR(512) NOT NULL,
    `seat_capacity` TINYINT NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicles_registration_number_normalized_key`(`registration_number_normalized`),
    INDEX `vehicles_owner_id_status_idx`(`owner_id`, `status`),
    INDEX `vehicles_application_id_idx`(`application_id`),
    INDEX `vehicles_reviewed_by_id_idx`(`reviewed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activities` (
    `id` CHAR(36) NOT NULL,
    `type` ENUM('RIDE_REQUEST', 'RIDE_BOOKING', 'CARPOOL_BOOKING', 'CARPOOL_SESSION', 'FOOD', 'SERVICE') NOT NULL,
    `status` ENUM('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NOT_MARKED') NOT NULL DEFAULT 'OPEN',
    `sub_status` ENUM('RIDE_CONFIRMED', 'CONTRACT_ACTIVE', 'ORDER_CONFIRMED', 'FOOD_COLLECTED', 'SERVICE_DELIVERED', 'COMPLETION_REQUESTED') NULL,
    `start_time` DATETIME(3) NOT NULL,
    `blocks_time` BOOLEAN NOT NULL DEFAULT true,
    `creator_id` CHAR(36) NOT NULL,
    `accepter_id` CHAR(36) NULL,
    `accepted_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completion_requested_at` DATETIME(3) NULL,
    `completion_requested_by_id` CHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancelled_by_id` CHAR(36) NULL,
    `cancellation_reason` TEXT NULL,
    `is_late_cancellation` BOOLEAN NOT NULL DEFAULT false,
    `auto_closed_at` DATETIME(3) NULL,
    `closure_reason` ENUM('EXPIRED_UNACCEPTED', 'NOT_MARKED_TIMEOUT', 'AUTO_COMPLETED', 'DELETED_BY_CREATOR', 'BOOKING_REJECTED', 'SEAT_HOLD_EXPIRED', 'ACCOUNT_MODERATED', 'ADMIN_REMOVED', 'DISPUTE_RESOLVED') NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `activities_status_start_time_idx`(`status`, `start_time`),
    INDEX `activities_type_status_start_time_idx`(`type`, `status`, `start_time`),
    INDEX `activities_creator_id_status_start_time_idx`(`creator_id`, `status`, `start_time`),
    INDEX `activities_accepter_id_status_start_time_idx`(`accepter_id`, `status`, `start_time`),
    INDEX `activities_creator_id_created_at_idx`(`creator_id`, `created_at`),
    INDEX `activities_completion_requested_by_id_idx`(`completion_requested_by_id`),
    INDEX `activities_cancelled_by_id_idx`(`cancelled_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_status_history` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `from_status` ENUM('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NOT_MARKED') NULL,
    `to_status` ENUM('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NOT_MARKED') NOT NULL,
    `from_sub_status` ENUM('RIDE_CONFIRMED', 'CONTRACT_ACTIVE', 'ORDER_CONFIRMED', 'FOOD_COLLECTED', 'SERVICE_DELIVERED', 'COMPLETION_REQUESTED') NULL,
    `to_sub_status` ENUM('RIDE_CONFIRMED', 'CONTRACT_ACTIVE', 'ORDER_CONFIRMED', 'FOOD_COLLECTED', 'SERVICE_DELIVERED', 'COMPLETION_REQUESTED') NULL,
    `actor_type` ENUM('USER', 'ADMIN', 'SYSTEM') NOT NULL,
    `actor_id` CHAR(36) NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `activity_status_history_activity_id_created_at_idx`(`activity_id`, `created_at`),
    INDEX `activity_status_history_actor_id_idx`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_requests` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `pickup_address` VARCHAR(255) NOT NULL,
    `pickup_lat` DECIMAL(9, 6) NOT NULL,
    `pickup_lng` DECIMAL(9, 6) NOT NULL,
    `destination_address` VARCHAR(255) NOT NULL,
    `destination_lat` DECIMAL(9, 6) NOT NULL,
    `destination_lng` DECIMAL(9, 6) NOT NULL,
    `offered_amount` DECIMAL(10, 2) NOT NULL,
    `passenger_count` TINYINT NOT NULL,
    `notes` TEXT NULL,
    `sub_area_id` CHAR(36) NOT NULL,
    `route_distance_km` DECIMAL(7, 2) NULL,
    `vehicle_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ride_requests_activity_id_key`(`activity_id`),
    INDEX `ride_requests_sub_area_id_idx`(`sub_area_id`),
    INDEX `ride_requests_vehicle_id_idx`(`vehicle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_offers` (
    `id` CHAR(36) NOT NULL,
    `rider_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `pickup_address` VARCHAR(255) NOT NULL,
    `pickup_lat` DECIMAL(9, 6) NOT NULL,
    `pickup_lng` DECIMAL(9, 6) NOT NULL,
    `destination_address` VARCHAR(255) NOT NULL,
    `destination_lat` DECIMAL(9, 6) NOT NULL,
    `destination_lng` DECIMAL(9, 6) NOT NULL,
    `departure_time` DATETIME(3) NOT NULL,
    `fare_per_seat` DECIMAL(10, 2) NOT NULL,
    `total_seats` TINYINT NOT NULL,
    `seats_available` TINYINT NOT NULL,
    `notes` TEXT NULL,
    `sub_area_id` CHAR(36) NULL,
    `route_distance_km` DECIMAL(7, 2) NULL,
    `status` ENUM('OPEN', 'FULL', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ride_offers_status_departure_time_idx`(`status`, `departure_time`),
    INDEX `ride_offers_rider_id_status_idx`(`rider_id`, `status`),
    INDEX `ride_offers_vehicle_id_idx`(`vehicle_id`),
    INDEX `ride_offers_sub_area_id_idx`(`sub_area_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ride_bookings` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `ride_offer_id` CHAR(36) NOT NULL,
    `seats_booked` TINYINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ride_bookings_activity_id_key`(`activity_id`),
    INDEX `ride_bookings_ride_offer_id_idx`(`ride_offer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_posts` (
    `id` CHAR(36) NOT NULL,
    `rider_id` CHAR(36) NOT NULL,
    `vehicle_id` CHAR(36) NOT NULL,
    `days_of_week` TINYINT NOT NULL,
    `departure_minute` SMALLINT NOT NULL,
    `pickup_address` VARCHAR(255) NOT NULL,
    `pickup_lat` DECIMAL(9, 6) NOT NULL,
    `pickup_lng` DECIMAL(9, 6) NOT NULL,
    `destination_address` VARCHAR(255) NOT NULL,
    `destination_lat` DECIMAL(9, 6) NOT NULL,
    `destination_lng` DECIMAL(9, 6) NOT NULL,
    `total_seats` TINYINT NOT NULL,
    `seats_available` TINYINT NOT NULL,
    `notes` TEXT NULL,
    `valid_from` DATE NOT NULL,
    `valid_until` DATE NULL,
    `status` ENUM('OPEN', 'FULL', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `carpool_posts_rider_id_status_idx`(`rider_id`, `status`),
    INDEX `carpool_posts_status_departure_minute_idx`(`status`, `departure_minute`),
    INDEX `carpool_posts_vehicle_id_idx`(`vehicle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_prices` (
    `id` CHAR(36) NOT NULL,
    `post_id` CHAR(36) NOT NULL,
    `duration_months` TINYINT NOT NULL,
    `monthly_price` DECIMAL(10, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `carpool_prices_post_id_duration_months_key`(`post_id`, `duration_months`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_bookings` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `post_id` CHAR(36) NOT NULL,
    `duration_months` TINYINT NOT NULL,
    `monthly_price` DECIMAL(10, 2) NOT NULL,
    `start_date` DATE NOT NULL,
    `hold_expires_at` DATETIME(3) NULL,
    `rider_agreed_at` DATETIME(3) NULL,
    `passenger_agreed_at` DATETIME(3) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `renewed_from_contract_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `carpool_bookings_activity_id_key`(`activity_id`),
    INDEX `carpool_bookings_post_id_idx`(`post_id`),
    INDEX `carpool_bookings_hold_expires_at_idx`(`hold_expires_at`),
    INDEX `carpool_bookings_renewed_from_contract_id_idx`(`renewed_from_contract_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_contracts` (
    `id` CHAR(36) NOT NULL,
    `booking_id` CHAR(36) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `duration_months` TINYINT NOT NULL,
    `monthly_price` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('ACTIVE', 'ENDED', 'TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    `termination_requested_by_id` CHAR(36) NULL,
    `termination_requested_at` DATETIME(3) NULL,
    `termination_reason` TEXT NULL,
    `terminated_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `carpool_contracts_booking_id_key`(`booking_id`),
    INDEX `carpool_contracts_status_end_date_idx`(`status`, `end_date`),
    INDEX `carpool_contracts_termination_requested_by_id_idx`(`termination_requested_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_sessions` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `contract_id` CHAR(36) NOT NULL,
    `session_date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `carpool_sessions_activity_id_key`(`activity_id`),
    UNIQUE INDEX `carpool_sessions_contract_id_session_date_key`(`contract_id`, `session_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `carpool_monthly_payments` (
    `id` CHAR(36) NOT NULL,
    `contract_id` CHAR(36) NOT NULL,
    `month_number` TINYINT NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` ENUM('CASH', 'BKASH', 'NAGAD') NULL,
    `status` ENUM('UNPAID', 'PAID') NOT NULL DEFAULT 'UNPAID',
    `paid_at` DATETIME(3) NULL,
    `marked_paid_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `carpool_monthly_payments_status_period_start_idx`(`status`, `period_start`),
    INDEX `carpool_monthly_payments_marked_paid_by_id_idx`(`marked_paid_by_id`),
    UNIQUE INDEX `carpool_monthly_payments_contract_id_month_number_key`(`contract_id`, `month_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `food_requests` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `restaurant_name` VARCHAR(150) NOT NULL,
    `restaurant_address` VARCHAR(255) NOT NULL,
    `restaurant_lat` DECIMAL(9, 6) NOT NULL,
    `restaurant_lng` DECIMAL(9, 6) NOT NULL,
    `items` TEXT NOT NULL,
    `details` TEXT NOT NULL,
    `quantity` SMALLINT NOT NULL,
    `estimated_budget` DECIMAL(10, 2) NOT NULL,
    `pickup_address` VARCHAR(255) NOT NULL,
    `pickup_lat` DECIMAL(9, 6) NOT NULL,
    `pickup_lng` DECIMAL(9, 6) NOT NULL,
    `delivery_address` VARCHAR(255) NOT NULL,
    `delivery_lat` DECIMAL(9, 6) NOT NULL,
    `delivery_lng` DECIMAL(9, 6) NOT NULL,
    `sub_area_id` CHAR(36) NOT NULL,
    `delivery_service_amount` DECIMAL(10, 2) NULL,
    `requester_confirmed_at` DATETIME(3) NULL,
    `accepter_confirmed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `food_requests_activity_id_key`(`activity_id`),
    INDEX `food_requests_sub_area_id_idx`(`sub_area_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `food_receipts` (
    `id` CHAR(36) NOT NULL,
    `food_request_id` CHAR(36) NOT NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `file_key` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(50) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `amount` DECIMAL(10, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `food_receipts_food_request_id_idx`(`food_request_id`),
    INDEX `food_receipts_uploaded_by_id_idx`(`uploaded_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_categories` (
    `id` CHAR(36) NOT NULL,
    `code` ENUM('SHOPPING_PURCHASING', 'PARCEL_DELIVERY', 'PHARMACY_HEALTHCARE', 'DOCUMENT_ACADEMIC', 'WARRANTY_REPAIR', 'FINANCIAL_ADMINISTRATIVE', 'CUSTOM_OTHER') NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_categories_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_requests` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `category_id` CHAR(36) NOT NULL,
    `service_title` VARCHAR(150) NOT NULL,
    `task_title` VARCHAR(150) NOT NULL,
    `description` TEXT NOT NULL,
    `destination_address` VARCHAR(255) NOT NULL,
    `destination_lat` DECIMAL(9, 6) NOT NULL,
    `destination_lng` DECIMAL(9, 6) NOT NULL,
    `preferred_date` DATE NOT NULL,
    `has_preferred_time` BOOLEAN NOT NULL DEFAULT false,
    `offered_amount` DECIMAL(10, 2) NOT NULL,
    `item_details` TEXT NULL,
    `quantity` SMALLINT NULL,
    `reference_image_key` VARCHAR(512) NULL,
    `pickup_address` VARCHAR(255) NULL,
    `pickup_lat` DECIMAL(9, 6) NULL,
    `pickup_lng` DECIMAL(9, 6) NULL,
    `sub_area_id` CHAR(36) NULL,
    `estimated_budget` DECIMAL(10, 2) NULL,
    `instructions` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_requests_activity_id_key`(`activity_id`),
    INDEX `service_requests_category_id_idx`(`category_id`),
    INDEX `service_requests_sub_area_id_idx`(`sub_area_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chats` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `last_message_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chats_activity_id_key`(`activity_id`),
    INDEX `chats_last_message_at_idx`(`last_message_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` CHAR(36) NOT NULL,
    `chat_id` CHAR(36) NOT NULL,
    `sender_id` CHAR(36) NULL,
    `kind` ENUM('TEXT', 'IMAGE', 'SYSTEM') NOT NULL DEFAULT 'TEXT',
    `body` TEXT NULL,
    `system_code` VARCHAR(50) NULL,
    `attachment_key` VARCHAR(512) NULL,
    `attachment_mime_type` VARCHAR(50) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `messages_chat_id_created_at_idx`(`chat_id`, `created_at`),
    INDEX `messages_chat_id_read_at_idx`(`chat_id`, `read_at`),
    INDEX `messages_sender_id_created_at_idx`(`sender_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('REQUEST_ACCEPTED', 'SEAT_BOOKED', 'CARPOOL_BOOKING_REQUESTED', 'CARPOOL_BOOKING_ACCEPTED', 'CARPOOL_BOOKING_REJECTED', 'CARPOOL_CONTRACT_CREATED', 'CARPOOL_SESSION_REMINDER', 'ACTIVITY_REMINDER', 'COMPLETION_REQUESTED', 'AUTO_COMPLETED', 'AUTO_CLOSED_NOT_MARKED', 'ACTIVITY_CANCELLED', 'DISPUTE_OPENED', 'DISPUTE_UPDATED', 'DISPUTE_RESOLVED', 'NEW_CHAT_MESSAGE', 'SUB_AREA_NEW_REQUEST', 'STUDENT_VERIFICATION_RESULT', 'RIDER_VERIFICATION_RESULT', 'REQUEST_EXPIRED', 'CARPOOL_PAYMENT_DUE', 'REPORT_UPDATE', 'SUPPORT_UPDATE', 'ANNOUNCEMENT', 'ACCOUNT_STATUS_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_CHANGED', 'LICENCE_EXPIRY_REMINDER') NOT NULL,
    `channel` ENUM('IN_APP', 'PUSH', 'EMAIL') NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `activity_id` CHAR(36) NULL,
    `data` JSON NULL,
    `dedupe_key` VARCHAR(191) NOT NULL,
    `read_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `failure_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `notifications_user_id_channel_read_at_idx`(`user_id`, `channel`, `read_at`),
    INDEX `notifications_status_created_at_idx`(`status`, `created_at`),
    INDEX `notifications_activity_id_idx`(`activity_id`),
    UNIQUE INDEX `notifications_user_id_channel_dedupe_key_key`(`user_id`, `channel`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `endpoint` VARCHAR(512) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `push_subscriptions_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `reviewer_id` CHAR(36) NOT NULL,
    `reviewee_id` CHAR(36) NOT NULL,
    `rating` TINYINT NOT NULL,
    `comment` TEXT NULL,
    `published_at` DATETIME(3) NULL,
    `hidden_at` DATETIME(3) NULL,
    `hidden_by_id` CHAR(36) NULL,
    `hidden_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `reviews_reviewee_id_published_at_idx`(`reviewee_id`, `published_at`),
    INDEX `reviews_reviewer_id_idx`(`reviewer_id`),
    INDEX `reviews_hidden_by_id_idx`(`hidden_by_id`),
    UNIQUE INDEX `reviews_activity_id_reviewer_id_key`(`activity_id`, `reviewer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disputes` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `kind` ENUM('COMPLETION_DISPUTE', 'COMPLAINT', 'EARLY_TERMINATION') NOT NULL,
    `status` ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `raised_by_id` CHAR(36) NOT NULL,
    `against_user_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `status_before` ENUM('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NOT_MARKED') NOT NULL,
    `sub_status_before` ENUM('RIDE_CONFIRMED', 'CONTRACT_ACTIVE', 'ORDER_CONFIRMED', 'FOOD_COLLECTED', 'SERVICE_DELIVERED', 'COMPLETION_REQUESTED') NULL,
    `decided_by_id` CHAR(36) NULL,
    `decided_at` DATETIME(3) NULL,
    `final_status` ENUM('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'DISPUTED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NOT_MARKED') NULL,
    `decision_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `disputes_activity_id_idx`(`activity_id`),
    INDEX `disputes_status_created_at_idx`(`status`, `created_at`),
    INDEX `disputes_raised_by_id_idx`(`raised_by_id`),
    INDEX `disputes_against_user_id_idx`(`against_user_id`),
    INDEX `disputes_decided_by_id_idx`(`decided_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dispute_evidence` (
    `id` CHAR(36) NOT NULL,
    `dispute_id` CHAR(36) NOT NULL,
    `uploaded_by_id` CHAR(36) NOT NULL,
    `file_key` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(50) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `note` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `dispute_evidence_dispute_id_idx`(`dispute_id`),
    INDEX `dispute_evidence_uploaded_by_id_idx`(`uploaded_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` CHAR(36) NOT NULL,
    `reporter_id` CHAR(36) NOT NULL,
    `reported_user_id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NULL,
    `message_id` CHAR(36) NULL,
    `reason` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `evidence_key` VARCHAR(512) NULL,
    `status` ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `resolution_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `reports_reporter_id_idx`(`reporter_id`),
    INDEX `reports_reported_user_id_idx`(`reported_user_id`),
    INDEX `reports_reviewed_by_id_idx`(`reviewed_by_id`),
    INDEX `reports_activity_id_idx`(`activity_id`),
    INDEX `reports_message_id_idx`(`message_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `no_show_reports` (
    `id` CHAR(36) NOT NULL,
    `food_request_id` CHAR(36) NOT NULL,
    `reporter_id` CHAR(36) NOT NULL,
    `reported_user_id` CHAR(36) NOT NULL,
    `description` TEXT NOT NULL,
    `evidence_keys` JSON NOT NULL,
    `status` ENUM('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `reviewed_by_id` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `resolution_note` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `no_show_reports_food_request_id_idx`(`food_request_id`),
    INDEX `no_show_reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `no_show_reports_reporter_id_idx`(`reporter_id`),
    INDEX `no_show_reports_reported_user_id_idx`(`reported_user_id`),
    INDEX `no_show_reports_reviewed_by_id_idx`(`reviewed_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_requests` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `category` ENUM('ACCOUNT', 'VERIFICATION', 'RIDE', 'CARPOOL', 'FOOD', 'SERVICE', 'PAYMENT', 'TECHNICAL', 'APP_FEEDBACK', 'OTHER') NOT NULL,
    `message` TEXT NOT NULL,
    `screenshot_key` VARCHAR(512) NULL,
    `rating` TINYINT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `admin_reply` TEXT NULL,
    `handled_by_id` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `support_requests_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `support_requests_status_created_at_idx`(`status`, `created_at`),
    INDEX `support_requests_handled_by_id_idx`(`handled_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_records` (
    `id` CHAR(36) NOT NULL,
    `activity_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `food_cost` DECIMAL(10, 2) NULL,
    `delivery_charge` DECIMAL(10, 2) NULL,
    `method` ENUM('CASH', 'BKASH', 'NAGAD') NULL,
    `status` ENUM('UNPAID', 'PAID') NOT NULL DEFAULT 'UNPAID',
    `paid_at` DATETIME(3) NULL,
    `marked_paid_by_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payment_records_activity_id_key`(`activity_id`),
    INDEX `payment_records_status_idx`(`status`),
    INDEX `payment_records_marked_paid_by_id_idx`(`marked_paid_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promos` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `image_url` VARCHAR(512) NULL,
    `promo_code` VARCHAR(50) NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `promos_is_active_starts_at_ends_at_idx`(`is_active`, `starts_at`, `ends_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spotlight_items` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(150) NULL,
    `media_type` ENUM('IMAGE', 'VIDEO') NOT NULL,
    `media_url` VARCHAR(512) NOT NULL,
    `link_url` VARCHAR(512) NULL,
    `link_label` VARCHAR(50) NULL,
    `starts_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `spotlight_items_is_active_starts_at_expires_at_idx`(`is_active`, `starts_at`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `banners` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `image_url` VARCHAR(512) NOT NULL,
    `link_url` VARCHAR(512) NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `banners_is_active_starts_at_ends_at_idx`(`is_active`, `starts_at`, `ends_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fare_settings` (
    `id` CHAR(36) NOT NULL,
    `rate_per_km` DECIMAL(8, 2) NOT NULL,
    `effective_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fare_settings_effective_from_idx`(`effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(50) NOT NULL,
    `target_id` CHAR(36) NULL,
    `target_user_id` CHAR(36) NULL,
    `old_value` JSON NULL,
    `new_value` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `audit_logs_admin_id_created_at_idx`(`admin_id`, `created_at`),
    INDEX `audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `audit_logs_target_user_id_created_at_idx`(`target_user_id`, `created_at`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_university_id_fkey` FOREIGN KEY (`university_id`) REFERENCES `universities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `university_domains` ADD CONSTRAINT `university_domains_university_id_fkey` FOREIGN KEY (`university_id`) REFERENCES `universities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_verifications` ADD CONSTRAINT `student_verifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_verifications` ADD CONSTRAINT `student_verifications_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `saved_addresses` ADD CONSTRAINT `saved_addresses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `blocks` ADD CONSTRAINT `blocks_blocker_id_fkey` FOREIGN KEY (`blocker_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `blocks` ADD CONSTRAINT `blocks_blocked_id_fkey` FOREIGN KEY (`blocked_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_actions` ADD CONSTRAINT `moderation_actions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_actions` ADD CONSTRAINT `moderation_actions_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_actions` ADD CONSTRAINT `moderation_actions_dispute_id_fkey` FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_actions` ADD CONSTRAINT `moderation_actions_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `moderation_actions` ADD CONSTRAINT `moderation_actions_no_show_report_id_fkey` FOREIGN KEY (`no_show_report_id`) REFERENCES `no_show_reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sub_areas` ADD CONSTRAINT `user_sub_areas_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sub_areas` ADD CONSTRAINT `user_sub_areas_sub_area_id_fkey` FOREIGN KEY (`sub_area_id`) REFERENCES `sub_areas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rider_applications` ADD CONSTRAINT `rider_applications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rider_applications` ADD CONSTRAINT `rider_applications_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rider_documents` ADD CONSTRAINT `rider_documents_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `rider_applications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `rider_applications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_creator_id_fkey` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_accepter_id_fkey` FOREIGN KEY (`accepter_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_completion_requested_by_id_fkey` FOREIGN KEY (`completion_requested_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activities` ADD CONSTRAINT `activities_cancelled_by_id_fkey` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_status_history` ADD CONSTRAINT `activity_status_history_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_status_history` ADD CONSTRAINT `activity_status_history_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_requests` ADD CONSTRAINT `ride_requests_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_requests` ADD CONSTRAINT `ride_requests_sub_area_id_fkey` FOREIGN KEY (`sub_area_id`) REFERENCES `sub_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_requests` ADD CONSTRAINT `ride_requests_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_offers` ADD CONSTRAINT `ride_offers_rider_id_fkey` FOREIGN KEY (`rider_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_offers` ADD CONSTRAINT `ride_offers_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_offers` ADD CONSTRAINT `ride_offers_sub_area_id_fkey` FOREIGN KEY (`sub_area_id`) REFERENCES `sub_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_bookings` ADD CONSTRAINT `ride_bookings_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ride_bookings` ADD CONSTRAINT `ride_bookings_ride_offer_id_fkey` FOREIGN KEY (`ride_offer_id`) REFERENCES `ride_offers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_posts` ADD CONSTRAINT `carpool_posts_rider_id_fkey` FOREIGN KEY (`rider_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_posts` ADD CONSTRAINT `carpool_posts_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_prices` ADD CONSTRAINT `carpool_prices_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `carpool_posts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_bookings` ADD CONSTRAINT `carpool_bookings_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_bookings` ADD CONSTRAINT `carpool_bookings_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `carpool_posts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_bookings` ADD CONSTRAINT `carpool_bookings_renewed_from_contract_id_fkey` FOREIGN KEY (`renewed_from_contract_id`) REFERENCES `carpool_contracts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_contracts` ADD CONSTRAINT `carpool_contracts_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `carpool_bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_contracts` ADD CONSTRAINT `carpool_contracts_termination_requested_by_id_fkey` FOREIGN KEY (`termination_requested_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_sessions` ADD CONSTRAINT `carpool_sessions_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_sessions` ADD CONSTRAINT `carpool_sessions_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `carpool_contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_monthly_payments` ADD CONSTRAINT `carpool_monthly_payments_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `carpool_contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `carpool_monthly_payments` ADD CONSTRAINT `carpool_monthly_payments_marked_paid_by_id_fkey` FOREIGN KEY (`marked_paid_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_requests` ADD CONSTRAINT `food_requests_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_requests` ADD CONSTRAINT `food_requests_sub_area_id_fkey` FOREIGN KEY (`sub_area_id`) REFERENCES `sub_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_receipts` ADD CONSTRAINT `food_receipts_food_request_id_fkey` FOREIGN KEY (`food_request_id`) REFERENCES `food_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `food_receipts` ADD CONSTRAINT `food_receipts_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `service_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `service_requests` ADD CONSTRAINT `service_requests_sub_area_id_fkey` FOREIGN KEY (`sub_area_id`) REFERENCES `sub_areas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chats` ADD CONSTRAINT `chats_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_chat_id_fkey` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_reviewee_id_fkey` FOREIGN KEY (`reviewee_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_hidden_by_id_fkey` FOREIGN KEY (`hidden_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_raised_by_id_fkey` FOREIGN KEY (`raised_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_against_user_id_fkey` FOREIGN KEY (`against_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_decided_by_id_fkey` FOREIGN KEY (`decided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispute_evidence` ADD CONSTRAINT `dispute_evidence_dispute_id_fkey` FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispute_evidence` ADD CONSTRAINT `dispute_evidence_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reported_user_id_fkey` FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `no_show_reports` ADD CONSTRAINT `no_show_reports_food_request_id_fkey` FOREIGN KEY (`food_request_id`) REFERENCES `food_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `no_show_reports` ADD CONSTRAINT `no_show_reports_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `no_show_reports` ADD CONSTRAINT `no_show_reports_reported_user_id_fkey` FOREIGN KEY (`reported_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `no_show_reports` ADD CONSTRAINT `no_show_reports_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_requests` ADD CONSTRAINT `support_requests_handled_by_id_fkey` FOREIGN KEY (`handled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_records` ADD CONSTRAINT `payment_records_activity_id_fkey` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_records` ADD CONSTRAINT `payment_records_marked_paid_by_id_fkey` FOREIGN KEY (`marked_paid_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_target_user_id_fkey` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
