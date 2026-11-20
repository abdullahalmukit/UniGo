-- CreateTable
CREATE TABLE `match_suggestions` (
    `id` CHAR(36) NOT NULL,
    `viewer_id` CHAR(36) NOT NULL,
    `feature` VARCHAR(16) NOT NULL,
    `target` VARCHAR(16) NOT NULL,
    `candidate_id` CHAR(36) NOT NULL,
    `source_id` CHAR(36) NULL,
    `rank` TINYINT NOT NULL,
    `score` DECIMAL(5, 4) NOT NULL,
    `components` JSON NOT NULL,
    `shown_at` DATETIME(3) NOT NULL,
    `taken_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `match_suggestions_viewer_id_candidate_id_shown_at_idx`(`viewer_id`, `candidate_id`, `shown_at`),
    INDEX `match_suggestions_shown_at_idx`(`shown_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `match_suggestions` ADD CONSTRAINT `match_suggestions_viewer_id_fkey` FOREIGN KEY (`viewer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
