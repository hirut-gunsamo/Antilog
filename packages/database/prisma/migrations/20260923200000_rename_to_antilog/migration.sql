-- The system is called AntiLog.
--
-- The name is a setting, so the Owner can still change it in the app; this
-- only moves the default, and renames the one row that still carries the old
-- placeholder. A name the Owner has already chosen is left alone.
--
-- Hand-written like every migration here: guards exist on this database that
-- do not appear in schema.prisma, and drift detection would offer to drop them.

ALTER TABLE "AppSetting" ALTER COLUMN "systemName" SET DEFAULT 'AntiLog';

UPDATE "AppSetting"
SET "systemName" = 'AntiLog'
WHERE "systemName" = 'SIM Card and Phone Management System';
