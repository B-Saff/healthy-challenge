import * as api from './api.js';
import {
  PEOPLE,
  ACTIVITY_TYPES,
  computeDailyBreakdown,
  totalPointsForPerson,
} from './scoring.js';
import { mountHistoryChart, chartDetailBuckets } from './history-chart.js';

if (location.hash === '#week' || location.hash === '#progress') {
  location.replace(location.hash === '#week' ? 'index.html' : 'index.html#milestones');
}

const state = {
  activities: [],
  person: 'Both',
  chartRange: '1month',
  chartAxis: 'days',
};

const loadingEl = document.getElementById('loading');
const appEl = document.getElementById('app');
const errorEl = document.getElementById('error-banner');
const contentEl = document.getElementById('history-content');
const chartCanvas = document.getElementById('history-chart');
const syncEl = document.getElementById('sync-status');
const sessionIds = new Set();
let historyChart = null;

function showError(message) {
  errorEl.textContent = `⚠️ ${message}`;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.style.display = 'none';
}

function fmtPoints(n) {
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}`;
}

function netClass(n) {
  if (n > 0) return 'positive';
  if (n < 0) return 'negative';
  return 'zero';
}

function activePeople() {
  return state.person === 'Both' ? PEOPLE : [state.person];
}

function activeEvents() {
  return state.activities.filter((a) => !a.deleted);
}

async function load() {
  const cached = api.loadCachedActivities();
  if (cached) {
    state.activities = cached;
    render();
    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
    syncEl.hidden = false;
  }

  try {
    clearError();
    state.activities = api.mergeActivities(state.activities, await api.getActivities(), sessionIds);
    api.rememberActivities(state.activities);
    render();
    loadingEl.style.display = 'none';
    appEl.style.display = 'block';
  } catch (err) {
    if (!cached) {
      showError(err.message);
      loadingEl.style.display = 'none';
    } else {
      showError('Could not refresh. Showing the last saved scores.');
    }
  } finally {
    syncEl.hidden = true;
  }
}

function chartPeople() {
  return state.person === 'Both' ? PEOPLE : [state.person];
}

function renderChart() {
  historyChart = mountHistoryChart(
    chartCanvas,
    state.activities,
    {
      rangeKey: state.chartRange,
      axis: state.chartAxis,
      people: chartPeople(),
    },
    historyChart
  );
}

function render() {
  renderChart();
  syncChartToolbar();
  contentEl.innerHTML =
    state.chartAxis === 'days' ? renderDailyDetails() : renderWeeklyDetails();
  attachHandlers();
}

function weekHasActivity(range) {
  const events = activeEvents();
  return events.some(
    (e) =>
      activePeople().includes(e.person) && e.date >= range.start && e.date <= range.end
  );
}

function syncChartToolbar() {
  const toolbar = document.getElementById('chart-toolbar');
  if (!toolbar) return;
  toolbar.querySelectorAll('[data-chart-control]').forEach((group) => {
    const key = group.dataset.chartControl;
    const value = key === 'range' ? state.chartRange : state.chartAxis;
    group.querySelectorAll('button[data-value]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.value === value);
    });
  });
}

function renderDailyDetails() {
  const events = activeEvents();
  const buckets = chartDetailBuckets(state.chartRange, 'days');
  const keys = [];
  for (const bucket of buckets) {
    for (const person of activePeople()) {
      const hasDay = events.some((e) => e.person === person && e.date === bucket.key);
      if (hasDay) keys.push(`${bucket.key}|${person}`);
    }
  }

  if (keys.length === 0) {
    return `<div class="empty-state">No activity in this range.</div>`;
  }

  return keys
    .map((key) => {
      const [date, person] = key.split('|');
      const b = computeDailyBreakdown(state.activities, person, date);
      const dayEvents = events
        .filter((e) => e.date === date && e.person === person)
        .sort((a, b2) => b2.timestamp.localeCompare(a.timestamp));

      const eventRows = dayEvents
        .map((e) => {
          const points = pointsForSingleEvent(e, dayEvents);
          const time = (e.timestamp.split('T')[1] || '').slice(0, 5);
          const type = ACTIVITY_TYPES[e.activity] || { icon: '•', label: e.activity };
          return `
            <div class="event-row" data-id="${e.id}">
              <span class="event-info">
                <span class="event-time">${time}</span>
                <span>${type.icon} ${type.label}</span>
              </span>
              <span>
                <span class="event-points ${points >= 0 ? 'positive' : 'negative'}">${fmtPoints(points)}</span>
                <button type="button" class="delete-btn" data-delete="${e.id}">🗑</button>
              </span>
            </div>`;
        })
        .join('');

      const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });

      return `
        <div class="day-row" data-key="${key}">
          <div class="day-top">
            <div>
              <div class="day-date">${dateLabel}${state.person === 'Both' ? ` — ${person}` : ''}</div>
              <div class="day-summary-line">🏋️ ${b.gymCount} · 🐕 ${b.dogWalkCount} · 📖 ${b.readingDone ? '✓' : '–'} · 🍔 ${b.unhealthyCount}</div>
            </div>
            <span class="day-net ${netClass(b.points)}">${fmtPoints(b.points)}</span>
          </div>
          <div class="day-events">${eventRows}</div>
        </div>`;
    })
    .join('');
}

// Recomputes a single event's point value within its day's sequence
// (needed for dog walks, whose value depends on chronological order).
function pointsForSingleEvent(event, dayEventsDesc) {
  if (event.activity === 'gym') return 2;
  if (event.activity === 'unhealthy_choice') return -3;
  if (event.activity === 'reading') return 0.5;
  if (event.activity === 'dog_walk') {
    const walksAsc = dayEventsDesc
      .filter((e) => e.activity === 'dog_walk')
      .slice()
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const index = walksAsc.findIndex((e) => e.id === event.id);
    return index < 2 ? 0.5 : 0.25;
  }
  return 0;
}

function renderWeeklyDetails() {
  const buckets = chartDetailBuckets(state.chartRange, 'weeks').filter((b) =>
    weekHasActivity(b.range)
  );

  if (buckets.length === 0) {
    return `<div class="empty-state">No activity in this range.</div>`;
  }

  return buckets
    .map((bucket) => {
      const range = bucket.range;
      const scores = {};
      for (const person of PEOPLE) {
        scores[person] = totalPointsForPerson(state.activities, person, range);
      }
      const [a, b] = PEOPLE;
      const diff = scores[a] - scores[b];
      const tie = diff === 0;
      const leader = tie ? null : diff > 0 ? a : b;

      const scoreSpans = PEOPLE.filter((p) => activePeople().includes(p))
        .map((p) => `<span><strong>${p}</strong> ${fmtPoints(scores[p])}</span>`)
        .join('');

      const winnerLine =
        state.person === 'Both'
          ? tie
            ? '🤝 Tie — both get a massage'
            : `🏆 ${leader} won the massage`
          : '';

      const rangeLabel = `${formatShort(range.start)} – ${formatShort(range.end)}`;

      return `
        <div class="week-history-row">
          <div class="range">${rangeLabel}</div>
          <div class="scores">${scoreSpans}</div>
          ${winnerLine ? `<div class="winner">${winnerLine}</div>` : ''}
        </div>`;
    })
    .join('');
}

function formatShort(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function attachHandlers() {
  contentEl.querySelectorAll('.day-row').forEach((row) => {
    row.addEventListener('click', (evt) => {
      if (evt.target.closest('.delete-btn')) return;
      row.classList.toggle('expanded');
    });
  });

  contentEl.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      const id = btn.dataset.delete;
      if (!confirm('Delete this activity?')) return;
      try {
        await api.deleteActivity(id);
        const activity = state.activities.find((a) => a.id === id);
        if (activity) activity.deleted = true;
        api.rememberActivities(state.activities);
        render();
      } catch (err) {
        showError(err.message);
      }
    });
  });
}

document.getElementById('person-filter').addEventListener('change', (e) => {
  state.person = e.target.value;
  render();
});

document.getElementById('chart-toolbar')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-value]');
  if (!btn) return;
  const group = btn.closest('[data-chart-control]');
  if (!group) return;
  const { chartControl } = group.dataset;
  const { value } = btn.dataset;
  if (chartControl === 'range') state.chartRange = value;
  else if (chartControl === 'axis') state.chartAxis = value;
  render();
});

load();
