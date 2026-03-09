// ---------------------------------------------------------------------------
// GitLike — Contribution Graph (GitHub-style heatmap)
// ---------------------------------------------------------------------------

import { el } from './dom.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of weeks (columns) to display. */
const WEEKS = 53;

/** Color scale: 0 = empty, 1–4 = ascending intensity. */
const COLORS: Record<string, { dark: string; light: string }> = {
  empty: { dark: '#161b22', light: '#ebedf0' },
  l1: { dark: '#0e4429', light: '#9be9a8' },
  l2: { dark: '#006d32', light: '#40c463' },
  l3: { dark: '#26a641', light: '#30a14e' },
  l4: { dark: '#39d353', light: '#216e39' },
};

/** Cell size and gap in pixels. */
const CELL = 11;
const GAP = 3;

/** Short month labels. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day-of-week labels (0=Sun). */
const DAY_LABELS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Map a count to a color level index (0–4). */
export function countToLevel(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

/** Format a local Date as YYYY-MM-DD (avoids UTC offset issues with toISOString). */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build the 53×7 grid of dates starting from today going back ~371 days. */
export function buildDateGrid(): (string | null)[][] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // End of the current week (Saturday)
  const endDay = new Date(today);
  endDay.setDate(endDay.getDate() + (6 - endDay.getDay()));

  // Start from WEEKS weeks before end
  const startDay = new Date(endDay);
  startDay.setDate(startDay.getDate() - (WEEKS * 7 - 1));

  const grid: (string | null)[][] = [];
  const cursor = new Date(startDay);

  for (let w = 0; w < WEEKS; w++) {
    const week: (string | null)[] = [];
    for (let d = 0; d < 7; d++) {
      if (cursor > today) {
        week.push(null);
      } else {
        week.push(localDateStr(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    grid.push(week);
  }
  return grid;
}

/** Format a date string as "Mon DD, YYYY". */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Render the contribution graph. Returns a container element. */
export function renderContributionGraph(contributions: Record<string, number>): HTMLElement {
  const isDark = document.documentElement.dataset.theme !== 'light';
  const palette = isDark ? 'dark' : 'light';

  const total = Object.values(contributions).reduce((a, b) => a + b, 0);
  const grid = buildDateGrid();

  // SVG dimensions
  const labelWidth = 30;
  const monthLabelHeight = 16;
  const svgWidth = labelWidth + WEEKS * (CELL + GAP);
  const svgHeight = monthLabelHeight + 7 * (CELL + GAP);

  // Build SVG as a namespace-aware element
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(svgWidth));
  svg.setAttribute('height', String(svgHeight));
  svg.setAttribute('class', 'contrib-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${total} contributions in the last year`);

  // Month labels
  let prevMonth = -1;
  for (let w = 0; w < grid.length; w++) {
    const firstDate = grid[w].find((d) => d !== null);
    if (!firstDate) continue;
    const month = new Date(firstDate + 'T00:00:00').getMonth();
    if (month !== prevMonth) {
      prevMonth = month;
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(labelWidth + w * (CELL + GAP)));
      text.setAttribute('y', String(12));
      text.setAttribute('class', 'contrib-month-label');
      text.textContent = MONTHS[month];
      svg.appendChild(text);
    }
  }

  // Day-of-week labels
  for (const [dayIdx, label] of Object.entries(DAY_LABELS)) {
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', '0');
    text.setAttribute('y', String(monthLabelHeight + Number(dayIdx) * (CELL + GAP) + CELL - 1));
    text.setAttribute('class', 'contrib-day-label');
    text.textContent = label;
    svg.appendChild(text);
  }

  // Cells
  for (let w = 0; w < grid.length; w++) {
    for (let d = 0; d < 7; d++) {
      const dateStr = grid[w][d];
      if (dateStr === null) continue;

      const count = contributions[dateStr] ?? 0;
      const level = countToLevel(count);
      const colorKey = level === 0 ? 'empty' : `l${level}`;
      const fill = COLORS[colorKey][palette];

      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(labelWidth + w * (CELL + GAP)));
      rect.setAttribute('y', String(monthLabelHeight + d * (CELL + GAP)));
      rect.setAttribute('width', String(CELL));
      rect.setAttribute('height', String(CELL));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', fill);
      rect.setAttribute('class', 'contrib-cell');
      rect.setAttribute('data-date', dateStr);
      rect.setAttribute('data-count', String(count));

      svg.appendChild(rect);
    }
  }

  // Tooltip element
  const tooltip = el('div', { cls: 'contrib-tooltip' });

  // Wire hover events
  svg.addEventListener('mouseover', (e) => {
    const target = e.target as Element;
    if (!target.classList.contains('contrib-cell')) return;
    const date = target.getAttribute('data-date') ?? '';
    const count = target.getAttribute('data-count') ?? '0';
    const label =
      Number(count) === 0
        ? 'No contributions'
        : `${count} contribution${Number(count) === 1 ? '' : 's'}`;
    tooltip.textContent = `${label} on ${formatDate(date)}`;
    tooltip.style.display = 'block';
  });

  svg.addEventListener('mousemove', (e) => {
    const mouseEvent = e as MouseEvent;
    const container = svg.closest('.contrib-graph');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    tooltip.style.left = `${mouseEvent.clientX - rect.left + 12}px`;
    tooltip.style.top = `${mouseEvent.clientY - rect.top - 28}px`;
  });

  svg.addEventListener('mouseout', (e) => {
    const target = e.target as Element;
    if (target.classList.contains('contrib-cell')) {
      tooltip.style.display = 'none';
    }
  });

  // Legend
  const legendColors = ['empty', 'l1', 'l2', 'l3', 'l4'];
  const legendItems = legendColors.map((key) => {
    const swatch = el('span', {
      cls: 'contrib-legend-swatch',
      attrs: { style: `background:${COLORS[key][palette]}` },
    });
    return swatch;
  });

  const legend = el('div', {
    cls: 'contrib-legend',
    children: [
      el('span', { cls: 'contrib-legend-text', text: 'Less' }),
      ...legendItems,
      el('span', { cls: 'contrib-legend-text', text: 'More' }),
    ],
  });

  // Assemble
  const header = el('div', {
    cls: 'contrib-header',
    children: [
      el('span', {
        text: `${total.toLocaleString()} contributions in the last year`,
        cls: 'contrib-count',
      }),
    ],
  });

  const wrapper = el('div', {
    cls: 'contrib-graph',
    children: [header],
  });

  // SVG is an SVGElement, not HTMLElement — append directly
  wrapper.appendChild(svg);
  wrapper.appendChild(tooltip);
  wrapper.appendChild(legend);

  return wrapper;
}
