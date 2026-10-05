// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: ring;

/*
 * Cracked Oura – iOS home screen widget (Scriptable)
 *
 * Reads `oura_summary.json`, which the Cracked Oura backend writes after every
 * successful sync, from the Scriptable folder in iCloud Drive and shows the
 * latest Sleep / Readiness / Activity scores, key stats, a 7-day trend and how
 * old the data is. Falls back to sample data when the file is missing.
 *
 * Supports small, medium and large widgets (extra large on iPad renders as
 * large; lock screen widgets get a compact text version).
 *
 * Widget parameter (optional): a different file name inside the Scriptable
 * folder, e.g. `oura_summary_test.json`.
 */

const SUMMARY_FILE = (args.widgetParameter || "oura_summary.json").trim();
const SUPPORTED_SCHEMA = 1;
// Size to preview when the script is run inside the Scriptable app.
const PREVIEW_SIZE = "medium";
// Data older than this is flagged as stale (weekly sync stays un-flagged).
const STALE_AFTER_HOURS = 8 * 24;

const COLORS = {
  bgTop: new Color("#171a26"),
  bgBottom: new Color("#0d0f17"),
  text: new Color("#f2f4fa"),
  muted: new Color("#9aa1b5"),
  track: new Color("#ffffff", 0.12),
  grid: new Color("#ffffff", 0.08),
  tile: new Color("#ffffff", 0.06),
  stale: new Color("#ff7a6b"),
  sleep: new Color("#7c8cff"),
  readiness: new Color("#4fd1c5"),
  activity: new Color("#f6ad55"),
};

const SCORES = [
  { key: "readiness_score", label: "Readiness", short: "Ready", color: COLORS.readiness },
  { key: "sleep_score", label: "Sleep", short: "Sleep", color: COLORS.sleep },
  { key: "activity_score", label: "Activity", short: "Activity", color: COLORS.activity },
];

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadSummary() {
  let fm;
  try {
    fm = FileManager.iCloud();
  } catch (e) {
    fm = FileManager.local(); // iCloud disabled for Scriptable
  }
  const path = fm.joinPath(fm.documentsDirectory(), SUMMARY_FILE);

  if (!fm.fileExists(path)) {
    return { data: sampleSummary(), source: "sample", note: "No data file yet" };
  }
  try {
    if (!fm.isFileDownloaded(path)) await fm.downloadFileFromiCloud(path);
    const data = JSON.parse(fm.readString(path));
    if (!data || typeof data !== "object" || !data.latest) {
      throw new Error("missing 'latest'");
    }
    if (data.schema_version > SUPPORTED_SCHEMA) {
      console.warn(`Summary schema v${data.schema_version} is newer than v${SUPPORTED_SCHEMA}; trying anyway.`);
    }
    data.trend = Array.isArray(data.trend) ? data.trend : [];
    return { data, source: "file", note: null };
  } catch (e) {
    console.error(`Could not read ${SUMMARY_FILE}: ${e}`);
    return { data: sampleSummary(), source: "sample", note: "Data file unreadable" };
  }
}

