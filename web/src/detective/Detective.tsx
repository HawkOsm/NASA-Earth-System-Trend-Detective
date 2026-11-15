import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { AI_VARIABLE_WORDS, aiEnabled, readQuestion, readingSentence, type AiReading } from './aiReader';
import { prefersReducedMotion } from '../map/wind/WindLayer';
import './detective.css';
import { loadCities, loadCountries, loadMask, pickCountry } from '../areas/country';
import {
  CLICK_BUTTON,
  HONESTY_NOTE,
  HONESTY_NOTE_NO_AI,
  OPENING,
  OPENING_HELP,
  THEMES,
  YEARS_TEXT,
  fitAskedPeriod,
  parsePeriod,
  themeFor,
  buildAnswer,
  countryPlace,
  lastSummary,
  lineChecks,
  matchPlace,
  placeHeader,
  spotHeader,
  themeHeader,
  triedText,
  type Answer,
  type NamedPlace,
  type PlaceIndex,
  type Theme,
} from './detectiveLogic';
import { formatLatLng } from '../data/format';
import { loadSeaMask, loadSeas, pickSea } from '../areas/sea';
import { loadRegions, regionRank, type RegionRec } from '../areas/regions';
import { areaLineChecks, loadAreaReference, type AreaRefData } from '../evaluation/referenceAreas';
import { loadSummary, rankAt, type RankResult, type Summary } from './whatsChanging';
import { loadReference, REFERENCE_VARIABLES, type RefData } from '../evaluation/reference';
import { loadQuality, qualityAt, type QualityData } from '../evaluation/qualityData';
import { BADGE_LABEL, type Grade, type QualityFlags, type VarQuality } from '../evaluation/quality';

declare global {
  interface Window {
    __detective?: {
      open: boolean;
      messages: number;
      last: { place: string; cell: { lat: number; lng: number } | null; region?: boolean; lines: { variable: string; slopePerDecade: number; p: number; kind: string; grade: Grade | null; flags: QualityFlags | null; reference?: string | null }[] } | null;
    };
    __askDetective?: (text: string) => void;
    /** How often the AI reader was asked in this visit, and its last reading (null: it did not answer). */
    __detectiveAi?: { asked: number; last: import('./aiReader').AiReading | null };
  }
}

/** The country or sea a "Lift" button opens (the existing country / sea overlay). */
export interface LiftTarget {
  kind: 'country' | 'sea';
  idx: number;
  name: string;
}

type Action =
  | { t: 'theme'; id: Theme['id'] }
  | { t: 'click' }
  | { t: 'ask'; text: string }
  | { t: 'lift'; target: LiftTarget }
  | { t: 'place'; place: NamedPlace }
  | { t: 'country'; name: string }
  | { t: 'another' }
  | { t: 'retry' };

interface Choice {
  label: string;
  action: Action;
}

interface Msg {
  id: number;
  from: 'bot' | 'user';
  text?: string;
  /** Second paragraph (e.g. "I read ... as ..."). */
  note?: string;
  answer?: Answer;
  choices?: Choice[];
  /** Label shown on the choices row ("Worth a look" buttons are inside the answer; this is for the follow-ups). */
  choicesLabel?: string;
}

export interface DetectiveProps {
  open: boolean;
  /** True while a side panel or the country overlay covers the globe: the Detective steps aside (state is kept). */
  hidden: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The variable currently on the map. */
  variable: string;
  /** Switch the map to a variable (the panel stays open). */
  onShowVariable: (v: string) => void;
  /** Fly the globe to a place and drop the marker there. With `altitude` (a continent or the world): fly there, no marker. */
  onFly: (lat: number, lng: number, altitude?: number) => void;
  /** Open the existing country / sea overlay. */
  onLift: (t: LiftTarget) => void;
  /** Set the period of the map and the country view (the years a question asked about). */
  onPeriod: (period: [number, number]) => void;
  /** The years the data covers. */
  fullYears: [number, number];
  /** Detective registers its globe-click handler here; App calls it instead of the normal click while the panel is open. */
  clickRef: MutableRefObject<((pos: { lat: number; lng: number }) => void) | null>;
}

