# ULTRON AI — Release Checklist

## Code and CI

- [ ] Exact current PR-head syntax check passes.
- [ ] Exact current PR-head full test suite passes.
- [ ] Exact current PR-head security quality gate passes.
- [ ] Windows companion build passes on exact current PR head.
- [ ] Android companion build passes on exact current PR head.
- [ ] World-intelligence build passes on exact current PR head.
- [ ] Final diff reviewed; no stale route tests, removed-file references or secret findings remain.

## Runtime and data

- [ ] Required Supabase migrations are reviewed and applied only with explicit authorization.
- [ ] `paired_devices`, `pending_device_pairings`, and `ultron_multidevice_state` exist with correct access controls.
- [ ] Cloud persistence survives service restart/replacement; local fallback is not counted.
- [ ] Owner and non-owner isolation verified against the live service.
- [ ] One authenticated live AI completion succeeds through a configured provider.
- [ ] Browser, Windows and Android receive/apply/ACK/reconnect/revoke workflows verified.

## Client acceptance

- [ ] Physical Windows companion pairing and supported actions verified.
- [ ] Physical Android companion pairing and background sync verified.
- [ ] Real microphone/speaker workflow verified on supported hardware.
- [ ] Real camera/screen observation verified with permission and privacy indicators.

## Release authorization

- [ ] Owner explicitly authorizes `DEPLOY`.
- [ ] Confirm Render workspace `Ultron core` and the exact production revision.
- [ ] Only then perform the authorized release procedure.

**Current decision:** Do not merge or deploy until the applicable checks are complete and the owner explicitly authorizes release.