// Plausible week of data ending yesterday, so the layout can be tried before
// the backend has written anything.
function sampleSummary() {
  const now = new Date();
  const sleep = [78, 82, 71, 85, 88, 76, 84];
  const ready = [74, 80, 68, 83, 86, 79, 82];
  const act = [91, 77, 84, 69, 88, 93, 80];
  const trend = sleep.map((_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (7 - i));
    return { day: isoDay(d), sleep_score: sleep[i], readiness_score: ready[i], activity_score: act[i] };
  });
  const last = trend[trend.length - 1];
  return {
    schema_version: SUPPORTED_SCHEMA,
    generated_at: new Date(now.getTime() - 3 * 3600 * 1000).toISOString(),
    latest_day: last.day,
    latest: {
      sleep_score: last.sleep_score,
      readiness_score: last.readiness_score,
      activity_score: last.activity_score,
      total_sleep_seconds: 7 * 3600 + 32 * 60,
      average_hrv: 48,
      lowest_heart_rate: 52,
      steps: 8412,
      temperature_deviation: 0.18,
    },
    trend,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const DASH = "–";
const isNum = (v) => typeof v === "number" && isFinite(v);

function isoDay(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// "2026-10-04" -> local Date at midnight (avoids UTC shifting the day).
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function fmtDuration(sec) {
  if (!isNum(sec)) return DASH;
  const mins = Math.round(sec / 60);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

function fmtInt(v, suffix = "") {
  if (!isNum(v)) return DASH;
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + suffix;
}

function fmtTemp(v) {
  if (!isNum(v)) return DASH;
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}°`;
}

function fmtAge(ms) {
  if (!isNum(ms)) return "unknown";
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function fmtDay(s, withWeekday = false) {
  const d = parseDay(s);
  if (!d) return DASH;
  const df = new DateFormatter();
  df.dateFormat = withWeekday ? "EEE, MMM d" : "MMM d";
  return df.string(d);
}

function freshness(summary) {
  const generated = summary.generated_at ? new Date(summary.generated_at) : null;
  const ageMs = generated && !isNaN(generated) ? Date.now() - generated.getTime() : NaN;
  const stale = !isNum(ageMs) || ageMs > STALE_AFTER_HOURS * 3600 * 1000;
  return { label: `Synced ${fmtAge(ageMs)}`, short: fmtAge(ageMs), stale };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function ringImage(score, color, size) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const line = Math.max(3, size * 0.11);
  const r = (size - line) / 2;
  const c = size / 2;

  ctx.setStrokeColor(COLORS.track);
  ctx.setLineWidth(line);
  ctx.strokeEllipse(new Rect(line / 2, line / 2, size - line, size - line));

  if (isNum(score) && score > 0) {
    const frac = Math.min(score, 100) / 100;
    const start = -Math.PI / 2;
    const end = start + frac * 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(frac * 120));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = start + ((end - start) * i) / steps;
      pts.push(new Point(c + r * Math.cos(a), c + r * Math.sin(a)));
    }
    const path = new Path();
    path.addLines(pts);
    ctx.addPath(path);
    ctx.setStrokeColor(color);
    ctx.setLineWidth(line);
    ctx.strokePath();
    // Round caps
    ctx.setFillColor(color);
    for (const p of [pts[0], pts[pts.length - 1]]) {
      ctx.fillEllipse(new Rect(p.x - line / 2, p.y - line / 2, line, line));
    }
  }

  const fontSize = size * 0.34;
  ctx.setFont(Font.boldRoundedSystemFont(fontSize));
  ctx.setTextColor(COLORS.text);
  ctx.setTextAlignedCenter();
  ctx.drawTextInRect(isNum(score) ? String(Math.round(score)) : DASH,
    new Rect(0, c - fontSize * 0.62, size, fontSize * 1.3));
  return ctx.getImage();
}

function trendImage(trend, width, height) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const labelH = 14;
  const left = 22;
  const top = 4;
  const chartW = width - left - 6;
  const chartH = height - labelH - top - 2;
  const MIN = 40, MAX = 100;
  const n = Math.max(trend.length, 2);
  const xAt = (i) => left + (chartW * i) / (n - 1);
  const yAt = (v) => top + chartH * (1 - (Math.min(Math.max(v, MIN), MAX) - MIN) / (MAX - MIN));

  // Grid + axis labels
  ctx.setFont(Font.systemFont(8));
  ctx.setTextColor(COLORS.muted);
  ctx.setTextAlignedLeft();
  for (const g of [50, 70, 85, 100]) {
    const y = yAt(g);
    const grid = new Path();
    grid.move(new Point(left, y));
    grid.addLine(new Point(left + chartW, y));
    ctx.addPath(grid);
    ctx.setStrokeColor(COLORS.grid);
    ctx.setLineWidth(1);
    ctx.strokePath();
    ctx.drawTextInRect(String(g), new Rect(0, y - 5, left - 4, 10));
  }

  // Day labels
  const df = new DateFormatter();
  df.dateFormat = "EEEEE"; // single-letter weekday
  ctx.setTextAlignedCenter();
  trend.forEach((t, i) => {
    const d = parseDay(t.day);
    ctx.drawTextInRect(d ? df.string(d) : "", new Rect(xAt(i) - 10, height - labelH + 2, 20, 12));
  });

  // Series: polyline broken at missing days, plus dots
  for (const s of SCORES) {
    let segment = [];
    const flush = () => {
      if (segment.length > 1) {
        const p = new Path();
        p.addLines(segment);
        ctx.addPath(p);
        ctx.setStrokeColor(s.color);
        ctx.setLineWidth(2);
        ctx.strokePath();
      }
      segment = [];
    };
    trend.forEach((t, i) => {
      const v = t[s.key];
      if (!isNum(v)) return flush();
      segment.push(new Point(xAt(i), yAt(v)));
    });
    flush();
    ctx.setFillColor(s.color);
    trend.forEach((t, i) => {
      const v = t[s.key];
      if (isNum(v)) ctx.fillEllipse(new Rect(xAt(i) - 2.5, yAt(v) - 2.5, 5, 5));
    });
  }
  return ctx.getImage();
}

// ---------------------------------------------------------------------------
// Layout building blocks
// ---------------------------------------------------------------------------

function addText(stack, text, size, { color = COLORS.text, weight = "regular", rounded = false } = {}) {
  const fonts = rounded
    ? { regular: Font.regularRoundedSystemFont, medium: Font.mediumRoundedSystemFont, semibold: Font.semiboldRoundedSystemFont, bold: Font.boldRoundedSystemFont }
    : { regular: Font.systemFont, medium: Font.mediumSystemFont, semibold: Font.semiboldSystemFont, bold: Font.boldSystemFont };
  const t = stack.addText(text);
  t.font = fonts[weight](size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
  return t;
}

function addHeader(w, summary, info, fresh, { showDay }) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addText(row, "OURA", 11, { weight: "bold", color: COLORS.muted });
  if (showDay) {
    row.addSpacer(6);
    addText(row, fmtDay(summary.latest_day, true), 11, { color: COLORS.muted });
  }
  row.addSpacer();
  if (info.source === "sample") {
    addText(row, "SAMPLE", 9, { weight: "bold", color: COLORS.activity });
  } else {
    addText(row, fresh.stale ? `⚠︎ ${fresh.short}` : fresh.short, 10,
      { color: fresh.stale ? COLORS.stale : COLORS.muted });
  }
}

function addRings(w, latest, ringSize, labelSize, gap) {
  const row = w.addStack();
  row.layoutHorizontally();
  row.addSpacer();
  SCORES.forEach((s, i) => {
    if (i > 0) row.addSpacer(gap);
    // Fixed-width column (height flexible) keeps the rings evenly spaced
    // regardless of label length.
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    col.size = new Size(ringSize + 6, 0);
    const img = col.addImage(ringImage(latest[s.key], s.color, ringSize));
    img.imageSize = new Size(ringSize, ringSize);
    col.addSpacer(3);
    addText(col, ringSize < 45 ? s.short : s.label, labelSize, { color: COLORS.muted, weight: "medium" });
  });
  row.addSpacer();
}

function stats(latest) {
  return [
    { label: "Total sleep", short: "Sleep", value: fmtDuration(latest.total_sleep_seconds) },
    { label: "Avg HRV", short: "HRV", value: fmtInt(latest.average_hrv, " ms") },
    { label: "Lowest HR", short: "RHR", value: fmtInt(latest.lowest_heart_rate, " bpm") },
    { label: "Steps", short: "Steps", value: fmtInt(latest.steps) },
    { label: "Temp. dev.", short: "Temp", value: fmtTemp(latest.temperature_deviation) },
  ];
}

function addStatRow(stack, stat, size, useShort) {
  const row = stack.addStack();
  row.layoutHorizontally();
  addText(row, useShort ? stat.short : stat.label, size, { color: COLORS.muted });
  row.addSpacer();
  addText(row, stat.value, size, { weight: "semibold", rounded: true });
}

function addFooter(w, info, fresh, size) {
  const row = w.addStack();
  row.layoutHorizontally();
  const msg = info.source === "sample" ? `${info.note} · showing sample data` : fresh.label;
  addText(row, msg, size, { color: fresh.stale && info.source !== "sample" ? COLORS.stale : COLORS.muted });
}

// ---------------------------------------------------------------------------
// Widget sizes
// ---------------------------------------------------------------------------

function newWidget() {
  const w = new ListWidget();
  const g = new LinearGradient();
  g.colors = [COLORS.bgTop, COLORS.bgBottom];
  g.locations = [0, 1];
  w.backgroundGradient = g;
  // Re-read the file hourly; iOS decides the exact timing.
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
  return w;
}

function buildSmall(summary, info, fresh) {
  const w = newWidget();
  w.setPadding(12, 10, 12, 10);
  addHeader(w, summary, info, fresh, { showDay: false });
  w.addSpacer();
  addRings(w, summary.latest, 34, 8, 3);
  w.addSpacer();
  const row = w.addStack();
  row.layoutHorizontally();
  const [sleep, hrv] = stats(summary.latest);
  for (const [i, s] of [sleep, hrv].entries()) {
    if (i > 0) row.addSpacer();
    const col = row.addStack();
    col.layoutVertically();
    addText(col, s.short.toUpperCase(), 8, { color: COLORS.muted, weight: "semibold" });
    addText(col, s.value, 13, { weight: "semibold", rounded: true });
  }
  return w;
}

function buildMedium(summary, info, fresh) {
  const w = newWidget();
  w.setPadding(12, 14, 12, 14);
  addHeader(w, summary, info, fresh, { showDay: true });
  w.addSpacer();

  const body = w.addStack();
  body.layoutHorizontally();
  body.centerAlignContent();

  const left = body.addStack();
  left.layoutVertically();
  addRings(left, summary.latest, 46, 9, 4);

  body.addSpacer(10);

  const right = body.addStack();
  right.layoutVertically();
  right.spacing = 3;
  for (const s of stats(summary.latest)) addStatRow(right, s, 11, true);

  w.addSpacer();
  return w;
}

function buildLarge(summary, info, fresh) {
  const w = newWidget();
  w.setPadding(14, 16, 12, 16);
  addHeader(w, summary, info, fresh, { showDay: true });
  w.addSpacer(10);
  addRings(w, summary.latest, 68, 11, 18);
  w.addSpacer(12);

  // Stats as a 3 + 2 tile grid
  const all = stats(summary.latest);
  for (const rowStats of [all.slice(0, 3), all.slice(3)]) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.spacing = 6;
    for (const s of rowStats) {
      // The trailing spacer makes each tile grow to share the row evenly.
      const tile = row.addStack();
      tile.layoutHorizontally();
      tile.backgroundColor = COLORS.tile;
      tile.cornerRadius = 8;
      tile.setPadding(5, 8, 5, 8);
      const inner = tile.addStack();
      inner.layoutVertically();
      addText(inner, s.label.toUpperCase(), 8, { color: COLORS.muted, weight: "semibold" });
      addText(inner, s.value, 14, { weight: "semibold", rounded: true });
      tile.addSpacer();
    }
    w.addSpacer(6);
  }

  w.addSpacer(4);
  const legend = w.addStack();
  legend.layoutHorizontally();
  legend.centerAlignContent();
  addText(legend, "7-DAY TREND", 9, { color: COLORS.muted, weight: "semibold" });
  legend.addSpacer();
  for (const s of SCORES) {
    addText(legend, "●", 8, { color: s.color });
    legend.addSpacer(2);
    addText(legend, s.short, 9, { color: COLORS.muted });
    legend.addSpacer(6);
  }
  w.addSpacer(4);

  const chartW = 300, chartH = 92;
  const chart = w.addImage(trendImage(lastNDays(summary, 7), chartW, chartH));
  chart.imageSize = new Size(chartW, chartH);
  chart.applyFittingContentMode(); // shrink rather than clip on smaller phones
  w.addSpacer();
  addFooter(w, info, fresh, 9);
  return w;
}

// Lock screen widgets: just the numbers.
function buildAccessory(summary, family) {
  const w = new ListWidget();
  const l = summary.latest;
  const v = (k) => (isNum(l[k]) ? String(Math.round(l[k])) : DASH);
  if (family === "accessoryCircular") {
    addText(w, v("readiness_score"), 18, { weight: "bold", rounded: true }).centerAlignText();
    addText(w, "Ready", 9, { weight: "medium" }).centerAlignText();
  } else if (family === "accessoryInline") {
    addText(w, `R ${v("readiness_score")} · S ${v("sleep_score")} · A ${v("activity_score")}`, 12);
  } else {
    addText(w, "OURA", 10, { weight: "bold" });
    addText(w, `Readiness ${v("readiness_score")}`, 13, { weight: "semibold" });
    addText(w, `Sleep ${v("sleep_score")} · Activity ${v("activity_score")}`, 12);
  }
  return w;
}

// Pad/trim the trend to exactly `n` consecutive days ending at latest_day so
// gaps show up as gaps instead of compressing the x-axis.
function lastNDays(summary, n) {
  const byDay = {};
  for (const t of summary.trend) byDay[t.day] = t;
  const end = parseDay(summary.latest_day) || parseDay(summary.trend.length ? summary.trend[summary.trend.length - 1].day : null);
  if (!end) return summary.trend.slice(-n);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const key = isoDay(d);
    out.push(byDay[key] || { day: key });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const info = await loadSummary();
const summary = info.data;
summary.latest = summary.latest || {};
const fresh = freshness(summary);
const family = config.runsInWidget ? config.widgetFamily : PREVIEW_SIZE;

let widget;
if (family === "small") widget = buildSmall(summary, info, fresh);
else if (family === "large" || family === "extraLarge") widget = buildLarge(summary, info, fresh);
else if (family && family.startsWith("accessory")) widget = buildAccessory(summary, family);
else widget = buildMedium(summary, info, fresh);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else if (PREVIEW_SIZE === "small") {
  await widget.presentSmall();
} else if (PREVIEW_SIZE === "large") {
  await widget.presentLarge();
} else {
  await widget.presentMedium();
}
Script.complete();
