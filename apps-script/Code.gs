// Healthy Challenge API — thin layer between the static frontend and the
// "Activities" Google Sheet. Deploy as a Web App (Execute as: Me,
// Access: Anyone). See README.md for setup steps.

var SHEET_NAME = 'Activities';
var PEOPLE = ['Ben', 'Chelsea'];
var ACTIVITY_TYPES = ['gym', 'dog_walk', 'reading', 'unhealthy_choice'];
var HEADERS = ['ID', 'Person', 'Activity', 'Timestamp', 'Date', 'Deleted'];
var ACTIVITIES_CACHE_TTL = 600;
var VERSION_CACHE_TTL = 21600;

function doGet(e) {
  var action = (e.parameter.action || '').trim();
  try {
    var result;
    if (action === 'getActivities') {
      result = { success: true, activities: getActivities() };
    } else if (action === 'addActivity') {
      result = { success: true, activity: addActivity(e.parameter.person, e.parameter.activity, e.parameter.timestamp) };
    } else if (action === 'deleteActivity') {
      deleteActivity(e.parameter.id);
      result = { success: true };
    } else {
      result = { success: false, error: 'Unknown action: ' + action };
    }
    return jsonOutput(result);
  } catch (err) {
    return jsonOutput({ success: false, error: err.message });
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet "' + SHEET_NAME + '" not found. Create it with headers: ' + HEADERS.join(', '));
  }
  return sheet;
}

function spreadsheetTimeZone() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
}

// Date cells come back as Date objects and JSON turns them into UTC
// instants. Always send calendar strings the page can match.
function asDateString(value, tz) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  var text = String(value);
  var t = text.indexOf('T');
  return t === -1 ? text : text.substring(0, t);
}

function asTimestampString(value, tz) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(value).replace(' ', 'T');
}

function isDeletedCell(value) {
  if (value === true) return true;
  if (value === false || value === '') return false;
  return String(value).toUpperCase() === 'TRUE';
}

function activitiesCache() {
  return CacheService.getScriptCache();
}

function activitiesVersion(cache) {
  return cache.get('activities-version') || '0';
}

function invalidateActivitiesCache() {
  activitiesCache().put('activities-version', String(new Date().getTime()), VERSION_CACHE_TTL);
}

function readActivitiesFromSheet() {
  var sheet = getSheet();
  var tz = spreadsheetTimeZone();
  var values = sheet.getDataRange().getValues();
  var rows = values.slice(1); // drop header row
  var activities = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue; // skip blank rows
    // Soft-deleted rows stay in the Sheet as an audit log. The app only
    // needs live events, so they are left out of the payload.
    if (isDeletedCell(row[5])) continue;
    activities.push({
      id: String(row[0]),
      person: row[1],
      activity: row[2],
      timestamp: asTimestampString(row[3], tz),
      date: asDateString(row[4], tz),
      deleted: false,
    });
  }
  return activities;
}

function getActivities() {
  var cache = activitiesCache();
  var version = activitiesVersion(cache);
  var hit = cache.get('activities-' + version);
  if (hit) return JSON.parse(hit);

  var activities = readActivitiesFromSheet();
  // Skip the write if a save landed while this read was in progress.
  if (activitiesVersion(cache) === version) {
    var payload = JSON.stringify(activities);
    if (payload.length < 90000) {
      cache.put('activities-' + version, payload, ACTIVITIES_CACHE_TTL);
    }
  }
  return activities;
}

function addActivity(person, activity, timestamp) {
  if (PEOPLE.indexOf(person) === -1) {
    throw new Error('Invalid person: ' + person);
  }
  if (ACTIVITY_TYPES.indexOf(activity) === -1) {
    throw new Error('Invalid activity: ' + activity);
  }
  if (!timestamp) {
    throw new Error('Missing timestamp');
  }

  var date = String(timestamp).split('T')[0];
  var id = Utilities.getUuid();
  var sheet = getSheet();
  sheet.appendRow([id, person, activity, timestamp, date, false]);
  invalidateActivitiesCache();

  return { id: id, person: person, activity: activity, timestamp: timestamp, date: date, deleted: false };
}

function deleteActivity(id) {
  if (!id) {
    throw new Error('Missing id');
  }
  var sheet = getSheet();
  var cell = sheet.createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!cell) {
    throw new Error('Activity not found: ' + id);
  }
  sheet.getRange(cell.getRow(), 6).setValue(true); // Deleted column
  invalidateActivitiesCache();
}
