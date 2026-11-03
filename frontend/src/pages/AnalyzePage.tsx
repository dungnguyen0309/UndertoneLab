import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { api, ApiError } from "../api/client";
import type { AnalyzeResult, Reading, SentenceScore } from "../api/types";
import { HighlightKeys, Limitations, Notice } from "../components/common";
import { ListenBar, MiniPlayer, ReadingText, useFlatReading } from "../components/Listen";
import MetricCards from "../components/MetricCards";
import ToneRecord from "../components/ToneRecord";
import SaveToDataset from "../components/SaveToDataset";
import { downloadText, toCsv } from "../lib/csv";
import { fixed, formatMetric, percent, plural } from "../lib/format";
import { scrollBehavior, stopGlide } from "../lib/media";
import { errorText, useDictionaries, useDocumentTitle, useMeta } from "../lib/hooks";
import { useSpeech } from "../lib/speech";

// three.js loads after the page itself, so the form is usable straight away.
const SentenceLandscape = lazy(() => import("../three/SentenceLandscape"));
const BalanceScale = lazy(() => import("../three/BalanceScale"));

export const SAMPLE_TEXT =
  "Mr. President, on behalf of the Republic of Valdoria, I congratulate you on your election. " +
  "Our nation remains committed to multilateralism, dialogue and mutual respect among all States. " +
  "We welcome the agreement reached on regional connectivity and stand ready to deepen cooperation with our partners.\n\n" +
  "Yet we cannot remain silent. The unilateral sanctions imposed on our people are illegal and violate " +
  "the Charter of the United Nations. Some powers still cling to a Cold War mentality and a bloc mentality, " +
  "using disinformation to justify interference in the internal affairs of sovereign nations. " +
  "We condemn these double standards. Hegemony has no place in the twenty-first century.\n\n" +
  "Let us instead build bridges, restore trust and work together for a peaceful, inclusive and prosperous future. " +
  "Valdoria extends the hand of friendship to every nation willing to engage on the basis of equality and goodwill.";

type SortKey = "original" | "hostile" | "negative" | "cooperative";

// The text and the last result outlive a visit to another page and a reload, for as long as the tab stays open.
// Storage can be full or blocked; the page then works as before and forgets on leaving.
// Raise the version when the shape of AnalyzeResult changes, so an open tab never restores an old shape.
const KEPT = "dla.analyze.v1";

