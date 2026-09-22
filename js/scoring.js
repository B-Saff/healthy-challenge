// Pure scoring logic. Everything is derived from the raw activity event
// list so the scoreboard can always be reconstructed from the Sheet.

export const PEOPLE = ['Ben', 'Chelsea'];

export const ACTIVITY_TYPES = {
  gym: { label: 'Gym', icon: '🏋️' },
  dog_walk: { label: 'Dog Walk', icon: '🐕' },
  reading: { label: 'Nightly Reading', icon: '📖' },
  unhealthy_choice: { label: 'Unhealthy Choice', icon: '🍔' },
};

export const DAILY_ACTIVITY_LIMITS = {
  gym: 1,
  dog_walk: 4,
};

export function canAddDailyActivity(breakdown, activity) {
  const limit = DAILY_ACTIVITY_LIMITS[activity];
  if (limit == null) return true;
  if (activity === 'gym') return breakdown.gymCount < limit;
  if (activity === 'dog_walk') return breakdown.dogWalkCount < limit;
  return true;
}

const DINNER_THRESHOLD = 35;
const MASSAGE_THRESHOLD = 100;
const WINKY_THRESHOLD = 20;
const WEEKEND_TRIP_THRESHOLD = 250;

export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localTimestamp(date = new Date()) {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  return `${localDateString(date)}T${time}`;
}

// Google Sheets returns date cells as UTC instants. For this spreadsheet
// those instants are midnight in a US timezone, so the calendar date is
// the YYYY-MM-DD prefix. Values that are already YYYY-MM-DD stay as-is.
export function sheetDateString(value) {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(value ?? '');
}

export function sheetTimestampString(value) {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return localTimestamp(d);
}

export function normalizeActivity(activity) {
  return {
    ...activity,
    date: sheetDateString(activity.date),
    timestamp: sheetTimestampString(activity.timestamp),
    deleted: activity.deleted === true || String(activity.deleted).toUpperCase() === 'TRUE',
  };
}

// Monday-Sunday range containing `date`, as local YYYY-MM-DD strings.
export function getWeekRange(date = new Date()) {
  const day = date.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: localDateString(monday), end: localDateString(sunday) };
}

function activeEvents(activities) {
  return activities.filter((a) => !a.deleted);
}

// Point value for each dog walk in a day depends only on how many dog
// walks that person had already logged that day, in chronological order.
function dogWalkValue(indexInDay) {
  return indexInDay < 2 ? 0.5 : 0.25;
}

// Gym + 3 dog walks + reading, no unhealthy choices.
export function perfectDayNetPoints() {
  let walkPts = 0;
  for (let i = 0; i < 3; i += 1) walkPts += dogWalkValue(i);
  return 2 + walkPts + 0.5;
}

export function perfectDaysNeeded(pointsRemaining) {
  if (pointsRemaining <= 0) return 0;
  return Math.ceil(pointsRemaining / perfectDayNetPoints());
}

// Breakdown + net points for one person on one local calendar date.
export function computeDailyBreakdown(activities, person, date) {
  const events = activeEvents(activities).filter(
    (a) => a.person === person && a.date === date
  );

  const gymCount = events.filter((a) => a.activity === 'gym').length;

  const dogWalks = events
    .filter((a) => a.activity === 'dog_walk')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const dogWalkPoints = dogWalks.reduce(
    (sum, _walk, i) => sum + dogWalkValue(i),
    0
  );

  const readingDone = events.some((a) => a.activity === 'reading');
  const unhealthyCount = events.filter(
    (a) => a.activity === 'unhealthy_choice'
  ).length;

  const points =
    gymCount * 2 +
    dogWalkPoints +
    (readingDone ? 0.5 : 0) +
    unhealthyCount * -3;

  return {
    gymCount,
    dogWalkCount: dogWalks.length,
    dogWalkPoints,
    readingDone,
    unhealthyCount,
    points,
  };
}

export function dailyPointsByActivity(activities, person, date) {
  const b = computeDailyBreakdown(activities, person, date);
  return {
    gym: b.gymCount * 2,
    dog_walk: b.dogWalkPoints,
    reading: b.readingDone ? 0.5 : 0,
    unhealthy_choice: b.unhealthyCount * -3,
  };
}

function datesForPerson(activities, person, { start, end } = {}) {
  const dates = new Set();
  for (const a of activeEvents(activities)) {
    if (a.person !== person) continue;
    if (start && a.date < start) continue;
    if (end && a.date > end) continue;
    dates.add(a.date);
  }
  return dates;
}

// Total points for a person, optionally restricted to a local date range
// (inclusive). Omit the range for lifetime totals.
export function totalPointsForPerson(activities, person, range = {}) {
  let total = 0;
  for (const date of datesForPerson(activities, person, range)) {
    total += computeDailyBreakdown(activities, person, date).points;
  }
  return total;
}

export function computeWeeklyStandings(activities, date = new Date()) {
  const range = getWeekRange(date);
  const scores = {};
  for (const person of PEOPLE) {
    scores[person] = totalPointsForPerson(activities, person, range);
  }
  const [a, b] = PEOPLE;
  const diff = scores[a] - scores[b];
  const tie = diff === 0;
  const leader = tie ? null : diff > 0 ? a : b;
  return { range, scores, leader, tie, diff: Math.abs(diff) };
}

export function computeRewards(lifetimePoints) {
  const dinners = Math.floor(lifetimePoints / DINNER_THRESHOLD);
  const massages = Math.floor(lifetimePoints / MASSAGE_THRESHOLD);
  const winks = Math.floor(lifetimePoints / WINKY_THRESHOLD);
  return {
    dinners,
    dinnerProgress: lifetimePoints - dinners * DINNER_THRESHOLD,
    dinnerRemaining: DINNER_THRESHOLD - (lifetimePoints - dinners * DINNER_THRESHOLD),
    massages,
    massageProgress: lifetimePoints - massages * MASSAGE_THRESHOLD,
    massageRemaining: MASSAGE_THRESHOLD - (lifetimePoints - massages * MASSAGE_THRESHOLD),
    winks,
    winkyProgress: lifetimePoints - winks * WINKY_THRESHOLD,
    winkyThreshold: WINKY_THRESHOLD,
  };
}

export function computeWeekendTrip(lifetimeByPerson) {
  const progress = {};
  for (const person of PEOPLE) {
    progress[person] = {
      points: lifetimeByPerson[person],
      reached: lifetimeByPerson[person] >= WEEKEND_TRIP_THRESHOLD,
      remaining: Math.max(0, WEEKEND_TRIP_THRESHOLD - lifetimeByPerson[person]),
    };
  }
  const unlocked = PEOPLE.every((p) => progress[p].reached);
  return { threshold: WEEKEND_TRIP_THRESHOLD, progress, unlocked };
}

export function computeLifetimeSummary(activities) {
  const summary = {};
  for (const person of PEOPLE) {
    const lifetimePoints = totalPointsForPerson(activities, person);
    summary[person] = {
      lifetimePoints,
      rewards: computeRewards(lifetimePoints),
    };
  }
  summary.weekendTrip = computeWeekendTrip({
    Ben: summary.Ben.lifetimePoints,
    Chelsea: summary.Chelsea.lifetimePoints,
  });
  return summary;
}
