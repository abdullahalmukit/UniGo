-- B3a: why a ride offer was closed, the amount of each ride booking (fare per
-- seat x seats when booked), and an index for a rider's offers near a time.
-- ride_bookings is empty before B3a, so the required column needs no default.
-- AlterTable
ALTER TABLE `ride_bookings` ADD COLUMN `amount` DECIMAL(10, 2) NOT NULL;
-- AlterTable
ALTER TABLE `ride_offers` ADD COLUMN `close_reason` ENUM('DEPARTED', 'CANCELLED_BY_RIDER', 'STOPPED_BY_RIDER', 'REMOVED_BY_RIDER', 'ACCOUNT_MODERATED') NULL;
-- CreateIndex
CREATE INDEX `ride_offers_rider_id_departure_time_idx` ON `ride_offers`(`rider_id`, `departure_time`);
