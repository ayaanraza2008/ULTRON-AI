-- Roll back only the atomic RPC added by the paired forward migration.
drop function if exists public.save_ultron_multidevice_state(text, jsonb, integer);
