import * as api from './api.js';
import {
  PEOPLE,
  ACTIVITY_TYPES,
  localDateString,
  localTimestamp,
  computeDailyBreakdown,
  computeWeeklyStandings,
  computeLifetimeSummary,
  perfectDaysNeeded,
  canAddDailyActivity,
} from './scoring.js';

const DATE_LOOKBACK_DAYS = 14;
const VALID_TABS = new Set(['log', 'milestones']);
const LOG_FOCUS_KEY = 'hc-log-focus';

const state = {
  activities: [],
  inflight: 0,
  tab: tabFromHash(),
  personDates: Object.fromEntries(PEOPLE.map((p) => [p, localDateString(new Date())])),
  focusPerson: loadFocusPerson(),
};

function loadFocusPerson() {
  try {
    const saved = localStorage.getItem(LOG_FOCUS_KEY);
    if (PEOPLE.includes(saved)) return saved;
  } catch {
    // private mode / blocked storage
  }
  return PEOPLE[0];
}

function setFocusPerson(person) {
  if (!PEOPLE.includes(person) || state.focusPerson === person) return;
  state.focusPerson = person;
  try {
    localStorage.setItem(LOG_FOCUS_KEY, person);
  } catch {
    // still update for this session
  }
  render();
}

const loadingEl = document.getElementById('loading');
const appEl = document.getElementById('app');
const errorEl = document.getElementById('error-banner');
const syncEl = document.getElementById('sync-status');
const bottomTabsEl = document.getElementById('bottom-tabs');

let savedTimer = null;
let batchFailed = false;
let stampSeq = 0;
let refreshing = false;
const sessionIds = new Set();

function today() {
  return new Date();
}

function tabFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (raw === 'week') return 'log';
  if (raw === 'progress') return 'milestones';
  return VALID_TABS.has(raw) ? raw : 'log';
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDaysToDateStr(dateStr, days) {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

function oldestSelectableDateStr() {
  const d = today();
  d.setDate(d.getDate() - DATE_LOOKBACK_DAYS);
  return localDateString(d);
}

function clampPersonDate(dateStr) {
  const min = oldestSelectableDateStr();
  const max = localDateString(today());
  if (dateStr < min) return min;
  if (dateStr > max) return max;
  return dateStr;
}

function setPersonDate(person, dateStr) {
  state.personDates[person] = clampPersonDate(dateStr);
  render();
}

function nudgePersonDate(person, delta) {
  setPersonDate(person, addDaysToDateStr(state.personDates[person], delta));
}

function canNudgePersonDate(person, delta) {
  const next = addDaysToDateStr(state.personDates[person], delta);
  return next === clampPersonDate(next);
}

function formatDayHeading(dateStr) {
  const max = localDateString(today());
  const yesterday = addDaysToDateStr(max, -1);
  const long = parseLocalDate(dateStr).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  if (dateStr === max) return `Today · ${long}`;
  if (dateStr === yesterday) return `Yesterday · ${long}`;
  return long;
}

function formatShortDay(dateStr) {
  if (dateStr === localDateString(today())) return 'Today';
  return parseLocalDate(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function dailyPointsColorClass(points) {
  if (points < 0.5) return 'score-red';
  if (points >= 2) return 'score-green';
  return 'score-yellow';
}

function weekStandingScoreClass(person, tie, leader) {
  if (tie) return 'neutral';
  return person === leader ? 'positive' : 'negative';
}

function showError(message) {
  errorEl.textContent = `⚠️ ${message}`;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.style.display = 'none';
}

function showUpdating() {
  if (state.inflight > 0) return;
  clearTimeout(savedTimer);
  syncEl.textContent = 'Updating…';
  syncEl.classList.remove('saved');
  syncEl.hidden = false;
}

function applyServerActivities(fresh) {
  state.activities = api.mergeActivities(state.activities, fresh, sessionIds);
  api.rememberActivities(state.activities);
}

function setTab(tab) {
  if (!VALID_TABS.has(tab)) tab = 'log';
  state.tab = tab;
  const hash = tab === 'log' ? '' : `#${tab}`;
  if (location.hash !== hash) {
    history.replaceState(null, '', tab === 'log' ? location.pathname : `${location.pathname}${hash}`);
  }
  renderTabVisibility();
}

function renderTabVisibility() {
  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    const active = panel.dataset.tabPanel === state.tab;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  bottomTabsEl.querySelectorAll('.bottom-tab[data-tab]').forEach((btn) => {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

async function load() {
  const cached = api.loadCachedActivities();
  if (cached) {
    state.activities = cached;
    render();
    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
    bottomTabsEl.hidden = false;
    showUpdating();
  }

  refreshing = true;
  try {
    if (state.inflight === 0) clearError();
    applyServerActivities(await api.getActivities());
    render();
    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
    bottomTabsEl.hidden = false;
  } catch (err) {
    if (!cached) {
      showError(err.message);
      loadingEl.style.display = 'none';
    } else {
      showError('Could not refresh. Showing the last saved scores.');
    }
  } finally {
    refreshing = false;
    if (state.inflight === 0) {
      clearTimeout(savedTimer);
      syncEl.hidden = true;
    }
  }
}

function fmtPoints(n) {
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}`;
}

let lifetimeSummaryCache = null;

function personCardEl(person) {
  const id = person === 'Ben' ? 'today-ben' : 'today-chelsea';
  return document.getElementById(id);
}

function render() {
  lifetimeSummaryCache = computeLifetimeSummary(state.activities);
  renderTabVisibility();
  renderWeek();
  renderPersonCard('Ben', personCardEl('Ben'));
  renderPersonCard('Chelsea', personCardEl('Chelsea'));
  orderLogPanels();
  renderLifetime();
}

// +/- and reading toggles only change numbers. Keep the card DOM so
// steppers and the radio do not flicker or lose focus.
function refreshScores() {
  lifetimeSummaryCache = computeLifetimeSummary(state.activities);
  renderWeek();
  for (const person of PEOPLE) patchPersonCard(person);
  renderLifetime();
}

function patchStepper(card, activity, { count, minusDisabled, plusDisabled, countClass = '' }) {
  const row = card.querySelector(`[data-activity="${activity}"]`);
  if (!row) return;
  const countEl = row.querySelector('.count');
  if (countEl) {
    countEl.textContent = count;
    countEl.className = countClass ? `count ${countClass}` : 'count';
  }
  const minus = row.querySelector('[data-action="minus"]');
  const plus = row.querySelector('[data-action="plus"]');
  if (minus) minus.disabled = minusDisabled;
  if (plus) plus.disabled = plusDisabled;
}

function patchPersonCard(person) {
  const container = personCardEl(person);
  const card = container?.querySelector('.person-card');
  if (!card) return;

  const date = state.personDates[person];
  const breakdown = computeDailyBreakdown(state.activities, person, date);
  const scoreClass = dailyPointsColorClass(breakdown.points);
  const pointsText = fmtPoints(breakdown.points);

  if (card.classList.contains('is-collapsed')) {
    const pointsEl = card.querySelector('.collapsed-points');
    if (pointsEl) {
      pointsEl.textContent = pointsText;
      pointsEl.className = `collapsed-points ${scoreClass}`;
    }
    return;
  }

  const scoreEl = card.querySelector('.day-score');
  if (scoreEl) {
    scoreEl.textContent = pointsText;
    scoreEl.className = `day-score ${scoreClass}`;
  }

  patchStepper(card, 'gym', {
    count: breakdown.gymCount,
    minusDisabled: breakdown.gymCount === 0,
    plusDisabled: !canAddDailyActivity(breakdown, 'gym'),
  });
  patchStepper(card, 'dog_walk', {
    count: breakdown.dogWalkCount,
    minusDisabled: breakdown.dogWalkCount === 0,
    plusDisabled: !canAddDailyActivity(breakdown, 'dog_walk'),
  });
  patchStepper(card, 'unhealthy_choice', {
    count: breakdown.unhealthyCount,
    minusDisabled: breakdown.unhealthyCount === 0,
    plusDisabled: false,
    countClass: breakdown.unhealthyCount > 0 ? 'negative' : '',
  });

  const radio = card.querySelector('.reading-radio');
  if (radio) radio.checked = breakdown.readingDone;

  const existingSummary = card.querySelector('.person-milestone-summary');
  if (existingSummary) existingSummary.outerHTML = personMilestoneSummary(person);
}

function orderLogPanels() {
  const panel = document.querySelector('[data-tab-panel="log"]');
  const weekEl = document.getElementById('week-strip');
  const benEl = document.getElementById('today-ben');
  const chelseaEl = document.getElementById('today-chelsea');
  if (!panel || !benEl || !chelseaEl) return;
  const [first, second] =
    state.focusPerson === 'Ben' ? [benEl, chelseaEl] : [chelseaEl, benEl];
  if (weekEl) panel.append(weekEl, first, second);
  else panel.append(first, second);
}

function weekStatusText(tie, leader, diff) {
  if (tie) return `🤝 Tie — massage for both`;
  return `🏆 ${leader} ahead by ${fmtPoints(diff).replace('+', '')}`;
}

function renderWeek() {
  const { scores, leader, tie, diff } = computeWeeklyStandings(
    state.activities,
    today()
  );
  const container = document.getElementById('week-content');
  if (container.querySelector('.week-strip-scores')) {
    for (const person of PEOPLE) {
      const scoreEl = container.querySelector(`.week-chip.person-${person} .score`);
      if (!scoreEl) continue;
      scoreEl.textContent = fmtPoints(scores[person]);
      scoreEl.className = `score ${weekStandingScoreClass(person, tie, leader)}`;
    }
    const statusEl = container.querySelector('.week-strip-status');
    if (statusEl) statusEl.textContent = weekStatusText(tie, leader, diff);
    return;
  }

  const chips = PEOPLE.map(
    (person) => `
      <div class="week-chip person-${person}">
        <span class="name">${person}</span>
        <span class="score ${weekStandingScoreClass(person, tie, leader)}">${fmtPoints(scores[person])}</span>
      </div>`
  ).join('');

  container.innerHTML = `
    <div class="week-strip-head">This week</div>
    <div class="week-strip-scores">${chips}</div>
    <div class="week-strip-status">${weekStatusText(tie, leader, diff)}</div>`;
}

function compactMilestoneRow({ icon, progress, threshold, earned, done }) {
  const pct = done ? 100 : Math.min(100, (progress / threshold) * 100);
  const remaining = Math.max(0, threshold - progress);
  let statusHtml;
  if (done) {
    statusHtml = '✓';
  } else {
    const days = perfectDaysNeeded(remaining);
    statusHtml = `~${days}d · ${remaining.toFixed(0)}pts${earned ? ` · ${earned}` : ''}`;
  }
  return `
    <li class="person-milestone-row">
      <span class="person-milestone-icon" aria-hidden="true">${icon}</span>
      <div class="progress-bar person-milestone-bar"><div class="fill" style="width:${pct}%"></div></div>
      <span class="person-milestone-status">${statusHtml}</span>
    </li>`;
}

function personMilestoneSummary(person) {
  const summary = lifetimeSummaryCache;
  if (!summary) return '';
  const { rewards } = summary[person];
  const trip = summary.weekendTrip.progress[person];
  const rows = [
    compactMilestoneRow({
      icon: '😉',
      progress: rewards.winkyProgress,
      threshold: rewards.winkyThreshold,
      earned: rewards.winks ? `×${rewards.winks}` : '',
      done: false,
    }),
    compactMilestoneRow({
      icon: '🍽️',
      progress: rewards.dinnerProgress,
      threshold: 35,
      earned: rewards.dinners ? `×${rewards.dinners}` : '',
      done: false,
    }),
    compactMilestoneRow({
      icon: '💆',
      progress: rewards.massageProgress,
      threshold: 100,
      earned: rewards.massages ? `×${rewards.massages}` : '',
      done: false,
    }),
    compactMilestoneRow({
      icon: '🏖️',
      progress: trip.points,
      threshold: summary.weekendTrip.threshold,
      earned: trip.reached ? '✓' : '',
      done: trip.reached,
    }),
  ].join('');

  return `
    <div class="person-milestone-summary">
      <div class="person-milestone-summary-head">Milestones</div>
      <ul class="person-milestone-rows">${rows}</ul>
    </div>`;
}

function stepperRow({ icon, label, count, minusDisabled, plusDisabled, countClass = '' }) {
  return `
    <div class="activity-row">
      <span class="activity-label"><span class="icon">${icon}</span>${label}</span>
      <span class="stepper">
        <button type="button" data-action="minus" ${minusDisabled ? 'disabled' : ''} aria-label="Decrease ${label}">−</button>
        <span class="count${countClass ? ` ${countClass}` : ''}">${count}</span>
        <button type="button" data-action="plus" ${plusDisabled ? 'disabled' : ''} aria-label="Increase ${label}">+</button>
      </span>
    </div>`;
}

function renderPersonCard(person, container) {
  const date = state.personDates[person];
  const isToday = date === localDateString(today());
  const breakdown = computeDailyBreakdown(state.activities, person, date);
  const expanded = person === state.focusPerson;

  const dayViewClass = isToday ? 'is-viewing-today' : 'is-viewing-past';

  if (!expanded) {
    container.innerHTML = `
      <div class="card person-card person-${person} is-collapsed ${dayViewClass}">
        <button type="button" class="person-expand-btn" aria-expanded="false" aria-label="Open ${person}'s log">
          <span class="person-name">${person}</span>
          <span class="collapsed-summary">
            <span class="collapsed-day">${formatShortDay(date)}</span>
            <span class="collapsed-points ${dailyPointsColorClass(breakdown.points)}">${fmtPoints(breakdown.points)}</span>
          </span>
          <span class="expand-chevron" aria-hidden="true">▾</span>
        </button>
      </div>`;
    container.querySelector('.person-expand-btn').addEventListener('click', () => {
      setFocusPerson(person);
    });
    return;
  }

  const prevOk = canNudgePersonDate(person, -1);
  const nextOk = canNudgePersonDate(person, 1);

  container.innerHTML = `
    <div class="card person-card person-${person} is-expanded ${dayViewClass}">
      <div class="person-card-head">
        <div class="person-head-top">
          <span class="person-name">${person}</span>
          <span class="day-score ${dailyPointsColorClass(breakdown.points)}">${fmtPoints(breakdown.points)}</span>
        </div>
        <nav class="date-nav" aria-label="${person} day">
          <button type="button" class="date-nav-btn" data-date-action="prev" ${prevOk ? '' : 'disabled'} aria-label="Previous day">‹</button>
          <div class="date-nav-center">
            ${isToday ? '' : '<span class="date-nav-badge">Past day</span>'}
            <span class="date-nav-label">${formatDayHeading(date)}</span>
            ${isToday ? '' : '<button type="button" class="date-jump-today" data-date-action="today">Jump to today</button>'}
          </div>
          <button type="button" class="date-nav-btn" data-date-action="next" ${nextOk ? '' : 'disabled'} aria-label="Next day">›</button>
        </nav>
      </div>
      <div class="activity-list">
      <div data-activity="gym">
        ${stepperRow({
          icon: ACTIVITY_TYPES.gym.icon,
          label: 'Gym',
          count: breakdown.gymCount,
          minusDisabled: breakdown.gymCount === 0,
          plusDisabled: !canAddDailyActivity(breakdown, 'gym'),
        })}
      </div>
      <div data-activity="dog_walk">
        ${stepperRow({
          icon: ACTIVITY_TYPES.dog_walk.icon,
          label: 'Dog Walks',
          count: breakdown.dogWalkCount,
          minusDisabled: breakdown.dogWalkCount === 0,
          plusDisabled: !canAddDailyActivity(breakdown, 'dog_walk'),
        })}
      </div>
      <div class="activity-row nightly-reading" data-activity="reading">
        <span class="activity-label"><span class="icon">${ACTIVITY_TYPES.reading.icon}</span>Nightly Reading</span>
        <label class="reading-radio-label">
          <input
            type="radio"
            class="reading-radio"
            name="nightly-${person}-${date}"
            ${breakdown.readingDone ? 'checked' : ''}
            aria-label="Nightly reading done"
          />
        </label>
      </div>
      <div data-activity="unhealthy_choice">
        ${stepperRow({
          icon: ACTIVITY_TYPES.unhealthy_choice.icon,
          label: 'Unhealthy Choices',
          count: breakdown.unhealthyCount,
          minusDisabled: breakdown.unhealthyCount === 0,
          countClass: breakdown.unhealthyCount > 0 ? 'negative' : '',
        })}
      </div>
      </div>
      ${personMilestoneSummary(person)}
    </div>`;

  container.querySelectorAll('[data-date-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.dateAction;
      if (action === 'prev') nudgePersonDate(person, -1);
      else if (action === 'next') nudgePersonDate(person, 1);
      else if (action === 'today') setPersonDate(person, localDateString(today()));
    });
  });

  container.querySelectorAll('[data-activity]').forEach((el) => {
    const activity = el.dataset.activity;
    if (activity === 'reading') {
      const radio = el.querySelector('.reading-radio');
      radio.addEventListener('click', (evt) => {
        evt.preventDefault();
        handleAction(person, 'reading', 'toggle');
      });
      return;
    }
    el.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(person, activity, btn.dataset.action));
    });
  });
}

function milestoneTrack({ icon, title, earned, progress, threshold, pct }) {
  return `
    <li class="milestone-track">
      <div class="milestone-track-head">
        <span class="milestone-icon" aria-hidden="true">${icon}</span>
        <span class="milestone-track-title">${title}</span>
        <span class="milestone-track-earned">${earned}</span>
      </div>
      <div class="milestone-track-next">
        <div class="progress-bar milestone-bar"><div class="fill" style="width:${pct}%"></div></div>
        <span class="milestone-track-frac">${progress.toFixed(1)} / ${threshold}</span>
      </div>
    </li>`;
}

function renderLifetime() {
  const summary = lifetimeSummaryCache ?? computeLifetimeSummary(state.activities);
  const container = document.getElementById('lifetime-content');

  const people = PEOPLE.map((person) => {
    const { lifetimePoints, rewards } = summary[person];
    const dinnerPct = Math.min(100, (rewards.dinnerProgress / 35) * 100);
    const massagePct = Math.min(100, (rewards.massageProgress / 100) * 100);
    const winkyPct = Math.min(
      100,
      (rewards.winkyProgress / rewards.winkyThreshold) * 100
    );
    const tracks = [
      milestoneTrack({
        icon: '😉',
        title: 'Every 20 pts',
        earned: `×${rewards.winks}`,
        progress: rewards.winkyProgress,
        threshold: rewards.winkyThreshold,
        pct: winkyPct,
      }),
      milestoneTrack({
        icon: '🍽️',
        title: 'Dinner out',
        earned: `${rewards.dinners} earned`,
        progress: rewards.dinnerProgress,
        threshold: 35,
        pct: dinnerPct,
      }),
      milestoneTrack({
        icon: '💆',
        title: 'Massage',
        earned: `${rewards.massages} earned`,
        progress: rewards.massageProgress,
        threshold: 100,
        pct: massagePct,
      }),
    ].join('');

    return `
      <article class="card milestone-person person-${person}">
        <header class="milestone-person-head">
          <h3 class="milestone-person-name">${person}</h3>
          <p class="milestone-lifetime">${fmtPoints(lifetimePoints)}<span> lifetime</span></p>
        </header>
        <ul class="milestone-tracks">${tracks}</ul>
      </article>`;
  }).join('');

  const trip = summary.weekendTrip;
  const tripChips = PEOPLE.map((person) => {
    const p = trip.progress[person];
    const pct = Math.min(100, (p.points / trip.threshold) * 100);
    return `
      <div class="milestone-trip-person person-${person}">
        <span class="name">${person}</span>
        <div class="milestone-trip-bar"><div class="fill" style="width:${pct}%"></div></div>
        <span class="trip-pts">${p.points.toFixed(1)} / ${trip.threshold}${p.reached ? ' ✓' : ''}</span>
      </div>`;
  }).join('');

  const tripBlock = trip.unlocked
    ? `<section class="card milestone-trip unlocked">
        <div class="milestone-trip-head">🏖️ Weekend trip</div>
        <p class="milestone-trip-unlocked">Unlocked — you both hit ${trip.threshold} points!</p>
      </section>`
    : `<section class="card milestone-trip">
        <div class="milestone-trip-head">🏖️ Weekend trip</div>
        <p class="milestone-trip-sub">${trip.threshold} points each</p>
        ${tripChips}
      </section>`;

  container.innerHTML = `${people}${tripBlock}`;
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function eventTimestamp() {
  const ms = String(today().getMilliseconds()).padStart(3, '0');
  const seq = String(stampSeq++ % 100).padStart(2, '0');
  return `${localTimestamp(today())}.${ms}${seq}`;
}

function eventTimestampForDate(dateStr) {
  const todayStr = localDateString(today());
  if (dateStr === todayStr) return eventTimestamp();
  const d = parseLocalDate(dateStr);
  d.setHours(12, 0, stampSeq++ % 60, 0);
  return localTimestamp(d);
}

function activeOnDate(person, activity, date) {
  return state.activities.filter(
    (a) => !a.deleted && a.person === person && a.activity === activity && a.date === date
  );
}

function showSaving() {
  if (state.inflight === 0) batchFailed = false;
  state.inflight += 1;
  clearTimeout(savedTimer);
  syncEl.textContent = 'Saving…';
  syncEl.classList.remove('saved');
  syncEl.hidden = false;
}

function settleSave(ok) {
  if (!ok) batchFailed = true;
  state.inflight = Math.max(0, state.inflight - 1);
  if (state.inflight > 0) return;
  if (batchFailed) {
    syncEl.hidden = true;
    return;
  }
  syncEl.textContent = 'Saved';
  syncEl.classList.add('saved');
  syncEl.hidden = false;
  savedTimer = setTimeout(() => {
    if (state.inflight === 0) syncEl.hidden = true;
  }, 1200);
}

function handleAction(person, activity, action) {
  clearError();
  const date = state.personDates[person];

  if (activity === 'reading' && action === 'toggle') {
    const existing = activeOnDate(person, 'reading', date)[0];
    if (existing) removeActivity(existing);
    else addActivity(person, activity);
    return;
  }

  if (action === 'plus') {
    const breakdown = computeDailyBreakdown(state.activities, person, date);
    if (!canAddDailyActivity(breakdown, activity)) return;
    addActivity(person, activity);
    return;
  }

  if (action === 'minus') {
    const last = activeOnDate(person, activity, date).sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    )[0];
    if (last) removeActivity(last);
  }
}

function addActivity(person, activity) {
  const date = state.personDates[person];
  const entry = {
    id: newId(),
    person,
    activity,
    timestamp: eventTimestampForDate(date),
    date,
    deleted: false,
    pending: true,
  };
  state.activities.push(entry);
  refreshScores();
  showSaving();
  saveNew(entry);
}

function removeActivity(entry) {
  entry.deleted = true;
  refreshScores();
  if (entry.pending) return;
  showSaving();
  saveDelete(entry);
}

async function saveNew(entry) {
  let created;
  try {
    created = await api.addActivity(entry.person, entry.activity, entry.timestamp);
  } catch (err) {
    const current = state.activities.find((a) => a.id === entry.id);
    if (current && !current.deleted) {
      current.deleted = true;
      refreshScores();
      showError(err.message);
      settleSave(false);
      return;
    }
    settleSave(true);
    return;
  }

  const current = state.activities.find((a) => a.id === entry.id);
  if (!current) {
    settleSave(true);
    return;
  }

  if (current.deleted) {
    try {
      await api.deleteActivity(created.id);
    } catch (err) {
      Object.assign(current, created, { pending: false, deleted: false });
      sessionIds.add(created.id);
      api.rememberActivities(state.activities);
      refreshScores();
      showError(err.message);
      settleSave(false);
      return;
    }
    Object.assign(current, created, { pending: false, deleted: true });
  } else {
    Object.assign(current, created, { pending: false });
  }
  sessionIds.add(created.id);
  api.rememberActivities(state.activities);
  settleSave(true);
}

async function saveDelete(entry) {
  try {
    await api.deleteActivity(entry.id);
    api.rememberActivities(state.activities);
    settleSave(true);
  } catch (err) {
    entry.deleted = false;
    refreshScores();
    showError(err.message);
    settleSave(false);
  }
}

bottomTabsEl.querySelectorAll('.bottom-tab[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

window.addEventListener('hashchange', () => {
  state.tab = tabFromHash();
  renderTabVisibility();
});

setTab(state.tab);
load();
