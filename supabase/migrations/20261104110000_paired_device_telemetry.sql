-- Persist minimal companion battery telemetry for owner-scoped device heartbeats.
-- Safe to apply more than once; this does not rewrite or delete paired-device data.

alter table public.paired_devices
  add column if not exists battery_percent smallint
    check (battery_percent is null or battery_percent between 0 and 100);

alter table public.paired_devices
  add column if not exists is_charging boolean;
