-- National ID: the Owner approves the names to print, and the supervisor
-- confirms a returned request was received. The status guards from
-- 20261002090000 allowed neither, so both writes failed with 23514.
--
-- A request is APPROVED once any of its names are; a name is APPROVED until it
-- is sent back as DONE or LEFTOVER.

ALTER TABLE "NationalIdRequest" DROP CONSTRAINT "NationalIdRequest_status_check";
ALTER TABLE "NationalIdRequest" ADD CONSTRAINT "NationalIdRequest_status_check"
    CHECK ("status" IN ('WITH_SUPERVISOR', 'WITH_OWNER', 'APPROVED', 'RETURNED', 'RECEIVED'));

ALTER TABLE "NationalIdOrder" DROP CONSTRAINT "NationalIdOrder_status_check";
ALTER TABLE "NationalIdOrder" ADD CONSTRAINT "NationalIdOrder_status_check"
    CHECK ("status" IN ('REGISTERED', 'REQUESTED', 'AT_OWNER', 'APPROVED', 'DONE', 'LEFTOVER'));
