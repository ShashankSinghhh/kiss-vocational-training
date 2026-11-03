-- Programmes: groups of related courses. Students choose a programme, then one course in it.
CREATE TABLE "programmes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "programmes_name_key" ON "programmes"("name");

ALTER TABLE "courses" ADD COLUMN "programme_id" UUID;
CREATE INDEX "courses_programme_id_idx" ON "courses"("programme_id");
ALTER TABLE "courses" ADD CONSTRAINT "courses_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
