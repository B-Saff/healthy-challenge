// Healthy Challenge API — thin layer between the static frontend and the
// "Activities" Google Sheet. Deploy as a Web App (Execute as: Me,
// Access: Anyone). See README.md for setup steps.

var SHEET_NAME = 'Activities';
var PEOPLE = ['Ben', 'Chelsea'];
var ACTIVITY_TYPES = ['gym', 'dog_walk', 'reading', 'unhealthy_choice'];
var HEADERS = ['ID', 'Person', 'Activity', 'Timestamp', 'Date', 'Deleted'];

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

function getActivities() {
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  var rows = values.slice(1); // drop header row
  var activities = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue; // skip blank rows
    activities.push({
      id: String(row[0]),
      person: row[1],
      activity: row[2],
      timestamp: row[3],
      date: row[4],
      deleted: row[5] === true || row[5] === 'TRUE',
    });
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

  return { id: id, person: person, activity: activity, timestamp: timestamp, date: date, deleted: false };
}

function deleteActivity(id) {
  if (!id) {
    throw new Error('Missing id');
  }
  var sheet = getSheet();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.getRange(i + 1, 6).setValue(true); // Deleted column
      return;
    }
  }
  throw new Error('Activity not found: ' + id);
}
