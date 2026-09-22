import { APPS_SCRIPT_URL } from './config.js';

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

export async function getActivities() {
  const data = await call({ action: 'getActivities' });
  return data.activities;
}

export async function addActivity(person, activity, timestamp) {
  const data = await call({ action: 'addActivity', person, activity, timestamp });
  return data.activity;
}

export async function deleteActivity(id) {
  await call({ action: 'deleteActivity', id });
}
