import { APPS_SCRIPT_URL } from './config.js';
import { normalizeActivity } from './scoring.js';

const CACHE_KEY = 'hc-activities-v1';

// All calls are GET with query params. This keeps every request a CORS
// "simple request" so the Apps Script web app can be called directly from
// GitHub Pages with no preflight handling required.
async function call(params) {
  const url = new URL(APPS_SCRIPT_URL);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export function loadCachedActivities() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(normalizeActivity);
  } catch {
    return null;
  }
}

export function rememberActivities(activities) {
  try {
    const confirmed = activities
      .filter((a) => a && !a.pending)
      .map((a) => ({
        id: a.id,
        person: a.person,
        activity: a.activity,
        timestamp: a.timestamp,
        date: a.date,
        deleted: a.deleted === true,
      }));
    localStorage.setItem(CACHE_KEY, JSON.stringify(confirmed));
  } catch {
    // A full or blocked cache should not stop logging.
  }
}

// Keep taps made while a refresh is in flight. The server snapshot can be
// a few seconds older than what is already on screen.
export function mergeActivities(local, fresh, sessionIds) {
  const pending = local.filter((a) => a.pending);
  const deletedIds = new Set(
    local.filter((a) => a.deleted && !a.pending).map((a) => a.id)
  );
  const freshIds = new Set(fresh.map((a) => a.id));
  const extras = local.filter(
    (a) => sessionIds.has(a.id) && !a.pending && !freshIds.has(a.id)
  );
  return fresh
    .map((a) => (deletedIds.has(a.id) ? { ...a, deleted: true } : a))
    .concat(extras, pending);
}

export async function getActivities() {
  const data = await call({ action: 'getActivities' });
  return data.activities.map(normalizeActivity);
}

export async function addActivity(person, activity, timestamp) {
  const data = await call({ action: 'addActivity', person, activity, timestamp });
  return data.activity;
}

export async function deleteActivity(id) {
  await call({ action: 'deleteActivity', id });
}
