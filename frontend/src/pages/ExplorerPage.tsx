import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import type { CountryInfo, Matrix, NotableSentence, Statement, StatementText, UNSummary } from "../api/types";
import CountryPicker from "../components/CountryPicker";
import { DownloadLink, HighlightedText, HighlightKeys, Limitations, Loading, Notice } from "../components/common";
import { ListenBar, MiniPlayer, NowReading, ReadingText, useFlatReading } from "../components/Listen";
import MetricCards from "../components/MetricCards";
import MetricSelect from "../components/MetricSelect";
import TrendChart from "../components/TrendChart";
import { PALETTE, useColorScheme, useCountryColors } from "../lib/colors";
import { fixed, formatDelta, formatMetric, KEYWORD_PREFIX, metricLabel, plural, tickFormat } from "../lib/format";
import { useAsync, useDocumentTitle, useMeta } from "../lib/hooks";
import { scrollBehavior, stopGlide, useMediaQuery } from "../lib/media";
import { speakerFlag, speakerName } from "../lib/history";
import { useSpeech } from "../lib/speech";

const PREFERRED = ["RUS", "USA", "CHN", "VNM"];

/** The page's views, as tabs under the filters; the choice is kept in the address (?v=). */
const VIEWS = [
  ["trend", "Over time", "Over time"], ["year", "Year by year", "By year"],
  ["space", "Rhetoric space", "Rhetoric"], ["read", "Close reading", "Reading"],
] as const;   // key, name, the shorter name shown on phones (the full one stays the accessible name)
type View = typeof VIEWS[number][0];

// The 3D views (three.js) load only when this page is opened.
const FlagLine = lazy(() => import("../three/FlagLine"));
const AssemblyHall = lazy(() => import("../three/AssemblyHall"));
const Rostrum = lazy(() => import("../three/Rostrum"));
const RhetoricSpace = lazy(() => import("../three/RhetoricSpace"));
const Podium = lazy(() => import("../three/Podium"));

export default function ExplorerPage() {
  useDocumentTitle("UN General Debate");
  const summary = useAsync(() => api.un.summary(), []);
  if (summary.error) return <Notice kind="error" onRetry={summary.reload}>{summary.error}</Notice>;
  if (!summary.data) return <Loading />;
  if (!summary.data.loaded) {
    return (
      <Notice kind="info">
        The UN General Debate data has not been loaded into the database yet. The maintainer runs{" "}
        <code>python -m dla load-un</code> once (see the README).
      </Notice>
    );
  }
  return <Explorer summary={summary.data} />;
}