/** The years a typed question asked about (see `stepsNote` and `openView` in the component). */
interface Steps {
  period: [number, number] | null;
  adjusted: boolean;
  /** The variable the question is about, as Gemini read it (null: none, or the reader was not used). */
  variable?: string | null;
  /** "Gemini read this as: ..." (null when the reader was not used or read nothing). */
  aiNote?: string | null;
}
/** The AI reader is on unless the address says `?ai=0`. */
const AI_ON = aiEnabled(typeof window === 'undefined' ? '' : window.location.search);
/** How long the globe takes to turn to a place before its view opens. */
const TURN_MS = 1500;

const themeChoices = (): Choice[] => [
  ...THEMES.map((t): Choice => ({ label: t.button, action: { t: 'theme', id: t.id } })),
  { label: CLICK_BUTTON, action: { t: 'click' } },
];

const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

let nextId = 1;
const mk = (m: Omit<Msg, 'id'>): Msg => ({ id: nextId++, ...m });

const openingMessage = (): Msg => mk({ from: 'bot', text: OPENING, note: OPENING_HELP, choices: themeChoices() });

type Status = 'idle' | 'loading' | 'ready' | 'error';

export default function Detective(p: DetectiveProps) {
  const [messages, setMessages] = useState<Msg[]>(() => [openingMessage()]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  /** True while the AI reader has the question. */
  const [reading, setReading] = useState(false);
  const [last, setLast] = useState<NonNullable<Window['__detective']>['last']>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const failedJob = useRef<(() => Promise<void>) | null>(null);
  const active = p.open && !p.hidden;

  const push = useCallback((m: Omit<Msg, 'id'>) => setMessages((list) => [...list, mk(m)]), []);

  // ---- loading the trends -------------------------------------------------------------------------------------------
  const startLoad = useCallback(() => {
    setStatus('loading');
    return loadSummary().then(
      () => {
        setStatus('ready');
        return true;
      },
      () => {
        setStatus('error');
        return false;
      },
    );
  }, []);
  const started = useRef(false);
  useEffect(() => {
    if (!p.open || started.current) return;
    started.current = true;
    void startLoad();
  }, [p.open, startLoad]);

  // ---- answering ----------------------------------------------------------------------------------------------------
  const enqueue = (job: () => Promise<void>) => {
    chain.current = chain.current.then(job).catch((err) => console.error(err));
  };

  /** Run one lookup that needs the trends; on failure say so and offer "Try again" (never invent numbers). */
  const withSummary = async (
    job: (
      rank: (lat: number, lng: number) => RankResult,
      summary: Summary,
      quality: (lat: number, lng: number) => Map<string, VarQuality> | undefined,
      refs: Map<string, RefData>,
    ) => Promise<void>,
    redo: () => Promise<void>,
  ) => {
    try {
      setStatus((s) => (s === 'ready' ? s : 'loading'));
      const summary = await loadSummary();
      setStatus('ready');
      // The quality flags are an addition: if they cannot be loaded the answer is still given, without grades.
      let qd: QualityData | null = null;
      try {
        qd = await loadQuality();
      } catch (err) {
        console.error(err);
      }
      // Likewise the independent records: without them the lines simply carry no check.
      const refs = new Map<string, RefData>();
      for (const v of REFERENCE_VARIABLES) {
        try {
          const r = await loadReference(v);
          if (r) refs.set(v, r);
        } catch (err) {
          console.error(err);
        }
      }
      await job((lat, lng) => rankAt(summary, lat, lng), summary, (lat, lng) => (qd ? qualityAt(qd, summary, lat, lng) : undefined), refs);
      failedJob.current = null;
    } catch (err) {
      console.error(err);
      setStatus('error');
      failedJob.current = redo;
      push({
        from: 'bot',
        text: "I couldn't load the trend data, so I can't give you numbers right now.",
        choices: [{ label: 'Try again', action: { t: 'retry' } }],
      });
    }
  };

  const reportAnswer = (placeName: string, rank: RankResult, answer: Answer, extra: Partial<Msg> = {}, region = false) => {
    push({ from: 'bot', answer, ...extra });
    setLast(lastSummary(placeName, rank, answer, region));
  };

  /**
   * What a typed question sets in motion, in this order: 1. the place is found, 2. the years it names are applied,
   * 3. the globe turns to the place, 4. its country (or sea) view opens. `steps` is null for buttons and globe clicks,
   * which only answer.
   */
  const liftTimer = useRef<number | null>(null);
  useEffect(() => () => { if (liftTimer.current !== null) window.clearTimeout(liftTimer.current); }, []);
  const applySteps = (steps: Steps | null) => {
    if (steps?.period) p.onPeriod(steps.period);
    if (steps?.variable && steps.variable !== p.variable) p.onShowVariable(steps.variable);
  };
  const openView = (steps: Steps | null, lift: LiftTarget | null) => {
    if (!steps || !lift) return;
    if (liftTimer.current !== null) window.clearTimeout(liftTimer.current);
    // After the globe has turned (the flight takes about a second); at once when motion is to be reduced.
    liftTimer.current = window.setTimeout(() => p.onLift(lift), prefersReducedMotion() ? 0 : TURN_MS);
  };
  const stepsNote = (steps: Steps | null, lift: LiftTarget | null, region = false): string | undefined => {
    if (!steps) return undefined;
    const parts: string[] = [];
    if (steps.aiNote) parts.push(steps.aiNote);
    if (steps.variable) parts.push(`The map now shows ${AI_VARIABLE_WORDS[steps.variable] ?? steps.variable}.`);
    if (steps.period) {
      parts.push(`I set the period to ${steps.period[0]}–${steps.period[1]}; the map and the country view now use it.`);
      if (steps.adjusted) parts.push(`That is the nearest I can do: at least ten years inside ${p.fullYears[0]}–${p.fullYears[1]}.`);
      parts.push(`The ranking below is for ${YEARS_TEXT}, the only years I have ready.`);
    }
    if (lift) parts.push(`I am turning the globe there and opening the view of ${lift.name}.`);
    else if (region) parts.push('I have turned the globe there. A continent has no view of its own: tap a country below to open one.');
    return parts.length ? parts.join(' ') : undefined;
  };
  const joinNotes = (...notes: (string | undefined)[]): string | undefined => notes.filter(Boolean).join(' ') || undefined;

  const followUps = (lift: LiftTarget | null): Choice[] => [
    ...(lift ? [{ label: `Lift ${lift.name}`, action: { t: 'lift', target: lift } as Action }] : []),
    { label: 'Another place', action: { t: 'another' } },
  ];

  /** The country or sea at a spot, for the header and the Lift button (null parts when the masks are unavailable). */
  const describeSpot = async (lat: number, lng: number): Promise<{ inside: string | null; lift: LiftTarget | null }> => {
    try {
      const [mask, countries] = await Promise.all([loadMask(), loadCountries()]);
      const ci = pickCountry(mask, countries, lat, lng);
      if (ci !== undefined) return { inside: `in ${countries[ci].name}`, lift: { kind: 'country', idx: ci, name: countries[ci].name } };
      const [smask, seas] = await Promise.all([loadSeaMask(), loadSeas()]);
      const sea = pickSea(smask, seas, lat, lng);
      if (sea) return { inside: `in the ${sea.name}`, lift: { kind: 'sea', idx: sea.idx, name: `the ${sea.name}` } };
    } catch (err) {
      console.error(err);
    }
    return { inside: null, lift: null };
  };

  const answerSpot = (lat: number, lng: number, preface?: string, steps: Steps | null = null) => {
    const lng0 = wrapLng(lng);
    const run = () =>
      withSummary(async (rank, _summary, quality, refs) => {
        const { inside, lift } = await describeSpot(lat, lng0);
        const r = rank(lat, lng0);
        const header = spotHeader(lat, lng0, inside);
        reportAnswer(formatLatLng({ lat, lng: lng0 }) + (inside ? ` ${inside}` : ''), r, buildAnswer(r, header, [], undefined, quality(r.cell.lat, r.cell.lng), lineChecks(r, refs)), {
          note: joinNotes(preface, stepsNote(steps, lift)),
          choices: followUps(lift),
        });
        openView(steps, lift);
      }, run);
    return run();
  };

  const placeLabel = (place: NamedPlace) => (place.kind === 'city' && place.country ? `${place.name}, ${place.country}` : place.name);

  /** "I read “europ” as Europe." and, when the text named several places, which one this answer is for. */
  const placeNote = (place: NamedPlace, read: string | null, others: NamedPlace[]): string | undefined => {
    const parts: string[] = [];
    if (read) parts.push(`I read “${read}” as ${placeLabel(place)}.`);
    if (others.length) parts.push(`You named more than one place, so this answer is for ${placeLabel(place)}, the first. Tap ${others.map(placeLabel).join(' or ')} to see that one.`);
    return parts.length ? parts.join(' ') : undefined;
  };
  const otherChoices = (others: NamedPlace[]): Choice[] => others.map((o): Choice => ({ label: placeLabel(o), action: { t: 'place', place: o } }));

  const answerPlace = (place: NamedPlace, read: string | null, others: NamedPlace[] = [], steps: Steps | null = null) => {
    const run = () =>
      withSummary(async (rank, _summary, quality, refs) => {
        const r = rank(place.lat, place.lng);
        const header = placeHeader(place, r.cellKm);
        const lift: LiftTarget | null =
          place.kind === 'sea' && place.seaIdx !== null
            ? { kind: 'sea', idx: place.seaIdx, name: place.name }
            : place.countryIdx !== null && place.country
              ? { kind: 'country', idx: place.countryIdx, name: place.country }
              : null;
        reportAnswer(placeLabel(place), r, buildAnswer(r, header, [], undefined, quality(r.cell.lat, r.cell.lng), lineChecks(r, refs)), {
          note: joinNotes(placeNote(place, read, others), stepsNote(steps, lift)),
          choices: [...otherChoices(others), ...followUps(lift)],
        });
        openView(steps, lift);
      }, run);
    return run();
  };

  /** A continent or the World: the pre-computed average over its land, and its most populous countries as follow-ups. */
  const answerRegion = (place: NamedPlace, read: string | null, others: NamedPlace[] = [], steps: Steps | null = null) => {
    const run = () =>
      withSummary(async (_rank, summary) => {
        const regions = await loadRegions();
        const rec: RegionRec | undefined = regions.find((g) => g.name === place.name);
        if (!rec) throw new Error(`regions.json has no ${place.name}`);
        const { rank, extras, qualities } = regionRank(rec, summary);
        // The independent check for the continent / World (without the files the lines simply carry no check).
        const areaRefs = new Map<string, AreaRefData>();
        for (const v of REFERENCE_VARIABLES) {
          try {
            const r = await loadAreaReference(v);
            if (r) areaRefs.set(v, r);
          } catch (err) {
            console.error(err);
          }
        }
        const header = placeHeader({ ...place, nCells: rec.nCells }, rank.cellKm);
        const countries: Choice[] = rec.topCountries.map((name): Choice => ({ label: name, action: { t: 'country', name } }));
        reportAnswer(
          rec.name,
          rank,
          buildAnswer(rank, header, [], extras, qualities, areaLineChecks(rank, areaRefs, 'regions', rec.name)),
          { note: joinNotes(placeNote(place, read, others), stepsNote(steps, null, true)), choices: [...otherChoices(others), ...countries, { label: 'Another place', action: { t: 'another' } }] },
          true,
        );
      }, run);
    return run();
  };

  /** Fly to a named place and answer for it. */
  const answerNamed = (place: NamedPlace, read: string | null, others: NamedPlace[] = [], steps: Steps | null = null) => {
    applySteps(steps);
    if (place.kind === 'region') {
      p.onFly(place.lat, place.lng, place.altitude);
      return answerRegion(place, read, others, steps);
    }
    p.onFly(place.lat, place.lng);
    return answerPlace(place, read, others, steps);
  };

  const answerTheme = (t: Theme, steps: Steps | null = null, read: string | null = null) => {
    const run = () =>
      withSummary(async (rank, _summary, quality, refs) => {
        const r = rank(t.lat, t.lng);
        const { lift } = await describeSpot(t.lat, t.lng);
        reportAnswer(t.place, r, buildAnswer(r, themeHeader(t, r.cellKm), t.suggest, undefined, quality(r.cell.lat, r.cell.lng), lineChecks(r, refs)), { note: joinNotes(read ?? undefined, stepsNote(steps, lift)), choices: followUps(lift) });
        openView(steps, lift);
      }, run);
    return run();
  };

  const loadIndex = async (): Promise<PlaceIndex> => {
    // Without regions.json the continents are simply unknown; cities, countries and seas still work.
    const [cities, countries, seas, regions] = await Promise.all([loadCities(), loadCountries(), loadSeas(), loadRegions().catch(() => undefined)]);
    return { cities, countries, seas, regions };
  };

  /** Free text: the same path for typing + Enter and for window.__askDetective. */
  const ask = (raw: string) => {
    const input = raw.trim();
    if (!input) return;
    push({ from: 'user', text: input });
    enqueue(async () => {
      let idx: PlaceIndex;
      try {
        idx = await loadIndex();
      } catch (err) {
        console.error(err);
        push({ from: 'bot', text: "I couldn't load my list of places. Please try again.", choices: [{ label: 'Try again', action: { t: 'ask', text: input } }] });
        return;
      }
      // My own word matching first: 1. the place, in the text without the words that name years; 2. the years.
      const asked = parsePeriod(input, p.fullYears);
      const text = asked.rest.trim() || input;
      const m = matchPlace(text, idx);
      const typedPoint = m.kind === 'point' || m.kind === 'bad-coordinates';
      // Then the AI reader (aiReader.ts): Gemini's reading of the same question. It only says WHAT is asked; a typed
      // latitude and longitude needs no reading. null when it is off, slow or refuses: my own matching then stands alone.
      let ai: AiReading | null = null;
      if (AI_ON && !typedPoint) {
        setReading(true);
        ai = await readQuestion(input);
        setReading(false);
      }
      window.__detectiveAi = { asked: (window.__detectiveAi?.asked ?? 0) + (AI_ON && !typedPoint ? 1 : 0), last: ai };
      let period = asked.period;
      let adjusted = asked.adjusted;
      if (!period && ai && (ai.start !== null || ai.end !== null)) {
        const f = fitAskedPeriod(ai.start ?? p.fullYears[0], ai.end ?? p.fullYears[1], p.fullYears);
        period = f.period;
        adjusted = f.adjusted;
      }
      const steps: Steps = { period, adjusted, variable: ai?.variable ?? null, aiNote: ai ? readingSentence(ai, period) : null };
      // Gemini's place, looked up in my own lists: only an exact name counts, never a guess on top of a guess.
      const am = ai?.place ? matchPlace(ai.place, idx) : null;
      const aiPlace = am && am.kind === 'place' && !am.read ? am.place : null;
      const exactPlace = (m.kind === 'place' && !m.read) || m.kind === 'choose';
      // A region a theme button stands for ("the Sahara", "the Amazon"), unless a listed place is named exactly.
      const hit = (ai?.place ? themeFor(ai.place) : null) ?? themeFor(text);
      if (m.kind === 'point') {
        applySteps(steps);
        p.onFly(m.lat, m.lng);
        await answerSpot(m.lat, m.lng, undefined, steps);
      } else if (m.kind === 'bad-coordinates') {
        push({ from: 'bot', text: 'Those coordinates are outside the globe: latitude must be between -90 and 90 and longitude between -180 and 180.', choices: themeChoices() });
      } else if (aiPlace) {
        await answerNamed(aiPlace, null, [], steps);
      } else if (hit && !hit.weak && !exactPlace) {
        applySteps(steps);
        p.onFly(hit.theme.lat, hit.theme.lng);
        await answerTheme(hit.theme, steps, hit.note);
      } else if (m.kind === 'place' && !m.read) {
        await answerNamed(m.place, null, m.others ?? [], steps);
      } else if (m.kind === 'choose') {
        push({
          from: 'bot',
          text: `Which ${m.phrase.replace(/^./, (c) => c.toUpperCase())} do you mean?`,
          choices: m.options.map((o): Choice => ({ label: placeLabel(o), action: { t: 'place', place: o } })),
        });
      } else if (ai && ai.place && ai.lat !== null && ai.lng !== null) {
        // A place Gemini knows and my lists do not (a desert, a mountain range): its position, and the trends there.
        applySteps(steps);
        p.onFly(ai.lat, ai.lng);
        await answerSpot(ai.lat, ai.lng, `“${ai.place}” is not in my lists, so I used the position Gemini gave for it.`, steps);
      } else if (m.kind === 'place') {
        await answerNamed(m.place, m.read ?? null, m.others ?? [], steps);
      } else if (hit) {
        applySteps(steps);
        p.onFly(hit.theme.lat, hit.theme.lng);
        await answerTheme(hit.theme, steps, hit.note);
      } else {
        push({
          from: 'bot',
          text: `I couldn't find a place in “${triedText(text)}”. I can look up cities, countries, continents, seas and oceans by name, or a latitude and longitude like 41.0, 28.9.`,
          choices: [...(m.kind === 'none' ? m.suggestions : []).map((s): Choice => ({ label: `Did you mean ${s}?`, action: { t: 'ask', text: s } })), ...themeChoices()],
        });
      }
    });
  };

  const onClick = (pos: { lat: number; lng: number }) => {
    const lng = wrapLng(pos.lng);
    push({ from: 'user', text: `Clicked the globe at ${formatLatLng({ lat: pos.lat, lng })}` });
    p.onFly(pos.lat, lng);
    enqueue(() => answerSpot(pos.lat, lng));
  };

  const runAction = (a: Action, label: string) => {
    switch (a.t) {
      case 'theme': {
        const t = THEMES.find((x) => x.id === a.id)!;
        push({ from: 'user', text: label });
        p.onFly(t.lat, t.lng);
        enqueue(() => answerTheme(t));
        break;
      }
      case 'click':
        push({ from: 'user', text: label });
        push({ from: 'bot', text: "Click anywhere on the globe and I'll tell you what's changing there. You can also type a place." });
        break;
      case 'ask':
        ask(a.text);
        break;
      case 'lift':
        p.onLift(a.target);
        break;
      case 'place': {
        const place = a.place;
        push({ from: 'user', text: label });
        enqueue(() => answerNamed(place, null));
        break;
      }
      case 'country': {
        const name = a.name;
        push({ from: 'user', text: label });
        enqueue(async () => {
          const rec = (await loadCountries()).find((r) => r.name === name);
          if (rec) await answerNamed(countryPlace(rec), null);
        });
        break;
      }
      case 'another':
        push({ from: 'user', text: label });
        setMessages((list) => [...list, openingMessage()]);
        break;
      case 'retry': {
        const job = failedJob.current;
        enqueue(async () => {
          const ok = await startLoad();
          if (!ok) {
            push({ from: 'bot', text: 'The trend data still did not load.', choices: [{ label: 'Try again', action: { t: 'retry' } }] });
          } else if (job) await job();
          else push({ from: 'bot', text: 'The trends are loaded.', choices: themeChoices() });
        });
        break;
      }
    }
  };

  // Always-current handlers for the window hooks and the globe click.
  const latest = useRef({ ask, onClick });
  latest.current = { ask, onClick };
  useEffect(() => {
    p.clickRef.current = active ? (pos) => latest.current.onClick(pos) : null;
    return () => {
      p.clickRef.current = null;
    };
  }, [active, p.clickRef]);
  useEffect(() => {
    window.__askDetective = (t) => {
      p.onOpen();
      latest.current.ask(t);
    };
    return () => {
      delete window.__askDetective;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    window.__detective = { open: active, messages: messages.length, last };
  }, [active, messages.length, last]);
  useEffect(
    () => () => {
      delete window.__detective;
    },
    [],
  );

  // Keep the newest message in view; focus the text box when the panel opens, give focus back when it closes.
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    // A long answer is shown from its first line (the header); anything shorter scrolls to the bottom.
    const lastMsg = el.lastElementChild as HTMLElement | null;
    if (lastMsg && lastMsg.offsetHeight > el.clientHeight - 8) el.scrollTop = lastMsg.offsetTop - el.offsetTop;
    else el.scrollTop = el.scrollHeight;
  }, [messages, status, active]);
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) inputRef.current?.focus();
    if (!active && wasActive.current && p.open === false) pillRef.current?.focus();
    wasActive.current = active;
  }, [active, p.open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text;
    setText('');
    ask(t);
  };

  if (p.hidden) return null;

  if (!p.open) {
    return (
      <button ref={pillRef} type="button" className="dt-pill" onClick={p.onOpen} aria-label="Open the Detective: ask what is changing at a place">
        Detective
      </button>
    );
  }

  return (
    <section
      className="dt-panel"
      role="region"
      aria-label="Detective"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          p.onClose();
        }
      }}
    >
      <header className="dt-head">
        <h2 className="dt-title">Detective</h2>
        <button type="button" className="dt-close" onClick={p.onClose} aria-label="Close the Detective">
          ×
        </button>
      </header>
      <div className="dt-log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation" tabIndex={0}>
        {messages.map((m) => (
          <div key={m.id} className={`dt-msg dt-${m.from}`}>
            {m.text && <p className="dt-text">{m.text}</p>}
            {m.note && <p className="dt-text dt-dim">{m.note}</p>}
            {m.answer && <AnswerView answer={m.answer} variable={p.variable} onShow={p.onShowVariable} />}
            {m.choices && (
              <div className="dt-choices" role="group" aria-label={m.choicesLabel ?? 'Suggestions'}>
                {m.choices.map((c) => (
                  <button key={c.label} type="button" className="dt-chip" onClick={() => runAction(c.action, c.label)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {reading && (
        <p className="dt-status" role="status">
          Gemini is reading your question…
        </p>
      )}
      {status === 'loading' && (
        <p className="dt-status" role="status">
          Loading the trends…
        </p>
      )}
      {status === 'error' && (
        <p className="dt-status dt-status-error" role="alert">
          The trend data did not load.{' '}
          <button type="button" className="dt-chip" onClick={() => runAction({ t: 'retry' }, 'Try again')}>
            Try again
          </button>
        </p>
      )}
      <form className="dt-form" onSubmit={submit}>
        <label className="dt-sr" htmlFor="dt-input">
          Type a city, a country, a continent or a sea
        </label>
        <input
          id="dt-input"
          ref={inputRef}
          className="dt-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a place or a question…"
          autoComplete="off"
          autoCapitalize="off"
          enterKeyHint="send"
        />
        <button type="submit" className="dt-send" disabled={!text.trim()}>
          Send
        </button>
      </form>
      <p className="dt-note">{AI_ON ? HONESTY_NOTE : HONESTY_NOTE_NO_AI}</p>
    </section>
  );
}

function AnswerView({ answer, variable, onShow }: { answer: Answer; variable: string; onShow: (v: string) => void }) {
  return (
    <div className="dt-answer">
      <p className="dt-text dt-answer-head">{answer.header}</p>
      {answer.lines.length > 0 && (
        <ul className="dt-lines">
          {answer.lines.map((l) => {
            // Keep a number and its unit on one line ("+0.34 °C").
            const rest = (l.text.startsWith(`${l.label}: `) ? l.text.slice(l.label.length + 2) : l.text).replace(/(\d) (°C|m\/s|mm\/day)/g, '$1\u00a0$2');
            return (
              <li key={l.variable} className={`dt-line dt-${l.kind}`}>
                <span className="dt-line-text">
                  <strong>{l.label}:</strong> {rest}
                  {l.grade && l.grade !== 'none' && l.grade !== 'unchecked' && (
                    <span className={`dt-grade grade-text-${l.grade}`}>{` · ${BADGE_LABEL[l.grade]}`}</span>
                  )}
                  {l.referenceTail && <span className="dt-confirmed">{l.referenceTail}</span>}
                  {l.reasons.map((r) => (
                    <span key={r} className="dt-line-extra dt-line-reason">
                      {r}
                    </span>
                  ))}
                  {l.extra && <span className="dt-line-extra">{l.extra}</span>}
                </span>
                <button
                  type="button"
                  className="dt-chip dt-show"
                  aria-pressed={variable === l.variable}
                  aria-label={`Show ${l.label} on the map`}
                  onClick={() => onShow(l.variable)}
                >
                  Show on map
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {answer.nothing && <p className="dt-text">{answer.nothing}</p>}
      {answer.noClear && <p className="dt-text dt-dim">{answer.noClear}</p>}
      {answer.noData && <p className="dt-text dt-dim">{answer.noData}</p>}
      {answer.suggestions.length > 0 && (
        <div className="dt-suggest">
          <span className="dt-text">Worth a look here:</span>
          {answer.suggestions.map((s) => (
            <button
              key={s.variable}
              type="button"
              className="dt-chip"
              aria-pressed={variable === s.variable}
              onClick={() => onShow(s.variable)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
