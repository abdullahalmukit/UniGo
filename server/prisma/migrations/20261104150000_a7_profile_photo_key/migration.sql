-- A7: the profile photo is a private storage key, not a public URL.
ALTER TABLE `profiles` RENAME COLUMN `photo_url` TO `photo_key`;
ALTER TABLE `profiles` MODIFY `photo_key` VARCHAR(100) NULL;
