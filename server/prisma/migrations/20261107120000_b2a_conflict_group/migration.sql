-- B2a: activities that share a parent post (ride offer, carpool post) never
-- conflict with each other in the 90-minute check.
ALTER TABLE `activities` ADD COLUMN `conflict_group_id` CHAR(36) NULL;
CREATE INDEX `activities_conflict_group_id_idx` ON `activities`(`conflict_group_id`);
