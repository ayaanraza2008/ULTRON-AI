-- Index the approving user foreign key for device-pairing lookups and cleanup.
create index if not exists pending_device_pairings_approved_by_idx
  on public.pending_device_pairings (approved_by);
