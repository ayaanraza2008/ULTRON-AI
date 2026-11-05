-- Rollback for 20261106000000_multidevice_state_persistence.sql
-- DESTRUCTIVE: Drops table ultron_multidevice_state and with it all persisted
-- multi-device state and delivery queues. Never execute without explicit owner authorization;
-- ensure backend has fallen back to local file persistence or export state prior to running.

drop table if exists public.ultron_multidevice_state cascade;
