'use strict';

// The Spinners — pub location for geofenced clock in/out.
// Source coordinates: 53°41'18.1"N 2°27'52.7"W
const PUB_LAT = 53.688361111111116;
const PUB_LNG = -2.4646388888888888;
const RADIUS_METERS = 50;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in metres
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Checks a lat/lng pair against the pub location. Returns { ok, distance }.
// distance is in metres, rounded to the nearest whole number (or null if
// the input coordinates were invalid).
function checkWithinRadius(lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum) || (latNum === 0 && lngNum === 0)) {
    return { ok: false, distance: null };
  }
  const distance = Math.round(haversineMeters(PUB_LAT, PUB_LNG, latNum, lngNum));
  return { ok: distance <= RADIUS_METERS, distance };
}

module.exports = { PUB_LAT, PUB_LNG, RADIUS_METERS, haversineMeters, checkWithinRadius };
