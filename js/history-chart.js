import {
  localDateString,
  getWeekRange,
  computeDailyBreakdown,
  totalPointsForPerson,
} from './scoring.js';

const PERSON_COLORS = { Ben: '#2563eb', Chelsea: '#db2777' };

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function eachDayInclusive(startStr, endStr) {
  const days = [];
  const cursor = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  while (cursor <= end) {
    days.push(localDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function weekStartsInRange(startStr, endStr) {
  const starts = new Set();
  for (const day of eachDayInclusive(startStr, endStr)) {
    starts.add(getWeekRange(parseLocalDate(day)).start);
  }
  return [...starts].sort();
}

export function chartRangeBounds(rangeKey) {
  const end = localDateString(new Date());
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  switch (rangeKey) {
    case '1week':
      startDate.setDate(startDate.getDate() - 6);
      break;
    case '1month':
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case '3months':
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6months':
    default:
      startDate.setMonth(startDate.getMonth() - 6);
      break;
  }

  return { start: localDateString(startDate), end };
}

function formatAxisLabel(dateStr, axis) {
  const d = parseLocalDate(dateStr);
  if (axis === 'weeks') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

function lineDatasets(activities, buckets, people, labelCount) {
  return people.map((person) => ({
    label: person,
    data: buckets.map((bucket) => {
      if (bucket.type === 'day') {
        return computeDailyBreakdown(activities, person, bucket.key).points;
      }
      return totalPointsForPerson(activities, person, bucket.range);
    }),
    borderColor: PERSON_COLORS[person],
    backgroundColor: PERSON_COLORS[person],
    tension: 0.25,
    pointRadius: labelCount > 45 ? 0 : 2,
    borderWidth: 2,
  }));
}

function buildBuckets(start, end, axis) {
  if (axis === 'weeks') {
    return weekStartsInRange(start, end).map((weekStart) => {
      const range = getWeekRange(parseLocalDate(weekStart));
      const clampedStart = range.start < start ? start : range.start;
      const clampedEnd = range.end > end ? end : range.end;
      return {
        type: 'week',
        key: weekStart,
        range: { start: clampedStart, end: clampedEnd },
      };
    });
  }
  return eachDayInclusive(start, end).map((day) => ({
    type: 'day',
    key: day,
    range: { start: day, end: day },
  }));
}

export function buildHistoryChartConfig(activities, { rangeKey, axis, people }) {
  const { start, end } = chartRangeBounds(rangeKey);
  const buckets = buildBuckets(start, end, axis);
  const labels = buckets.map((b) => formatAxisLabel(b.key, axis));
  const datasets = lineDatasets(activities, buckets, people, labels.length);

  return {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 4, bottom: 10 },
      },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 10, boxHeight: 10, padding: 14, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            footer(items) {
              if (items.length < 2) return '';
              const a = items[0]?.parsed?.y ?? 0;
              const b = items[1]?.parsed?.y ?? 0;
              const diff = Math.round((a - b) * 100) / 100;
              if (Number.isNaN(diff)) return '';
              return `Gap: ${diff > 0 ? '+' : ''}${diff}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: axis === 'weeks' ? 12 : 8,
            font: { size: 10 },
          },
        },
        y: {
          grid: { color: 'rgba(0,0,0,0.06)' },
          ticks: { font: { size: 10 } },
        },
      },
    },
  };
}

export function mountHistoryChart(canvas, activities, options, existingChart) {
  if (!canvas || typeof globalThis.Chart === 'undefined') return existingChart;
  const config = buildHistoryChartConfig(activities, options);
  if (existingChart) {
    existingChart.data.labels = config.data.labels;
    existingChart.data.datasets = config.data.datasets;
    existingChart.options.scales.x.ticks.maxTicksLimit =
      config.options.scales.x.ticks.maxTicksLimit;
    existingChart.update();
    return existingChart;
  }
  return new globalThis.Chart(canvas.getContext('2d'), config);
}

// Same buckets as the chart, newest first (for the detail list drillthrough).
export function chartDetailBuckets(rangeKey, axis) {
  const { start, end } = chartRangeBounds(rangeKey);
  return buildBuckets(start, end, axis).slice().reverse();
}

export { PERSON_COLORS };
