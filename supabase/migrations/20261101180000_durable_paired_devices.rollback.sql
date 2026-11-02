-- ULTRON AI — Rollback Procedure
-- Migration: 20261101180000_durable_paired_devices.sql
-- Description: Safely drops paired devices registry and atomic pairing RPC function if rollback is required by operator.

begin;

drop function if exists public.claim_pending_device_pairing(text);
drop table if exists public.pending_device_pairings cascade;
drop table if exists public.paired_devices cascade;

commit;
