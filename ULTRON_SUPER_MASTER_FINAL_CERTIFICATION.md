# ULTRON AI — Release-Candidate Verification Ledger

**Repository:** `ayaanraza2008/ULTRON-AI`  
**Target branch:** `main`  
**Development PR:** [#478](https://github.com/ayaanraza2008/ULTRON-AI/pull/478)  
**Working branch:** `feat/ultron-operation-infinity-multidevice`  
**Production workspace:** Render — `Ultron core`

> **Status: RELEASE CANDIDATE — NOT A PRODUCTION CERTIFICATION.**

## Product definition

ULTRON is a private, single-owner personal AI software ecosystem for Windows computers, Android devices, browsers and future personal clients. Its scope is intelligence, memory, task execution, research, voice, vision, desktop assistance, secure multi-device synchronization and the Living Core interface.

## Evidence rules

- Green CI proves only the jobs that ran on the exact commit.
- Unit tests and mocked adapters do not prove live external services.
- A successful companion build does not prove physical-device operation.
- A health endpoint does not prove authenticated inference or data persistence.
- No score or completion percentage may be copied from an earlier commit.

## Current release gates

1. Exact latest PR-head CI must complete successfully.
2. Remote PostgreSQL TLS verification must remain mandatory; unsafe URL, environment and option overrides must not disable it.
3. Cloud state must be proven durable across service restart/replacement; local fallback storage is not sufficient proof.
4. Browser, Windows and Android synchronization must pass receive/apply/ACK, retry, reconnect, revoke and owner-isolation tests.
5. At least one authenticated live AI inference request must succeed through a configured provider.
6. Owner-only production configuration must be verified without exposing secrets.
7. Windows and Android companions require physical pairing and operation checks.
8. Real microphone, speaker, camera and screen-observation flows require hardware acceptance on supported clients.

## Deployment boundary

The Render backend tracks `main` for automatic deployment. Keep PR #478 unmerged and do not deploy, change production environment settings, sync a production Blueprint, or apply production migrations until the owner explicitly issues `DEPLOY`.

## Canonical records

- [Engineering Audit](ULTRON_FINAL_ENGINEERING_AUDIT.md)
- [Production Readiness](ULTRON_PRODUCTION_READINESS.md)
- [Device Acceptance](ULTRON_DEVICE_ACCEPTANCE.md)
