import test from "node:test";
import assert from "node:assert/strict";
import {
  geoIntelligence,
  GeographicIntelligence
} from "../system/geo-intel.js";

test("GeographicIntelligence: Haversine distance matches expected real-world benchmarks", () => {
  const geo = new GeographicIntelligence();
  // NYC (40.7128, -74.0060) to London (51.5074, -0.1278) ~5570 km
  const nycToLondon = geo.calculateDistanceKm(40.7128, -74.0060, 51.5074, -0.1278);
  assert.ok(nycToLondon > 5500 && nycToLondon < 5600);

  // Zero distance for identical coordinates
  const zeroDist = geo.calculateDistanceKm(28.6139, 77.2090, 28.6139, 77.2090);
  assert.equal(zeroDist, 0);
});

test("GeographicIntelligence: Bearing calculation produces accurate compass headings", () => {
  const geo = new GeographicIntelligence();
  // Due North (lat 0 to lat 10, same lon)
  const bearingNorth = geo.calculateBearing(0, 0, 10, 0);
  assert.equal(bearingNorth, 0);

  // Due East (lon 0 to lon 10, same lat at equator)
  const bearingEast = geo.calculateBearing(0, 0, 0, 10);
  assert.equal(bearingEast, 90);

  // Due South
  const bearingSouth = geo.calculateBearing(10, 0, 0, 0);
  assert.equal(bearingSouth, 180);

  // Due West
  const bearingWest = geo.calculateBearing(0, 10, 0, 0);
  assert.equal(bearingWest, 270);
});

test("GeographicIntelligence: Route estimation computes transit duration and distance", () => {
  const geo = new GeographicIntelligence();
  const origin = { lat: 37.7749, lon: -122.4194 }; // San Francisco
  const dest = { lat: 37.3382, lon: -121.8863 }; // San Jose ~67-75 km

  const routeDriving = geo.estimateRoute(origin, dest, "driving");
  assert.ok(routeDriving.distanceKm > 60 && routeDriving.distanceKm < 80);
  assert.ok(routeDriving.estimatedMinutes > 60 && routeDriving.estimatedMinutes < 120);

  const routeWalking = geo.estimateRoute(origin, dest, "walking");
  assert.ok(routeWalking.estimatedMinutes > routeDriving.estimatedMinutes);
});

test("GeographicIntelligence: Privacy gating requires valid consent token with TTL", () => {
  const geo = new GeographicIntelligence();

  // Access without consent token must fail closed
  const noToken = geo.verifyLocationAccess(null);
  assert.equal(noToken.allowed, false);
  assert.equal(noToken.error, "NO_CONSENT_TOKEN_PROVIDED");

  // Create consent token for device
  const consent = geo.createLocationConsentToken("owner-123", "mobile-device-01", 15);
  assert.ok(consent.token);
  assert.equal(consent.ownerUserId, "owner-123");
  assert.equal(consent.deviceId, "mobile-device-01");

  // Valid verification
  const validAccess = geo.verifyLocationAccess(consent.token, "requester-system");
  assert.equal(validAccess.allowed, true);
  assert.equal(validAccess.deviceId, "mobile-device-01");

  // Audit logs must record both grant and access
  const logs = geo.getAuditLogs(10);
  assert.ok(logs.some(l => l.action === "GRANT_CONSENT"));
  assert.ok(logs.some(l => l.action === "ACCESS_LOCATION"));
});

test("GeographicIntelligence: Immediate revocation and token expiration safeguards", () => {
  const geo = new GeographicIntelligence();
  const consent = geo.createLocationConsentToken("owner-user", "robot-rover", 15);

  // Revoke consent
  const revocation = geo.revokeLocationSharing(consent.token);
  assert.equal(revocation.success, true);
  assert.equal(revocation.revoked, true);

  // Access after revocation fails
  const accessRevoked = geo.verifyLocationAccess(consent.token);
  assert.equal(accessRevoked.allowed, false);

  // Expired token test (0 minute TTL)
  const expiredConsent = geo.createLocationConsentToken("owner-user", "drone-01", -1);
  const accessExpired = geo.verifyLocationAccess(expiredConsent.token);
  assert.equal(accessExpired.allowed, false);
  assert.equal(accessExpired.error, "CONSENT_TOKEN_EXPIRED");
});
