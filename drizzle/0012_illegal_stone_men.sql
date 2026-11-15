ALTER TABLE `lessons` ADD `announced_at` text;--> statement-breakpoint
UPDATE `lessons` SET `announced_at` = `created_at`;