-- Rollback for 20261104110000_paired_device_telemetry.sql
-- DESTRUCTIVE: drops the battery telemetry columns and with them any persisted
-- battery data on paired devices. Never run without explicit owner
-- authorization; verify no heartbeat writer depends on these columns first.

alter table public.paired_devices
  drop column if exists battery_percent;

alter table public.paired_devices
  drop column if exists is_charging;
