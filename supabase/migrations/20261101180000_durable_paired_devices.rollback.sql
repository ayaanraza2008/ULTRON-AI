-- ULTRON AI — DESTRUCTIVE ROLLBACK
-- Migration: 20261101180000_durable_paired_devices.sql
--
-- WARNING: This permanently deletes paired-device metadata and pending pairing
-- records. Export/backup required data before running. Do not run in production
-- without explicit owner approval. No CASCADE is used: unexpected dependencies
-- cause the transaction to fail rather than silently dropping dependent objects.

begin;

drop function if exists public.claim_pending_device_pairing(text);
drop table if exists public.pending_device_pairings;
drop table if exists public.paired_devices;

commit;
