-- CreateTable
CREATE TABLE "print_materials" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filament_type" TEXT NOT NULL DEFAULT 'FLEX',
    "is_custom_slot" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "printer_materials" (
    "printer_id" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "printer_materials_pkey" PRIMARY KEY ("printer_id","material_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_materials_org_id_name_key" ON "print_materials"("org_id", "name");

-- AddForeignKey
ALTER TABLE "print_materials" ADD CONSTRAINT "print_materials_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_materials" ADD CONSTRAINT "printer_materials_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printer_materials" ADD CONSTRAINT "printer_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "print_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
