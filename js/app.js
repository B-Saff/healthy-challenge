import * as api from './api.js';
import {
  PEOPLE,
  ACTIVITY_TYPES,
  localDateString,
  localTimestamp,
  computeDailyBreakdown,
  computeWeeklyStandings,
  computeLifetimeSummary,
} from './scoring.js';

const state = {
  activities: [],
  pending: false,
};

const todayDateEl = document.getElementById('today-date');
const loadingEl = document.getElementById('loading');
const appEl = document.getElementById('app');
const errorEl = document.getElementById('error-banner');

function today() {
  return new Date();
}

function showError(message) {
  errorEl.textContent = `⚠️ ${message}`;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.style.display = 'none';
}

async function load() {
  try {
    clearError();
    state.activities = await api.getActivities();
    render();
    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
  } catch (err) {
    showError(err.message);
    loadingEl.style.display = 'none';
  }
}

function fmtPoints(n) {
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}`;
}

function render() {
  todayDateEl.textContent = today().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  renderWeek();
  renderPersonCard('Ben', document.getElementById('today-ben'));
  renderPersonCard('Chelsea', document.getElementById('today-chelsea'));
  renderLifetime();
}

function renderWeek() {
  const { scores, leader, tie, diff } = computeWeeklyStandings(
    state.activities,
    today()
  );
  const container = document.getElementById('week-content');
  const rows = PEOPLE.map(
    (person) => `
      <div class="week-row person-${person}">
        <span class="name">${person}</span>
        <span class="score">${fmtPoints(scores[person])}</span>
      </div>`
  ).join('');

  let status;
  if (tie) {
    status = `🤝 Tie — you both get a massage`;
  } else {
    status = `🏆 ${leader} is currently ahead by ${fmtPoints(diff).replace('+', '')}`;
  }

  container.innerHTML = `${rows}<div class="week-status">${status}</div>`;
}

function stepperRow({ icon, label, count, onMinus, onPlus, minusDisabled }) {
  return `
    <div class="activity-row">
      <span class="activity-label"><span class="icon">${icon}</span>${label}</span>
      <span class="stepper">
        <button type="button" data-action="minus" ${minusDisabled ? 'disabled' : ''}>−</button>
        <span class="count">${count}</span>
        <button type="button" data-action="plus">+</button>
      </span>
    </div>`;
}

function renderPersonCard(person, container) {
  const date = localDateString(today());
  const breakdown = computeDailyBreakdown(state.activities, person, date);

  container.innerHTML = `
    <div class="person-card person-${person}">
      <div class="person-name">${person}</div>
      <div data-activity="gym">
        ${stepperRow({
          icon: ACTIVITY_TYPES.gym.icon,
          label: 'Gym',
          count: breakdown.gymCount,
          minusDisabled: breakdown.gymCount === 0,
        })}
      </div>
      <div data-activity="dog_walk">
        ${stepperRow({
          icon: ACTIVITY_TYPES.dog_walk.icon,
          label: 'Dog Walks',
          count: breakdown.dogWalkCount,
          minusDisabled: breakdown.dogWalkCount === 0,
        })}
      </div>
      <div class="activity-row" data-activity="reading">
        <span class="activity-label"><span class="icon">${ACTIVITY_TYPES.reading.icon}</span>Reading</span>
        <button type="button" class="toggle-btn ${breakdown.readingDone ? 'done' : ''}" data-action="toggle">
          ${breakdown.readingDone ? 'Read ✓' : 'Read'}
        </button>
      </div>
      <div data-activity="unhealthy_choice">
        ${stepperRow({
          icon: ACTIVITY_TYPES.unhealthy_choice.icon,
          label: 'Unhealthy Choices',
          count: breakdown.unhealthyCount,
          minusDisabled: breakdown.unhealthyCount === 0,
        })}
      </div>
      <div class="today-points ${breakdown.points > 0 ? 'positive' : breakdown.points < 0 ? 'negative' : ''}">
        Today's Points: ${fmtPoints(breakdown.points)}
      </div>
    </div>`;

  container.querySelectorAll('[data-activity]').forEach((el) => {
    const activity = el.dataset.activity;
    el.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(person, activity, btn.dataset.action));
    });
  });
}

function renderLifetime() {
  const summary = computeLifetimeSummary(state.activities);
  const container = document.getElementById('lifetime-content');

  const people = PEOPLE.map((person) => {
    const { lifetimePoints, rewards } = summary[person];
    const dinnerPct = Math.min(100, (rewards.dinnerProgress / 35) * 100);
    const massagePct = Math.min(100, (rewards.massageProgress / 100) * 100);
    return `
      <div class="lifetime-person">
        <div class="row-top">
          <span class="name">${person}</span>
          <span class="points">${fmtPoints(lifetimePoints)} lifetime</span>
        </div>
        <div class="reward-line">
          <span>🍽️ ${rewards.dinners} dinner${rewards.dinners === 1 ? '' : 's'} earned</span>
          <span>${rewards.dinnerProgress.toFixed(1)} / 35</span>
        </div>
        <div class="progress-bar"><div class="fill" style="width:${dinnerPct}%"></div></div>
        <div class="reward-line">
          <span>💆 ${rewards.massages} massage${rewards.massages === 1 ? '' : 's'} earned</span>
          <span>${rewards.massageProgress.toFixed(1)} / 100</span>
        </div>
        <div class="progress-bar"><div class="fill" style="width:${massagePct}%"></div></div>
      </div>`;
  }).join('');

  const trip = summary.weekendTrip;
  const tripLines = PEOPLE.map((person) => {
    const p = trip.progress[person];
    return `<div class="reward-line"><span>${person}</span><span>${p.points.toFixed(1)} / ${trip.threshold}${p.reached ? ' ✓' : ''}</span></div>`;
  }).join('');

  const tripBanner = trip.unlocked
    ? `<div class="trip-banner">🏖️ Weekend Trip Unlocked! You both reached ${trip.threshold} points.</div>`
    : `<div class="reward-line" style="margin-top:8px;"><strong>🏖️ Weekend Trip (at ${trip.threshold} pts each)</strong></div>${tripLines}`;

  container.innerHTML = `${people}${tripBanner}`;
}

async function handleAction(person, activity, action) {
  if (state.pending) return;
  state.pending = true;
  clearError();
  const date = localDateString(today());

  try {
    if (activity === 'reading' && action === 'toggle') {
      const existing = state.activities.find(
        (a) => !a.deleted && a.person === person && a.activity === 'reading' && a.date === date
      );
      if (existing) {
        await api.deleteActivity(existing.id);
        existing.deleted = true;
      } else {
        const created = await api.addActivity(person, 'reading', localTimestamp(today()));
        state.activities.push(created);
      }
    } else if (action === 'plus') {
      const created = await api.addActivity(person, activity, localTimestamp(today()));
      state.activities.push(created);
    } else if (action === 'minus') {
      const todays = state.activities
        .filter((a) => !a.deleted && a.person === person && a.activity === activity && a.date === date)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const last = todays[0];
      if (last) {
        await api.deleteActivity(last.id);
        last.deleted = true;
      }
    }
    render();
  } catch (err) {
    showError(err.message);
  } finally {
    state.pending = false;
  }
}

load();
