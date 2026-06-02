-- AlterTable
ALTER TABLE "print_materials"
    ADD COLUMN "nozzle_temp_c" INTEGER,
    ADD COLUMN "bed_temp_c" INTEGER,
    ADD COLUMN "max_speed_mm_s" INTEGER;