function Explorer({ summary }: { summary: UNSummary }) {
  const meta = useMeta();
  const scheme = useColorScheme();
  const [params, setParams] = useSearchParams();
  const firstYear = summary.first_year!;
  const lastYear = summary.last_year!;
  const known = new Set(summary.countries.map((c) => c.code));
  const max = meta.limits.max_chart_countries;

  const defaultCountries = PREFERRED.filter((c) => known.has(c)).length
    ? PREFERRED.filter((c) => known.has(c))
    : [...summary.countries].sort((a, b) => b.statements - a.statements).slice(0, 4).map((c) => c.code);
  const countries = (params.get("c")?.split(",").filter((c) => known.has(c)) ?? defaultCountries).slice(0, max);
  const metric = params.get("m") ?? "tone_balance";
  const start = clamp(Number(params.get("from") ?? Math.max(firstYear, 1990)), firstYear, lastYear);
  const end = clamp(Number(params.get("to") ?? lastYear), firstYear, lastYear);
  const showAverage = params.get("avg") !== "0";
  const showEvents = params.get("ev") !== "0";

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const colors = useCountryColors(countries);
  const phone = useMediaQuery("(max-width: 560px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const names = useMemo(() => Object.fromEntries(summary.countries.map((c) => [c.code, c.name])), [summary]);
  const label = metricLabel(metric, meta.metrics);

  const rangeOk = start <= end;
  const series = useAsync(
    () => (rangeOk ? api.un.series({ countries, metric, start, end, average: showAverage }) : Promise.resolve(null)),
    [countries.join(","), metric, start, end, showAverage],
  );
  const shifts = useAsync(
    () => (countries.length && rangeOk ? api.un.shifts({ countries, metric, start, end, n: 8 }) : Promise.resolve([])),
    [countries.join(","), metric, start, end],
  );

  const view: View = VIEWS.some(([key]) => key === params.get("v")) ? params.get("v") as View : "trend";
  useDocumentTitle(`${VIEWS.find(([key]) => key === view)![1]} · UN General Debate`);
  // The speech in Close reading, kept in the address (?r=RUS-2025) so a reading can be linked to and cited
  const [readCode, readParamYear] = (params.get("r") ?? "").split("-");
  const reading = readCode ? { country: readCode, year: Number(readParamYear) || 0 } : null;
  const [year, setYear] = useState(end);     // the one year shown by the flags, the hall and the ranking
  useEffect(() => setYear(end), [end]);
  const [yearView, setYearView] = useState<"flags" | "hall">("flags");
  const [arrivals, setArrivals] = useState(0);   // counts speeches opened from elsewhere on the page
  const matrix = useAsync(() => api.un.matrix(metric), [metric]);
  const space = useAsync(
    () => (countries.length && rangeOk ? Promise.all([
      api.un.series({ countries, metric: "hostility", start, end, average: false }),
      api.un.series({ countries, metric: "cooperation", start, end, average: false }),
    ]) : Promise.resolve(null)),
    [countries.join(","), start, end],
  );

  const chosenFlags = useMemo(() => Object.entries(colors).map(([code, color]) => ({ code, color })), [colors]);
  const formatValue = useCallback((v: number) => formatMetric(metric, v), [metric]);

  const spaceSeries = useMemo(() => (space.data ? space.data[0].series.map((h) => {
    const coop = new Map(space.data![1].series.find((c) => c.country === h.country)?.points
      .map((p) => [p.year, p.value]) ?? []);
    return { key: h.country, label: h.name, color: colors[h.country] ?? PALETTE[scheme][0],
      points: h.points.map((p) => ({ year: p.year, hostility: p.value, cooperation: coop.get(p.year) ?? null })) };
  }) : []), [space.data, colors, scheme]);

  /** Show a tab from its top: when the tab bar is held under the header, the page returns to it. */
  const chooseView = (next: View) => {
    update({ v: next === "trend" ? null : next });
    const anchor = document.getElementById("views");
    if (anchor && anchor.getBoundingClientRect().top < 0) anchor.scrollIntoView?.({ block: "start" });
  };

  /** Open a speech from anywhere on the page: Close reading shows it, the page goes there and focus moves to its
   *  heading. Any delegation can be read, whether or not it is in the chart. */
  const openSpeech = useCallback((code: string, y: number) => {
    update({ v: "read", r: `${code}-${y}` });
    setArrivals((n) => n + 1);
  }, [params]);
  // Once Close reading has rendered with the chosen speech, go there and move focus to its heading
  useEffect(() => {
    if (!arrivals || view !== "read") return;
    stopGlide();
    document.getElementById("views")?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
    document.getElementById("close-reading-title")?.focus({ preventScroll: true });
  }, [arrivals, view]);
  const readCountry = reading?.country && known.has(reading.country) ? reading.country
    : countries[0] ?? summary.countries[0]?.code;
  // The years a delegation spoke: from the all-country matrix (any delegation), or the chart's series meanwhile
  const readYears = useMemo(() => {
    const values = readCountry ? matrix.data?.values[readCountry] : undefined;
    if (matrix.data && values) return matrix.data.years.filter((_, i) => values[i] !== null).reverse();
    const s = series.data?.series.find((x) => x.country === readCountry);
    return s ? s.points.map((p) => p.year).sort((a, b) => b - a) : [];
  }, [matrix.data, series.data, readCountry]);
  const readOptions = useMemo(() => {
    const inChart = countries.map((c) => summary.countries.find((x) => x.code === c)).filter(Boolean) as CountryInfo[];
    const others = summary.countries.filter((c) => !countries.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name));
    return { inChart, others };
  }, [countries.join(","), summary]);
  // A linked year is trusted until the all-country years arrive (the chart's own years may not include it)
  const readYear = reading && reading.country === readCountry
    && (readYears.includes(reading.year) || (!matrix.data && reading.year > 0)) ? reading.year : readYears[0];

  const filters = (
    <>
      <div className="row">
        <CountryPicker options={summary.countries} value={countries} max={max} colors={colors}
          onChange={(codes) => update({ c: codes.join(",") })} />
        <YearInput id="year-from" label="From" value={start} min={firstYear} max={lastYear} invalid={!rangeOk}
          onCommit={(y) => update({ from: String(y) })} />
        <YearInput id="year-to" label="To" value={end} min={firstYear} max={lastYear} invalid={!rangeOk}
          onCommit={(y) => update({ to: String(y) })} />
        <MetricSelect value={metric} onChange={(m) => update({ m })} keywords={summary.keywords} />
      </div>
      {!rangeOk && <p className="field-error" role="alert">The start year is after the end year.</p>}
    </>
  );

  return (
    <>
      <div className="page-intro">
        <h1>UN General Debate, <span className="nowrap">{firstYear}–{lastYear}</span></h1>
        <p>
          {plural(summary.statements, "statement")} by {plural(summary.countries.length, "delegation")}, scored with the
          default dictionaries and VADER.
        </p>
      </div>
      {summary.demo && (
        <Notice kind="warn">Demo data: these are fictional countries and generated texts, not real UN speeches.</Notice>
      )}

      {phone ? (
        // On a phone the filters fold into one line that says what is shown, so the chart starts on the first screen
        <details className="card filters" open={filtersOpen || !rangeOk}
          onToggle={(e) => setFiltersOpen(e.currentTarget.open)}>
          <summary>
            <span>{countries.map((c) => names[c] ?? c).join(", ") || "No countries"} · {start}–{end} · {label}</span>
            <span className="filters-change">Change</span>
          </summary>
          {filters}
        </details>
      ) : (
        <div className="card">{filters}</div>
      )}

      <div id="views" />
      <div className="view-tabs" role="tablist" aria-label="Views of the speeches" onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const i = VIEWS.findIndex(([key]) => key === view);
        const next = VIEWS[(i + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length][0];
        chooseView(next);
        document.getElementById(`view-tab-${next}`)?.focus();
      }}>
        {VIEWS.map(([key, text, short]) => (
          <button key={key} id={`view-tab-${key}`} type="button" role="tab" aria-selected={view === key}
            aria-label={text} aria-controls="view-panel" tabIndex={view === key ? 0 : -1} onClick={() => chooseView(key)}>
            <span className="nav-long">{text}</span><span className="nav-short">{short}</span>
          </button>
        ))}
      </div>

      <div id="view-panel" role="tabpanel" aria-labelledby={`view-tab-${view}`}>
        {view === "trend" && (
          <>
            <div className="card">
              <div className="card-head">
                <h2>{label}</h2>
                <DownloadLink href={api.un.exportUrl({ countries, start, end })}>Download selection (CSV)</DownloadLink>
              </div>
              <div className="row chart-options">
                <label className="checkbox">
                  <input type="checkbox" checked={showAverage} onChange={(e) => update({ avg: e.target.checked ? null : "0" })} />
                  All-country average
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={showEvents} onChange={(e) => update({ ev: e.target.checked ? null : "0" })} />
                  Key events
                </label>
              </div>
              {!rangeOk ? (
                <p className="empty">Choose a start year before the end year.</p>
              ) : series.error ? (
                <Notice kind="error" onRetry={series.reload}>{series.error}</Notice>
              ) : !countries.length ? (
                <p className="empty">Choose at least one country.</p>
              ) : series.data ? (
                <TrendChart
                  series={series.data.series.map((s) => ({ key: s.country, label: s.name, color: colors[s.country], points: s.points }))}
                  average={showAverage ? series.data.average : null}
                  events={showEvents ? meta.events : []}
                  format={(v) => formatMetric(metric, v)}
                  tickFormat={tickFormat(metric)}
                  valueLabel={label}
                  reloading={series.loading}
                />
              ) : (
                <div className="chart-loading"><Loading /></div>
              )}
              <Limitations />
            </div>

            <div className="card">
              <h2>Biggest shifts</h2>
              <p className="muted small">Largest changes from one statement to the next. Pick a row to read that speech.</p>
              {!rangeOk ? <p className="empty">Choose a start year before the end year.</p>
                : shifts.error ? <Notice kind="error" onRetry={shifts.reload}>{shifts.error}</Notice>
                : !shifts.data ? <Loading />
                : !shifts.data.length ? <p className="empty">Not enough data.</p> : (
                  <div className="table-wrap" tabIndex={0} role="region" aria-label="Biggest shifts">
                    <table>
                      <thead>
                        <tr><th>Country</th><th>Years</th><th className="num">Change</th><th className="num">New value</th></tr>
                      </thead>
                      <tbody>
                        {shifts.data.map((s) => (
                          <tr key={`${s.country}-${s.year}`} className="clickable"
                            onClick={() => openSpeech(s.country, s.year)}>
                            <td><RowLink onClick={() => openSpeech(s.country, s.year)}>{s.name}</RowLink></td>
                            <td>{s.from_year}→{s.year}</td>
                            <td className="num">{formatDelta(metric, s.change)}</td>
                            <td className="num">{formatMetric(metric, s.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </>
        )}

        {view === "year" && (
          <>
            <div className="card">
              <div className="card-head">
                <h2>Year by year</h2>
                <div className="tabs" role="tablist" aria-label="Shown as" onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  const next = yearView === "flags" ? "hall" : "flags";
                  setYearView(next);
                  document.getElementById(`year-tab-${next}`)?.focus();
                }}>
                  {([["flags", "Flags"], ["hall", "Assembly hall"]] as const).map(([key, text]) => (
                    <button key={key} id={`year-tab-${key}`} type="button" role="tab" aria-selected={yearView === key}
                      aria-controls="year-panel" tabIndex={yearView === key ? 0 : -1}
                      onClick={() => setYearView(key)}>{text}</button>
                  ))}
                </div>
              </div>
              <div id="year-panel" role="tabpanel" aria-labelledby={`year-tab-${yearView}`}>
                {matrix.error ? <Notice kind="error" onRetry={matrix.reload}>{matrix.error}</Notice>
                  : !matrix.data ? <div className="view3d-loading"><Loading /></div> : (
                    <Suspense fallback={<div className="view3d-loading"><Loading label="Loading 3D…" /></div>}>
                      {yearView === "flags" ? (
                        <FlagLine matrix={matrix.data} metricLabel={label} names={names}
                          format={formatValue} year={year} onYearChange={setYear}
                          chosen={chosenFlags} onPick={openSpeech} />
                      ) : (
                        <AssemblyHall matrix={matrix.data} metricLabel={label} names={names}
                          format={formatValue} year={year} onYearChange={setYear}
                          chosen={chosenFlags} onPick={openSpeech} />
                      )}
                    </Suspense>
                  )}
                {matrix.data && (
                  <YearTable matrix={matrix.data} year={year} names={names} label={label} format={formatValue}
                    onPick={openSpeech} />
                )}
              </div>
            </div>
            <RankingCard metric={metric} year={year} names={names} colors={colors} onPick={openSpeech} />
          </>
        )}

        {view === "space" && (
          <div className="card">
            <div className="card-head">
              <h2>Rhetoric space</h2>
              <span className="small muted">hostile × cooperative words × time, {start}–{end}</span>
            </div>
            {space.error ? <Notice kind="error" onRetry={space.reload}>{space.error}</Notice>
              : !countries.length ? <p className="empty">Choose at least one country.</p>
              : !rangeOk ? <p className="empty">Choose a start year before the end year.</p>
              : !space.data ? <div className="space-loading"><Loading /></div> : (
                <Suspense fallback={<div className="space-loading"><Loading label="Loading 3D…" /></div>}>
                  <RhetoricSpace series={spaceSeries} onPick={openSpeech} />
                </Suspense>
              )}
            <p className="small muted">
              Each line is one country&apos;s path through the years. Points above the shaded plane used more cooperative
              than hostile words that year.
            </p>
            {spaceSeries.length > 0 && <SpaceTable series={spaceSeries} onPick={openSpeech} />}
          </div>
        )}

        {view === "read" && (
          <CloseReading
            inChart={readOptions.inChart}
            others={readOptions.others}
            country={readCountry}
            year={readYear}
            years={readYears}
            onChange={(country, y) => update({ r: y ? `${country}-${y}` : country })}
          />
        )}
      </div>

      <p className="muted small data-note">
        Data: {meta.citation}. Texts are the official English versions. CC0 licence.{" "}
        <a href={api.un.exportUrl({})} download>Download all scores (CSV)</a>
      </p>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** A year field that can be typed into. A complete year in range applies at once (so the arrow keys and the
 *  spinner still step); anything else is checked against the range on Enter or when the field is left. */
function YearInput({ id, label, value, min, max, onCommit, invalid = false }: {
  id: string; label: string; value: number; min: number; max: number; onCommit: (year: number) => void;
  /** Marked as wrong from outside (a start year after the end year). */
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [changed, setChanged] = useState<string | null>(null);   // "Changed to 2025": a typed year was out of range
  useEffect(() => setDraft(String(value)), [value]);
  const isYear = (s: string) => /^\d{4}$/.test(s.trim()) && Number(s) >= min && Number(s) <= max;
  const finish = () => {
    if (!draft.trim()) return setDraft(String(value));
    const year = clamp(Number(draft), min, max);
    if (String(year) !== draft.trim()) setChanged(`Changed to ${year}: the data runs ${min}–${max}.`);
    setDraft(String(year));
    if (year !== value) onCommit(year);
  };
  const ok = isYear(draft);
  const note = !ok ? `${min}–${max}` : changed;
  return (
    <div className="field year-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={draft}
        aria-invalid={!ok || invalid ? true : undefined} aria-describedby={note ? `${id}-note` : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          setChanged(null);
          if (isYear(next) && Number(next) !== value) onCommit(Number(next));
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish();
        }} />
      {note && <span className="hint" id={`${id}-note`} role="status">{note}</span>}
    </div>
  );
}

/** A country's name in a table row, as a button: the row opens that speech from the keyboard too. */
function RowLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="row-link" onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}>{children}</button>
  );
}

/** The year shown by the flags and the hall, as a table: every delegation that spoke, highest first. */
function YearTable({ matrix, year, names, label, format, onPick }: {
  matrix: Matrix; year: number; names: Record<string, string>; label: string; format: (v: number) => string;
  onPick: (code: string, year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const i = matrix.years.indexOf(year);
  const rows = open && i >= 0
    ? matrix.countries.flatMap((c) => {
      const value = matrix.values[c.code]?.[i];
      return value === null || value === undefined ? []
        : [{ code: c.code, name: speakerName(c.code, year, names[c.code] ?? c.name), value }];
    }).sort((a, b) => b.value - a.value)
    : [];
  return (
    <details className="table-view" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Show {year} as a table</summary>
      {open && (rows.length ? (
        <div className="table-wrap tall" tabIndex={0} role="region" aria-label={`${label} in ${year}`}>
          <table>
            <thead><tr><th className="num">#</th><th>Country</th><th className="num">{label}</th></tr></thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={r.code} className="clickable" onClick={() => onPick(r.code, year)}>
                  <td className="num">{k + 1}</td>
                  <td><RowLink onClick={() => onPick(r.code, year)}>{r.name}</RowLink></td>
                  <td className="num">{format(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">No statements in {year}.</p>)}
    </details>
  );
}

/** The rhetoric space's points as a table: one row per country and year. */
function SpaceTable({ series, onPick }: {
  series: { key: string; label: string; points: { year: number; hostility: number | null; cooperation: number | null }[] }[];
  onPick: (code: string, year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = open ? series.flatMap((s) => s.points.map((p) => ({ code: s.key, name: s.label, ...p }))) : [];
  const cell = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  return (
    <details className="table-view" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Show the points as a table</summary>
      {open && (
        <div className="table-wrap tall" tabIndex={0} role="region" aria-label="Rhetoric space points">
          <table>
            <thead>
              <tr><th>Country</th><th>Year</th><th className="num">Hostile / 1,000</th><th className="num">Cooperative / 1,000</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.code}-${r.year}`} className="clickable" onClick={() => onPick(r.code, r.year)}>
                  <td>{r.name}</td>
                  <td><RowLink onClick={() => onPick(r.code, r.year)}>{r.year}</RowLink></td>
                  <td className="num">{cell(r.hostility)}</td>
                  <td className="num">{cell(r.cooperation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function RankingCard({ metric, year, names, colors, onPick }: {
  metric: string; year: number; names: Record<string, string>; colors: Record<string, string>;
  onPick: (code: string, year: number) => void;
}) {
  const meta = useMeta();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const ranking = useAsync(() => api.un.ranking(year, metric), [year, metric]);
  const shownYear = ranking.data?.year ?? year;      // the old year's rows stay up while the next year loads
  const rows = (ranking.data?.rows ?? []).filter((r) =>
    !filter || `${r.name} ${r.country}`.toLowerCase().includes(filter.toLowerCase()));
  // The top 15, plus the chart's countries wherever they stand, so the ranking places them among all the others
  const visible = showAll || filter ? rows : rows.filter((r, i) => i < 15 || r.country in colors);
  const position = new Map(rows.map((r, i) => [r.country, i]));
  const values = (ranking.data?.rows ?? []).map((r) => r.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const top = useMemo(() => (ranking.data?.rows ?? []).slice(0, 3)
    .map((r) => ({ country: r.country, name: speakerName(r.country, shownYear, names[r.country] ?? r.name),
      value: r.value, flag: speakerFlag(r.country, shownYear) })), [ranking.data, names, shownYear]);
  const formatValue = useCallback((v: number) => formatMetric(metric, v), [metric]);

  return (
    <div className="card">
      <div className="card-head ranking-head">
        <div>
          <h2>Country ranking</h2>
          <p className="muted small">{metricLabel(metric, meta.metrics)} in {shownYear}, highest first. The year follows
            the player above.</p>
        </div>
        <div className="field">
          <label htmlFor="rank-filter">Find a country</label>
          <input id="rank-filter" type="search" value={filter} style={{ width: "9rem" }}
            onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {top.length > 0 && ranking.data && !meta.metrics.find((m) => m.id === metric)?.higher_is_worse && (
        <Suspense fallback={<div className="podium3d" aria-hidden="true" />}>
          <Podium rows={top} format={formatValue} onPick={(code) => onPick(code, shownYear)} />
        </Suspense>
      )}
      {ranking.error ? <Notice kind="error" onRetry={ranking.reload}>{ranking.error}</Notice>
        : !ranking.data ? <Loading />
        : !rows.length ? <p className="empty">No statements for this year.</p> : (
          <>
            <div className="table-wrap tall" tabIndex={0} role="region" aria-label="Country ranking">
              <table className="ranking">
                <thead><tr><th className="num rank">#</th><th>Country</th><th aria-hidden="true" /><th className="num">Value</th></tr></thead>
                <tbody>
                  {visible.map((r, i) => {
                    const chosen = r.country in colors;
                    const afterGap = i > 0 && position.get(r.country)! - position.get(visible[i - 1].country)! > 1;
                    return (
                      <tr key={r.country} className={["clickable", chosen && "chosen", afterGap && "after-gap"].filter(Boolean).join(" ")}
                        onClick={() => onPick(r.country, shownYear)}>
                        <td className="num">{r.rank}</td>
                        <td>
                          {chosen && <span className="line-key" style={{ borderColor: colors[r.country] }} aria-hidden="true" />}
                          <RowLink onClick={() => onPick(r.country, shownYear)}>
                            {speakerName(r.country, shownYear, names[r.country] ?? r.name)}</RowLink>
                        </td>
                        <td className="bar-col" aria-hidden="true">
                          <span className="bar-track">
                            <span className="bar-fill" style={{
                              left: `${((Math.min(0, r.value) - lo) / span) * 100}%`,
                              width: `${Math.max((Math.abs(r.value) / span) * 100, 0.5)}%`,
                            }} />
                          </span>
                        </td>
                        <td className="num">{formatMetric(metric, r.value)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!filter && rows.length > 15 && (
              <button type="button" className="btn link small" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show top 15" : `Show all ${rows.length}`}
              </button>
            )}
          </>
        )}
    </div>
  );
}

// The notable-sentence lists, in tab order
const KINDS: [NotableSentence["kind"], string][] = [
  ["hostile", "Most hostile"], ["negative", "Most negative"], ["cooperative", "Most cooperative"],
];


function CloseReading({ inChart, others, country, year, years, onChange }: {
  inChart: CountryInfo[]; others: CountryInfo[]; country?: string; year?: number; years: number[];
  onChange: (country: string, year?: number) => void;
}) {
  const meta = useMeta();
  const statement = useAsync<Statement | null>(
    () => (country && year ? api.un.statement(country, year) : Promise.resolve(null)),
    [country, year],
  );
  const fullText = useAsync<StatementText | null>(
    () => (country && year ? api.un.statementText(country, year) : Promise.resolve(null)),
    [country, year],
  );
  const loaded = fullText.data;
  const reading = loaded && loaded.country === country && loaded.year === year ? loaded.reading : null;
  const { flat, texts } = useFlatReading(reading);
  const speech = useSpeech(texts);
  const listening = speech.status !== "idle";
  const bar = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<number | null>(null);          // a sentence picked from the notable lists
  const [picked, setKind] = useState<NotableSentence["kind"] | null>(null);
  useEffect(() => {
    setJump(null);
    setKind(null);
  }, [country, year]);
  const position = useMemo(() => new Map(flat.map((s, i) => [s.index, i])), [flat]);   // scored number → reading order
  // A speech opens on its first list that has sentences
  const sentences = statement.data?.sentences ?? [];
  const kind = picked ?? KINDS.find(([k]) => sentences.some((s) => s.kind === k))?.[0] ?? "hostile";
  const notable = sentences.filter((s) => s.kind === kind);
  const goTo = (scored: number) => {
    const i = position.get(scored);
    if (i === undefined) return;
    if (listening) speech.seek(i);
    else setJump(i);
    stopGlide();
    document.querySelector('[data-testid="full-speech"]')?.scrollIntoView?.({ behavior: scrollBehavior(), block: "nearest" });
  };
  const name = statement.data ? speakerName(statement.data.country, statement.data.year, statement.data.name) : "";
  return (
    <div className="card" id="close-reading">
      <div className="card-head">
        <h2 id="close-reading-title" tabIndex={-1}>Close reading</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="read-country">Delegation</label>
            <select id="read-country" value={country} onChange={(e) => onChange(e.target.value)}>
              {inChart.length > 0 && (
                <optgroup label="In the chart">
                  {inChart.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </optgroup>
              )}
              <optgroup label={inChart.length > 0 ? "Other delegations" : "All delegations"}>
                {others.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label htmlFor="read-year">Year</label>
            <select id="read-year" value={year} onChange={(e) => country && onChange(country, Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>
      {statement.error ? <Notice kind="error" onRetry={statement.reload}>{statement.error}</Notice>
        : !statement.data ? (statement.loading ? <div className="reading-loading"><Loading /></div>
          : <p className="empty">No statement for this delegation.</p>) : (
          <div style={{ opacity: statement.loading ? 0.6 : 1 }}>
            <div className="reading-head">
              <Suspense fallback={<div className="rostrum3d" />}>
                <Rostrum code={speakerFlag(statement.data.country, statement.data.year)} name={name}
                  year={statement.data.year} session={statement.data.session} speaking={speech.status === "playing"} />
              </Suspense>
              <div>
                <h3 className="reading-title">{name}</h3>
                <p className="muted small">
                  Session {statement.data.session} · {statement.data.year} ·{" "}
                  {plural(statement.data.counts.words, "word")} ·{" "}
                  {/* the full text can hold a sentence too short to score; Listen counts every sentence it reads */}
                  {flat.length > statement.data.counts.sentences
                    && statement.data.country === country && statement.data.year === year
                    ? `${plural(flat.length, "sentence")}, ${statement.data.counts.sentences.toLocaleString("en")} scored`
                    : plural(statement.data.counts.sentences, "scored sentence")}
                </p>
                {!(fullText.error && !fullText.loading) && <ListenBar speech={speech} what="this speech" barRef={bar} />}
                {listening && <NowReading sentence={flat[speech.current]} />}
              </div>
            </div>
            <MetricCards metrics={statement.data.metrics} />
            <MiniPlayer speech={speech} anchor={bar} what={`${name}'s speech`} />
            <div className="reading-body">
              <div className="reading-main">
                <div className="card-head">
                  <h3>The speech</h3>
                  <HighlightKeys />
                </div>
                {reading ? (
                  <ReadingText reading={reading} current={listening ? speech.current : jump} label="The speech"
                    onPick={speech.supported ? speech.play : undefined} testId="full-speech" />
                ) : fullText.loading ? <Loading /> : <p className="muted small">The full text is not available.</p>}
              </div>
              <div className="reading-side" role="region" aria-label="Notable sentences">
                <div className="tabs" role="tablist" aria-label="Notable sentences" onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  const i = KINDS.findIndex(([k]) => k === kind);
                  const next = KINDS[(i + (e.key === "ArrowRight" ? 1 : KINDS.length - 1)) % KINDS.length][0];
                  setKind(next);
                  document.getElementById(`kind-tab-${next}`)?.focus();
                }}>
                  {KINDS.map(([k, text]) => (
                    <button key={k} id={`kind-tab-${k}`} type="button" role="tab" aria-selected={kind === k}
                      aria-controls="kind-panel" tabIndex={kind === k ? 0 : -1} onClick={() => setKind(k)}>
                      <span className={`dot ${k}`} aria-hidden="true" />{text}
                    </button>
                  ))}
                </div>
                <div id="kind-panel" role="tabpanel" aria-labelledby={`kind-tab-${kind}`}>
                  {notable.length ? (
                    <ul className="sentences">
                      {notable.map((s) => (
                        <li key={`${kind}-${s.position}`}>
                          <HighlightedText text={s.sentence} spans={s.highlights} />
                          <span className="score">
                            {kind === "negative" ? `VADER ${fixed(s.score, 2)}` : `${s.score} ${kind} word${s.score === 1 ? "" : "s"}`} ·{" "}
                            {position.has(s.position) ? (
                              <button type="button" className="btn link listen-from"
                                aria-label={`Show sentence ${s.position + 1} in the speech`}
                                onClick={() => goTo(s.position)}>
                                sentence {s.position + 1}
                              </button>
                            ) : `sentence ${s.position + 1}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="empty">None.</p>}
                </div>
              </div>
            </div>
            <details className="table-view">
              <summary>Keyword rates in this statement</summary>
              <ul className="terms">
                {Object.entries(statement.data.keywords).map(([k, v]) => (
                  <li key={k}>{metricLabel(`${KEYWORD_PREFIX}${k}`, meta.metrics).replace(" per 1,000 words", "")}{" "}
                    <span className="muted">{formatMetric(`${KEYWORD_PREFIX}${k}`, v)}</span></li>
                ))}
              </ul>
            </details>
          </div>
        )}
    </div>
  );
}
