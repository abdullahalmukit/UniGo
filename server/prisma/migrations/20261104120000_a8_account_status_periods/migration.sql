-- AlterTable
ALTER TABLE `users` ADD COLUMN `restricted_until` DATETIME(3) NULL,
    ADD COLUMN `suspended_from` DATETIME(3) NULL;
