-- CreateTable
CREATE TABLE `skills` (
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `technicians` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `city` VARCHAR(64) NOT NULL,
    `status` ENUM('AVAILABLE', 'BUSY', 'OFF_DUTY') NOT NULL DEFAULT 'AVAILABLE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `technician_skills` (
    `technician_id` INTEGER NOT NULL,
    `skill_code` VARCHAR(32) NOT NULL,

    PRIMARY KEY (`technician_id`, `skill_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `city` VARCHAR(64) NOT NULL,
    `required_skill_code` VARCHAR(32) NOT NULL,
    `status` ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'OPEN',
    `technician_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `assigned_at` DATETIME(3) NULL,
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `work_orders_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(64) NOT NULL,
    `work_order_id` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    `publish_attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(500) NULL,

    INDEX `outbox_events_published_at_created_at_idx`(`published_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `technician_skills` ADD CONSTRAINT `technician_skills_technician_id_fkey` FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `technician_skills` ADD CONSTRAINT `technician_skills_skill_code_fkey` FOREIGN KEY (`skill_code`) REFERENCES `skills`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_required_skill_code_fkey` FOREIGN KEY (`required_skill_code`) REFERENCES `skills`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_technician_id_fkey` FOREIGN KEY (`technician_id`) REFERENCES `technicians`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Hand-written: Prisma cannot express CHECK constraints.
-- A work order has a technician exactly when it has left the OPEN state.
ALTER TABLE `work_orders` ADD CONSTRAINT `work_orders_technician_matches_status_chk` CHECK ((`status` = 'OPEN') = (`technician_id` IS NULL));
