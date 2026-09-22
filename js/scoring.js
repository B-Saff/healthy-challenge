// Pure scoring logic. Everything is derived from the raw activity event
// list so the scoreboard can always be reconstructed from the Sheet.

export const PEOPLE = ['Ben', 'Chelsea'];

export const ACTIVITY_TYPES = {
  gym: { label: 'Gym', icon: '🏋️' },
  dog_walk: { label: 'Dog Walk', icon: '🐕' },
  reading: { label: 'Reading', icon: '📖' },
  unhealthy_choice: { label: 'Unhealthy Choice', icon: '🍔' },
};

const DINNER_THRESHOLD = 35;
const MASSAGE_THRESHOLD = 100;
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
  return {
    dinners,
    dinnerProgress: lifetimePoints - dinners * DINNER_THRESHOLD,
    dinnerRemaining: DINNER_THRESHOLD - (lifetimePoints - dinners * DINNER_THRESHOLD),
    massages,
    massageProgress: lifetimePoints - massages * MASSAGE_THRESHOLD,
    massageRemaining: MASSAGE_THRESHOLD - (lifetimePoints - massages * MASSAGE_THRESHOLD),
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