function kept<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(`${KEPT}.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function keep(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(`${KEPT}.${key}`, JSON.stringify(value));
  } catch {
    /* see above */
  }
}

export default function AnalyzePage() {
  useDocumentTitle("");
  const meta = useMeta();
  const dictionaries = useDictionaries();
  const textId = useId();
  const [text, setText] = useState(() => kept("text", ""));
  // A kept result comes back only while the dictionaries are the ones it was scored with
  const [last] = useState(() => {
    const k = kept<{ result: AnalyzeResult; text: string; custom?: unknown } | null>("result", null);
    return k && JSON.stringify(k.custom ?? null) === JSON.stringify(dictionaries.custom ?? null) ? k : null;
  });
  const [analyzedText, setAnalyzedText] = useState(last?.text ?? "");
  const [result, setResult] = useState<AnalyzeResult | null>(last?.result ?? null);
  // `retry`: the error came from sending the text and may pass, so the notice offers Try again
  const [error, setError] = useState<{ message: string; retry?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [useContext, setUseContext] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const results = useRef<HTMLElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => keep("text", text), [text]);
  useEffect(() => keep("result", result && { result, text: analyzedText, custom: dictionaries.custom ?? null }),
    [result, analyzedText]);

  // A new result: bring it into view and move focus to it, so keyboard and screen-reader users land on it too.
  // A result brought back from the session leaves the page where it opens.
  const restored = useRef(result);
  useEffect(() => {
    if (!result || result === restored.current) return;
    stopGlide();
    results.current?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
    results.current?.focus({ preventScroll: true });
    setAnnouncement(`Results ready. ${verdict(result.metrics.tone_balance)}.`);
  }, [result]);

  const analyze = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim()) {
      setEmpty(true);
      textBox.current?.focus();
      return;
    }
    setEmpty(false);
    setBusy(true);
    setError(null);
    try {
      const custom = dictionaries.custom
        ? { hostile_terms: dictionaries.custom.hostile, coop_terms: dictionaries.custom.cooperative }
        : {};
      const r = await api.analyze(text, custom, useContext);
      setResult(r);
      setAnalyzedText(text);
    } catch (err) {
      // A rejected text (too short, too long) fails again unchanged; a lost connection or a server error may not
      const retry = !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500;
      setError({ message: errorText(err), retry });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > meta.limits.max_upload_bytes) {
      setError({ message: `That file is larger than ${Math.round(meta.limits.max_upload_bytes / 1_000_000)} MB. Paste its text instead.` });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const extracted = await api.extractText(file);
      setText(extracted.text);
      setFileNote(`Loaded ${extracted.filename}${extracted.pages ? ` (${extracted.pages} pages)` : ""}` +
        `${extracted.truncated ? `, shortened to the first ${meta.limits.max_text_chars.toLocaleString()} characters` : ""}.`);
    } catch (err) {
      setError({ message: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-intro">
        <h1>Analyze a diplomatic text</h1>
        <p>
          A speech, joint statement or state-media article in English: its hostile and cooperative vocabulary, the
          sentiment of every sentence, and how it compares with recent UN General Debate speeches.
        </p>
      </div>

      <form className="card stack" onSubmit={analyze}>
        <div className="field">
          <label htmlFor={textId}>Text</label>
          <textarea id={textId} ref={textBox} rows={9} value={text} maxLength={meta.limits.max_text_chars}
            placeholder="Paste an English text here…" aria-keyshortcuts="Control+Enter Meta+Enter"
            aria-invalid={empty || undefined} aria-describedby={empty ? `${textId}-empty` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setFileNote(null);
              setEmpty(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void analyze();
              }
            }} />
          {empty && <span className="field-error" id={`${textId}-empty`} role="alert">Paste a text or upload a file first.</span>}
          <span className="hint">
            {text.length.toLocaleString()} / {meta.limits.max_text_chars.toLocaleString()} characters
            {fileNote ? ` · ${fileNote}` : ""}
          </span>
        </div>
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Working…" : "Analyze"}</button>
          <button type="button" className="btn" onClick={() => {
            setText(SAMPLE_TEXT);
            setFileNote("Sample text about the fictional Republic of Valdoria.");
          }}>Use sample text</button>
          <label className="btn" style={{ fontWeight: 600 }}>
            Upload .txt or .pdf
            <input type="file" accept=".txt,.pdf,text/plain,application/pdf" className="visually-hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }} />
          </label>
          {text && <button type="button" className="btn link" onClick={() => {
            setText("");
            setFileNote(null);
          }}>Clear</button>}
        </div>
        <div className="row small muted">
          <span>
            Dictionaries: {dictionaries.custom ? "your custom lists" : "default"} ·{" "}
            <Link to="/dictionaries">edit</Link>
          </span>
          {meta.context_model.available && (
            <label className="checkbox small">
              <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} />
              Also label each sentence with the context model ({meta.context_model.name})
            </label>
          )}
        </div>
      </form>

      {error && (
        // Try again goes away while it sends, so focus first moves to the text box, which stays
        <Notice kind="error" onRetry={error.retry ? () => {
          textBox.current?.focus({ preventScroll: true });
          void analyze();
        } : undefined}>{error.message}</Notice>
      )}
      <p className="visually-hidden" role="status">{announcement}</p>
      {result && <Results result={result} text={analyzedText} sectionRef={results} onEdit={() => {
        textBox.current?.focus({ preventScroll: true });
        textBox.current?.scrollIntoView?.({ block: "center" });
      }} />}
    </>
  );
}

function Results({ result, text, sectionRef, onEdit }: {
  result: AnalyzeResult; text: string; sectionRef: Ref<HTMLElement>; onEdit: () => void;
}) {
  const base = result.baseline;
  const [focus, setFocus] = useState<number | null>(null);
  const [tab, setTab] = useState<"words" | "sentences">("words");
  return (
    <section aria-label="Results" className="results" tabIndex={-1} ref={sectionRef}>
      <div className="card record">
        <div className="card-head">
          <div className="verdict">
            {result.metrics.tone_balance !== null && (
              <span className="verdict-figure">{formatMetric("tone_balance", result.metrics.tone_balance)}</span>
            )}
            <div>
              <h2 className="verdict-lead">{verdict(result.metrics.tone_balance)}</h2>
              {result.metrics.tone_balance !== null && (
                <span className="small muted">
                  Tone balance{standing(result.metrics.tone_balance, base?.averages.tone_balance)}
                </span>
              )}
            </div>
          </div>
          <button type="button" className="btn small" onClick={onEdit}>Edit the text</button>
        </div>
        {base && base.tone_share_below !== null && base.hostility_share_below !== null
          && base.cooperation_share_below !== null && (
          <>
            <p data-testid="baseline-sentence">
              Among the {base.statements.toLocaleString()} UN General Debate statements from {base.first_year}–{base.last_year},
              its tone balance is {rank(base.tone_share_below)}. It uses hostile words more often than
              {" "}{share(base.hostility_share_below)} of them, and cooperative words more often than{" "}
              {share(base.cooperation_share_below)} of them.
            </p>
            {base.tone_histogram.length > 0 && result.metrics.tone_balance !== null && (
              <ToneRecord histogram={base.tone_histogram} value={result.metrics.tone_balance}
                average={base.averages.tone_balance} years={`${base.first_year}–${base.last_year}`}
                shareBelow={base.tone_share_below} />
            )}
          </>
        )}
        {result.warnings.map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
      </div>
      {/* tone balance leads the record above, so the strip leaves it out */}
      <MetricCards metrics={result.metrics} compareTo={base?.averages}
        compareLabel={base ? "UN avg" : undefined} skip="tone_balance" />
      <p className="muted small">
        {plural(result.counts.words, "word")} · {plural(result.counts.sentences, "sentence")} ·{" "}
        {result.counts.hostile_hits.toLocaleString("en")} hostile and {result.counts.coop_hits.toLocaleString("en")} cooperative
        dictionary words
      </p>

      {/* The details in two tabs, kept mounted so a reading aloud carries on when the other tab is open */}
      <div className="view-tabs" role="tablist" aria-label="Result details" onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const next = tab === "words" ? "sentences" : "words";
        setTab(next);
        document.getElementById(`result-tab-${next}`)?.focus();
      }}>
        {([["words", "Words"], ["sentences", "Sentences"]] as const).map(([key, label]) => (
          <button key={key} id={`result-tab-${key}`} type="button" role="tab" aria-selected={tab === key}
            aria-controls={`result-panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      <div role="tabpanel" id="result-panel-words" aria-labelledby="result-tab-words" hidden={tab !== "words"}>
        <div className="grid-2">
          <HighlightedCard reading={result.reading} />
          <div className="card">
            <h2>Balance of words</h2>
            <Suspense fallback={<div className="balance3d-stage" aria-hidden="true" />}>
              <BalanceScale hostile={result.counts.hostile_hits} cooperative={result.counts.coop_hits}
                hostileTerms={result.top_terms.hostile} coopTerms={result.top_terms.cooperative}
                unAverage={base?.averages.tone_balance ?? null} />
            </Suspense>
            <h3 className="small">Most frequent hostile words</h3>
            <TermList terms={result.top_terms.hostile} />
            <h3 className="small">Most frequent cooperative words</h3>
            <TermList terms={result.top_terms.cooperative} />
          </div>
        </div>
      </div>

      <div role="tabpanel" id="result-panel-sentences" aria-labelledby="result-tab-sentences" hidden={tab !== "sentences"}>
        <SentenceTable sentences={result.sentences} contextUsed={result.context_model.used} focus={focus} />
        <div className="card">
          <div className="card-head">
            <h2>Sentence landscape</h2>
            <span className="small muted">{plural(result.sentences.length, "sentence")} in reading order · tap one to find it in the table</span>
          </div>
          <Suspense fallback={<div className="landscape3d-stage" aria-hidden="true" />}>
            <SentenceLandscape sentences={result.sentences} onPick={(index) => {
              setFocus(index);
              stopGlide();
              document.getElementById(`sentence-${index}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
            }} />
          </Suspense>
        </div>
      </div>
      <Limitations />
      <details className="save-details">
        <summary className="btn">Save this text to a dataset</summary>
        <SaveToDataset text={text} />
      </details>
    </section>
  );
}

/** The overall tone in words, from the tone balance (−1 all hostile … +1 all cooperative). */
function verdict(toneBalance: number | null) {
  if (toneBalance === null) return "No hostile or cooperative dictionary words found";
  if (toneBalance >= 0.5) return "Clearly conciliatory";
  if (toneBalance >= 0.1) return "Leaning conciliatory";
  if (toneBalance > -0.1) return "Evenly balanced between hostile and cooperative words";
  if (toneBalance > -0.5) return "Leaning confrontational";
  return "Clearly confrontational";
}

/** The tone balance against the UN average, after its label: ", below the UN average (+0.27)". A fact in ink, not
 *  a second verdict: it says why "Leaning conciliatory" can still rank low among UN speeches. */
function standing(value: number, average: number | null | undefined) {
  if (average === null || average === undefined) return "";
  const shown = formatMetric("tone_balance", average);
  const side = shown === formatMetric("tone_balance", value) ? "level with" : value > average ? "above" : "below";
  return `, ${side} the UN average (${shown})`;
}

/** Where a value sits among the UN statements: "higher than 87% of them", "higher than all of them". */
function rank(shareBelow: number) {
  if (shareBelow >= 0.995) return "higher than all of them";
  if (shareBelow <= 0.005) return "lower than all of them";
  return `higher than ${percent(shareBelow)} of them`;
}

/** "all", "none" or a percentage, for "more often than … of them". */
function share(shareBelow: number) {
  if (shareBelow >= 0.995) return "all";
  if (shareBelow <= 0.005) return "none";
  return percent(shareBelow);
}

function TermList({ terms }: { terms: [string, number][] }) {
  if (!terms.length) return <p className="empty">None found.</p>;
  return (
    <ul className="terms">
      {terms.map(([term, count]) => <li key={term}>{term} <span className="muted">×{count}</span></li>)}
    </ul>
  );
}

function HighlightedCard({ reading }: { reading: Reading }) {
  const { texts } = useFlatReading(reading);
  const speech = useSpeech(texts);
  const bar = useRef<HTMLDivElement>(null);
  return (
    <div className="card">
      <h2>Highlighted text</h2>
      <ListenBar speech={speech} what="the text" barRef={bar} />
      <MiniPlayer speech={speech} anchor={bar} what="the text" />
      <HighlightKeys />
      <ReadingText reading={reading} current={speech.status === "idle" ? null : speech.current} label="Highlighted text"
        onPick={speech.supported ? speech.play : undefined} testId="highlighted-text" />
    </div>
  );
}

function SentenceTable({ sentences, contextUsed, focus }: {
  sentences: SentenceScore[]; contextUsed: boolean; focus: number | null;
}) {
  const [sort, setSort] = useState<SortKey>("hostile");
  const sorted = useMemo(() => {
    const s = [...sentences];
    if (sort === "hostile") s.sort((a, b) => b.hostile_hits - a.hostile_hits || a.vader - b.vader);
    if (sort === "negative") s.sort((a, b) => a.vader - b.vader);
    if (sort === "cooperative") s.sort((a, b) => b.coop_hits - a.coop_hits || b.vader - a.vader);
    return s;
  }, [sentences, sort]);

  const exportCsv = () => {
    const rows = sentences.map((s) => ({ number: s.index + 1, sentence: s.sentence, vader: s.vader,
      hostile_words: s.hostile_hits, cooperative_words: s.coop_hits, context_label: s.context?.label ?? "" }));
    downloadText("sentence_scores.csv", toCsv(rows, ["number", "sentence", "vader", "hostile_words",
      "cooperative_words", ...(contextUsed ? ["context_label"] : [])]));
  };

  // Sortable headings as on the dictionaries' word counts: # and VADER run up (most negative first), the counts down
  const header = (key: SortKey, text: ReactNode) => (
    <th className="num"
      aria-sort={sort === key ? (key === "original" || key === "negative" ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => setSort(key)}>{text}</button>
    </th>
  );

  return (
    <div className="card">
      <div className="card-head">
        <h2>Sentence scores</h2>
        <button type="button" className="btn small" onClick={exportCsv}>Download CSV</button>
      </div>
      <p className="muted small">
        VADER rates each sentence from −1 (negative) to +1 (positive); Hostile and Cooperative count its dictionary
        words. Select a column heading to sort by it.
      </p>
      {/* on a phone the headings scroll out of view with the table, so the sorts are also a menu */}
      <label className="field inline narrow-only">
        Sort by
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="hostile">Most hostile</option>
          <option value="negative">Most negative (VADER)</option>
          <option value="cooperative">Most cooperative</option>
          <option value="original">Original order</option>
        </select>
      </label>
      <div className="table-wrap tall" tabIndex={0} role="region" aria-label="Sentence scores">
        <table>
          <thead>
            <tr>
              {header("original", <>#<span className="visually-hidden"> (original order)</span></>)}
              <th>Sentence</th>
              {header("negative", "VADER")}
              {header("hostile", "Hostile")}
              {header("cooperative", "Cooperative")}
              {contextUsed && <th>Context model</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.index} id={`sentence-${s.index}`} className={s.index === focus ? "focused" : undefined}>
                <td className="num">{s.index + 1}</td>
                <td className="sentence-cell">{s.sentence}</td>
                <td className="num">{fixed(s.vader, 2)}</td>
                <td className="num">{s.hostile_hits}</td>
                <td className="num">{s.coop_hits}</td>
                {contextUsed && <td>{s.context ? `${s.context.label} (${Math.round(s.context.score * 100)}%)` : "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
