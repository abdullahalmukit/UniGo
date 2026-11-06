-- B2b: each participant's read position replaces messages.read_at, which could
-- hold only one value per message (system messages are unread for both users).
-- The (chat_id, created_at) index keeps serving the chat_id foreign key.
DROP INDEX `messages_chat_id_read_at_idx` ON `messages`;
ALTER TABLE `messages` DROP COLUMN `read_at`;

CREATE TABLE `chat_reads` (
    `chat_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `last_read_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `chat_reads_user_id_idx`(`user_id`),
    PRIMARY KEY (`chat_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `chat_reads` ADD CONSTRAINT `chat_reads_chat_id_fkey` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `chat_reads` ADD CONSTRAINT `chat_reads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
