import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeArea, { hasWebGL } from './GlobeArea';
import { prefersReducedMotion } from './wind/WindLayer';
import type { LatLng, PointOfView } from './Globe';
import Picker from './Picker';
import Legend from './Legend';
import HowToRead from './HowToRead';
import { VARIABLES } from './demos';
import { LANDMARKS } from './landmarks';
import Panel, { type PanelState } from './Panel';
import CountryOverlay from './CountryOverlay';
import CountryPanel, { type CountryData, type CountryPanelState } from './CountryPanel';
import { useCountryTrends } from './useCountryTrends';
import { useProvinces, useProvinceTrends } from './useProvinces';
import {
  countryCells,
  countryMeanSeries,
  countryPolygons,
  findCountry,
  loadCities,
  loadCitySeries,
  loadCountries,
  loadCountrySeries,
  loadMask,
  loadOutlines,
  pickCountry,
  type CountryRec,
} from './country';
import { splitLines, type LngLat } from './coastlines';
import type { CityTrend } from './CountryMap';
import { analyze } from './analysis';
import { fetchPointSeries, fetchRegionSeries, snapToCell, type PointSeries } from './power';
import { areaMeanSeries, regionBox, type RegionBox, type RegionData } from './region';
import DetailMap from './DetailMap';
import { POINT_DETAIL_SIZE, areaChangeAltitude, cellTrends, pickAltitude, summarize, type DetailCell } from './detail';
import { landmarksTextureUrl, loadMeta, type VariableMeta } from './data';
import PeriodBar from './PeriodBar';
import { useRangeMap } from './useRangeMap';
import { FULL_PERIOD, clampPeriod, isFullPeriod, periodText, type Period } from './period';

const DEFAULT_VARIABLE = VARIABLES[0];

declare global {
  interface Window {
    __lastResult?: {
      variable: string;
      cell: { lat: number; lng: number; i: number; j: number };
      slopeDecade: number;
      ciLowDecade: number;
      ciHighDecade: number;
      p: number;
      verdict: string;
      nYears: number;
      area:
        | {
            sizeDeg: number;
            latMin: number;
            latMax: number;
            lngMin: number;
            lngMax: number;
            nCells: number;
            cells: [number, number][];
          }
        | { sizeDeg: 'country'; country: { idx: number; name: string; nCells: number; tiny: boolean } };
      annual: number[];
      years: number[];
      period: [number, number];
    };
    __countryOverlay?: { open: boolean };
    __provinces?: {
      status: 'none' | 'loading' | 'ready';
      countryIdx: number | null;
      list: { name: string; nCells: number; cells: [number, number][]; slopeDecade: number | null; p: number | null }[];
    };
    __setArea?: (sizeDeg: number | 'country') => void;
    __pickCountry?: (nameOrIdx: string | number) => void;
    __country?: {
      status: 'idle' | 'loading' | 'computing' | 'ready' | 'error';
      idx: number | null;
      name: string | null;
      nCells: number;
      tiny: boolean;
      period: [number, number];
      vmax: number;
      nSignificant: number;
      cells: { lat: number; lng: number; slopeDecade: number | null; p: number | null }[];
      cities: { id: number; name: string; lat: number; lng: number; slopeDecade: number | null; p: number | null }[];
    };
    __pickAt?: (lat: number, lng: number) => void;
    __setVariable?: (name: string) => void;
    __setPeriod?: (startYear: number, endYear: number) => void;
    __detail?: {
      status: 'idle' | 'loading' | 'ready' | 'error';
      sizeDeg: number;
      period: [number, number];
      vmax: number;
      nCells: number;
      nSignificant: number;
      cells: { lat: number; lng: number; slopeDecade: number | null; p: number | null; n: number }[];
    };
  }
}

/** Where the close-up map's cells come from. */
type DetailState =
  | { status: 'idle' }
  | { status: 'loading'; sizeDeg: number }
  | { status: 'error'; sizeDeg: number; message: string }
  | { status: 'ready'; sizeDeg: number; box: RegionBox; data: RegionData };

const DEFAULT_VIEW: PointOfView = { lat: 30, lng: 20, altitude: 2.2 };

function parseNum(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function App() {
  const { debugLandmarks, initialView, forceFlat } = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const view: PointOfView = {
      lat: parseNum(q.get('lat')) ?? DEFAULT_VIEW.lat,
      lng: parseNum(q.get('lng')) ?? DEFAULT_VIEW.lng,
      altitude: parseNum(q.get('alt')) ?? DEFAULT_VIEW.altitude,
    };
    return { debugLandmarks: q.get('debug') === 'landmarks', initialView: view, forceFlat: q.get('flat') === '1' };
  }, []);

  useEffect(() => {
    document.title = 'Trend Detective — Earth system trends 1981–2025';
  }, []);

  const [metas, setMetas] = useState<Record<string, VariableMeta>>({});
  const [variable, setVariableState] = useState<string>(DEFAULT_VARIABLE);
  const [sizeDeg, setSizeDegState] = useState<number>(0);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [mapLines, setMapLines] = useState(true);
  const [period, setPeriodState] = useState<Period>(FULL_PERIOD);
  const [mapPeriod, setMapPeriod] = useState<Period>(FULL_PERIOD);
  const [detail, setDetail] = useState<DetailState>({ status: 'idle' });
  const [windOn, setWindOn] = useState(() => !prefersReducedMotion());
  // Country view: Area = Country is a mode on top of the numeric sizes; the country panel replaces the point panel.
  const [countryPanel, setCountryPanelState] = useState<CountryPanelState | null>(null);
  const [outlines, setOutlines] = useState<number[][][][][] | null>(null);
  const [outlineError, setOutlineError] = useState(false);
  const [spotCountry, setSpotCountry] = useState<{ key: string; rec: CountryRec | null } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const flyRef = useRef<((v: PointOfView) => void) | null>(null);
  const metasRef = useRef(metas);
  metasRef.current = metas;
  const variableRef = useRef<string>(DEFAULT_VARIABLE);
  const sizeRef = useRef<number>(0);
  const countryModeRef = useRef(false);
  /** A plain click on land lifts the country (default). Off once the user explicitly chooses Point or a box. */
  const liftRef = useRef(true);
  const countryPanelRef = useRef<CountryPanelState | null>(null);
  const countryPosRef = useRef<LatLng | null>(null);
  const countryDataRef = useRef<CountryData | null>(null);
  const countryTokenRef = useRef(0);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const periodRef = useRef<Period>(FULL_PERIOD);
  const commitTimer = useRef<number | undefined>(undefined);
  /** The fetched series of the open panel, so a period change recomputes without a new request. */
  const fetchedRef = useRef<{
    base: Omit<Extract<PanelState, { status: 'loading' }>, 'status'>;
    series: PointSeries;
    cells: [number, number][];
    variable: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(VARIABLES.map((v) => loadMeta(v)))
      .then((list) => {
        if (!alive) return;
        const rec: Record<string, VariableMeta> = {};
        list.forEach((m) => (rec[m.variable] = m));
        setMetas(rec);
      })
      .catch((err) => console.error(err));
    return () => {
      alive = false;
    };
  }, []);

  /** Statistics + panel + __lastResult for the given period, from an already-fetched series. */
  const showResult = (
    base: Omit<Extract<PanelState, { status: 'loading' }>, 'status'>,
    series: PointSeries,
    cells: [number, number][],
    v: string,
    per: Period,
  ) => {
    const a = analyze(series, per);
    if (!a) {
      const nYears = series.annual.filter((x, k) => !Number.isNaN(x) && series.years[k] >= per[0] && series.years[k] <= per[1]).length;
      setPanel({ ...base, status: 'insufficient', nYears, nCells: cells.length });
      return;
    }
    const { cell, box, sizeDeg: size } = base;
    window.__lastResult = {
      variable: v,
      cell,
      slopeDecade: a.slopeDecade,
      ciLowDecade: a.ciLowDecade,
      ciHighDecade: a.ciHighDecade,
      p: a.p,
      verdict: a.verdict,
      nYears: a.nYears,
      area: {
        sizeDeg: size,
        latMin: box ? box.latMin : cell.lat,
        latMax: box ? box.latMax : cell.lat,
        lngMin: box ? box.lngMin : cell.lng,
        lngMax: box ? box.lngMax : cell.lng,
        nCells: cells.length,
        cells,
      },
      annual: a.annual,
      years: a.years,
      period: [per[0], per[1]],
    };
    setPanel({ ...base, status: 'ready', analysis: a, nCells: cells.length });
  };

  const load = (center: LatLng, v: string, size: number) => {
    const m = metasRef.current[v];
    if (!m) return;
    abortRef.current?.abort();
    detailAbortRef.current?.abort();
    clearCountry();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const cell = snapToCell(center.lat, center.lng, m.grid);
    const box: RegionBox | null = size > 0 ? regionBox(center.lat, center.lng, size) : null;
    const base = { cell, center: { lat: center.lat, lng: center.lng }, sizeDeg: size, box };
    fetchedRef.current = null;
    setPanel({ ...base, status: 'loading' });
    setDetail(box ? { status: 'loading', sizeDeg: size } : { status: 'idle' });
    const request: Promise<{ series: PointSeries; cells: [number, number][]; region?: RegionData }> = box
      ? fetchRegionSeries(v, box, ctrl.signal, m.years).then((data) => {
          const mean = areaMeanSeries(data);
          return { series: mean.series, cells: mean.cells.map((c): [number, number] => [c.lat, c.lng]), region: data };
        })
      : fetchPointSeries(v, cell.lat, cell.lng, ctrl.signal, m.years).then((series) => ({
          series,
          cells: [[cell.lat, cell.lng]] as [number, number][],
        }));
    request
      .then(({ series, cells, region }) => {
        if (ctrl.signal.aborted) return;
        fetchedRef.current = { base, series, cells, variable: v };
        showResult(base, series, cells, v, periodRef.current);
        if (region && box) setDetail({ status: 'ready', sizeDeg: size, box, data: region });
        else loadDetail(center, v);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Something went wrong fetching data.';
        setPanel({ ...base, status: 'error', message });
        setDetail({ status: 'idle' });
      });
  };

  // ---- country view ---------------------------------------------------------------------------------------------

  const setCountryMode = (on: boolean) => {
    countryModeRef.current = on;
  };
  const setCountryPanel = (p: CountryPanelState | null) => {
    countryPanelRef.current = p;
    setCountryPanelState(p);
  };
  /** Drop the country panel and cancel anything still loading for it. */
  function clearCountry() {
    countryTokenRef.current++;
    countryDataRef.current = null;
    if (countryPanelRef.current) setCountryPanel(null);
  }

  /** Statistics + panel + __lastResult for a loaded country, for the given period (no network). */
  const showCountry = (data: CountryData, per: Period) => {
    const m = metasRef.current[data.variable];
    if (!m) return;
    const mean = countryMeanSeries(data.cells, data.values);
    const series: PointSeries = { years: data.years, annual: mean.annual, monthlyT: [], monthly: [], units: m.units };
    const a = analyze(series, per);
    if (!a) {
      const nYears = series.annual.filter((x, k) => !Number.isNaN(x) && series.years[k] >= per[0] && series.years[k] <= per[1]).length;
      setCountryPanel({ status: 'ready', data, analysis: null, nYears, nCellsUsed: mean.nUsed });
      return;
    }
    const { rec } = data;
    window.__lastResult = {
      variable: data.variable,
      cell: snapToCell(rec.centre[0], rec.centre[1], m.grid),
      slopeDecade: a.slopeDecade,
      ciLowDecade: a.ciLowDecade,
      ciHighDecade: a.ciHighDecade,
      p: a.p,
      verdict: a.verdict,
      nYears: a.nYears,
      area: { sizeDeg: 'country', country: { idx: rec.idx, name: rec.name, nCells: rec.nCells, tiny: rec.tiny } },
      annual: a.annual,
      years: a.years,
      period: [per[0], per[1]],
    };
    setCountryPanel({ status: 'ready', data, analysis: a, nYears: a.nYears, nCellsUsed: mean.nUsed });
  };

  /** Show one country (Area = Country): load its static files, recentre the camera, compute the panel. */
  const selectCountry = (rec: CountryRec, pos: LatLng, v: string = variableRef.current) => {
    const m = metasRef.current[v];
    if (!m) return;
    abortRef.current?.abort();
    detailAbortRef.current?.abort();
    fetchedRef.current = null;
    setDetail({ status: 'idle' });
    setPanel(null);
    setCountryMode(true);
    countryPosRef.current = pos;
    const token = ++countryTokenRef.current;
    countryDataRef.current = null;
    setCountryPanel({ status: 'loading', rec });
    const alt = window.__view?.().altitude;
    if (alt !== undefined) flyTo({ lat: rec.centre[0], lng: rec.centre[1] }, alt);
    const nYears = m.years[1] - m.years[0] + 1;
    const years = Array.from({ length: nYears }, (_, k) => m.years[0] + k);
    Promise.all([loadMask(), loadCities(), loadCountrySeries(v, rec.idx, nYears), loadCitySeries(v, nYears)])
      .then(([mask, allCities, values, cityAll]) => {
        if (token !== countryTokenRef.current) return;
        const cities = allCities.filter((c) => c.country === rec.idx);
        const data: CountryData = {
          rec,
          variable: v,
          years,
          cells: countryCells(mask, rec),
          values,
          cities,
          cityValues: cities.map((c) => cityAll[c.id]),
        };
        countryDataRef.current = data;
        showCountry(data, periodRef.current);
      })
      .catch((err: unknown) => {
        if (token !== countryTokenRef.current) return;
        const message = err instanceof Error ? err.message : 'Could not load the country data.';
        setCountryPanel({ status: 'error', rec, message });
      });
  };

  /** A click (or Area change) while Area = Country: the country under the position, or the water message. */
  const pickCountryAt = (pos: LatLng) => {
    const token = ++countryTokenRef.current;
    countryPosRef.current = pos;
    Promise.all([loadMask(), loadCountries()])
      .then(([mask, recs]) => {
        if (token !== countryTokenRef.current) return;
        const idx = pickCountry(mask, recs, pos.lat, pos.lng);
        if (idx === undefined) {
          abortRef.current?.abort();
          detailAbortRef.current?.abort();
          fetchedRef.current = null;
          countryDataRef.current = null;
          setDetail({ status: 'idle' });
          // Open water: there is no country to lift, so show the ordinary point (or box) result for the spot.
          setCountryMode(false);
          flyTo(pos, pickAltitude(window.__view?.().altitude, sizeRef.current));
          load(pos, variableRef.current, sizeRef.current);
          return;
        }
        selectCountry(recs[idx], pos);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Could not load the country data.';
        console.error(message);
      });
  };

  const selectCountryArea = () => {
    liftRef.current = true;
    setCountryMode(true);
    const p = panelRef.current;
    if (p) pickCountryAt(p.center);
  };

  /** window.__pickCountry: the same selection as a click inside that country with Area = Country. */
  const pickCountryByName = (nameOrIdx: string | number) => {
    setCountryMode(true);
    loadCountries()
      .then((recs) => {
        const rec = findCountry(recs, nameOrIdx);
        if (!rec) {
          console.warn(`No country matches ${String(nameOrIdx)}`);
          return;
        }
        selectCountry(rec, { lat: rec.centre[0], lng: rec.centre[1] });
      })
      .catch((err) => console.error(err));
  };

  /** Point selection: fetch the 5-degree box around the click for the close-up map (after the point result is shown). */
  const loadDetail = (center: LatLng, v: string) => {
    const m = metasRef.current[v];
    if (!m) return;
    detailAbortRef.current?.abort();
    const ctrl = new AbortController();
    detailAbortRef.current = ctrl;
    const box = regionBox(center.lat, center.lng, POINT_DETAIL_SIZE);
    setDetail({ status: 'loading', sizeDeg: POINT_DETAIL_SIZE });
    fetchRegionSeries(v, box, ctrl.signal, m.years)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setDetail({ status: 'ready', sizeDeg: POINT_DETAIL_SIZE, box, data });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'Could not load the close-up.';
        setDetail({ status: 'error', sizeDeg: POINT_DETAIL_SIZE, message });
      });
  };

  /** Fly the camera to a picked spot (no-op in flat mode). `alt` overrides the pick rule. */
  const flyTo = (pos: LatLng, alt: number) => {
    flyRef.current?.({ lat: pos.lat, lng: pos.lng, altitude: alt });
  };

  const handlePick = (pos: LatLng, forcePoint = false) => {
    window.__lastPick = { lat: pos.lat, lng: pos.lng };
    if (!forcePoint && (countryModeRef.current || liftRef.current)) {
      setCountryMode(true);
      pickCountryAt(pos);
      return;
    }
    flyTo(pos, pickAltitude(window.__view?.().altitude, sizeRef.current));
    load(pos, variableRef.current, sizeRef.current);
  };

  /** Change the area size (0 = single grid cell); if the panel is open, re-run for the same centre. */
  const selectArea = (size: number) => {
    if (![0, 2, 5, 10].includes(size)) return;
    const old = sizeRef.current;
    const wasCountry = countryModeRef.current;
    setCountryMode(false);
    sizeRef.current = size;
    setSizeDegState(size);
    const cp = countryPanelRef.current;
    const cpos = countryPosRef.current;
    if (wasCountry && cp) {
      // Country -> Point or box: back to the spot that was clicked (the country panel closes in load()).
      countryTokenRef.current++;
      if (cp && cpos) {
        flyTo(cpos, pickAltitude(window.__view?.().altitude, size));
        load(cpos, variableRef.current, size);
      }
      return;
    }
    const p = panelRef.current;
    if (p) {
      flyTo(p.center, areaChangeAltitude(window.__view?.().altitude, old, size));
      load(p.center, variableRef.current, size);
    }
  };

  /** Switch variable; if the panel is open, refetch the same cell for the new variable. */
  const selectVariable = (v: string, reload: boolean) => {
    if (!(VARIABLES as readonly string[]).includes(v)) return;
    variableRef.current = v;
    setVariableState(v);
    const p = panelRef.current;
    if (reload && p) load(p.center, v, sizeRef.current);
    const cp = countryPanelRef.current;
    if (reload && cp && cp.status !== 'water' && countryPosRef.current) {
      selectCountry(cp.status === 'ready' ? cp.data.rec : cp.rec, countryPosRef.current, v);
    }
  };

  /** Live period change (sliders while dragging): numbers and side panel update at once, from the fetched series. */
  const changePeriod = (p: Period) => {
    if (p[0] === periodRef.current[0] && p[1] === periodRef.current[1]) return;
    periodRef.current = p;
    setPeriodState(p);
    const f = fetchedRef.current;
    if (f && panelRef.current && (panelRef.current.status === 'ready' || panelRef.current.status === 'insufficient')) {
      showResult(f.base, f.series, f.cells, f.variable, p);
    }
    const cd = countryDataRef.current;
    if (cd && countryPanelRef.current?.status === 'ready') showCountry(cd, p);
  };

  /** Slider released (or programmatic): recompute the map for the current period, debounced. */
  const commitPeriod = (immediate = false) => {
    window.clearTimeout(commitTimer.current);
    const go = () => setMapPeriod([periodRef.current[0], periodRef.current[1]]);
    if (immediate) go();
    else commitTimer.current = window.setTimeout(go, 150);
  };

  const setPeriod = (start: number, end: number) => {
    changePeriod(clampPeriod(start, end, 'both'));
    commitPeriod(true);
  };

  const resetPeriod = () => {
    changePeriod(FULL_PERIOD);
    commitPeriod(true);
  };

  /** The user explicitly chose Point or a box in the Area row: clicks stop lifting countries until "Country" is chosen. */
  const chooseArea = (size: number) => {
    liftRef.current = false;
    selectArea(size);
  };

  // Always-current handlers so the window hooks run exactly the UI code paths.
  const handlersRef = useRef({ handlePick, selectVariable, selectArea, chooseArea, setPeriod, selectCountryArea, pickCountryByName });
  handlersRef.current = { handlePick, selectVariable, selectArea, chooseArea, setPeriod, selectCountryArea, pickCountryByName };
  useEffect(() => {
    window.__pickAt = (lat, lng) => handlersRef.current.handlePick({ lat, lng });
    window.__setVariable = (name) => handlersRef.current.selectVariable(name, true);
    window.__setArea = (n) => (n === 'country' ? handlersRef.current.selectCountryArea() : handlersRef.current.chooseArea(n));
    window.__pickCountry = (x) => handlersRef.current.pickCountryByName(x);
    window.__setPeriod = (s, e) => handlersRef.current.setPeriod(s, e);
    return () => {
      delete window.__pickAt;
      delete window.__setVariable;
      delete window.__setArea;
      delete window.__pickCountry;
      delete window.__setPeriod;
    };
  }, []);

  /** A cell clicked in the close-up map: same path as a globe click at its centre, with Area switched to Point. */
  const selectDetailCell = (lat: number, lng: number) => {
    setCountryMode(false);
    sizeRef.current = 0;
    setSizeDegState(0);
    handlePick({ lat, lng }, true);
  };

  const closePanel = () => {
    abortRef.current?.abort();
    detailAbortRef.current?.abort();
    setDetail({ status: 'idle' });
    fetchedRef.current = null;
    clearCountry();
    setPanel(null);
  };

  const meta = metas[variable] ?? null;
  const fullYears: Period = meta ? [meta.years[0], meta.years[1]] : FULL_PERIOD;
  const subtitle = meta ? `How has ${meta.label.toLowerCase()} changed, ${periodText(period)}?` : '';
  const isFull = isFullPeriod(period, fullYears);
  const range = useRangeMap(variable, mapPeriod, meta);

  const detailVmax = range.shown.vmax;
  const detailCells = useMemo<DetailCell[]>(
    () => (detail.status === 'ready' ? cellTrends(detail.data.cells, detail.data.years, period) : []),
    [detail, period],
  );
  useEffect(() => {
    const sum = summarize(detailCells);
    window.__detail = {
      status: detail.status,
      sizeDeg: detail.status === 'idle' ? 0 : detail.sizeDeg,
      period: [period[0], period[1]],
      vmax: detailVmax,
      nCells: sum.nCells,
      nSignificant: sum.nSignificant,
      cells: detailCells.map((c) => ({ lat: c.lat, lng: c.lng, slopeDecade: c.slopeDecade, p: c.p, n: c.n })),
    };
  }, [detail, detailCells, period, detailVmax]);
  useEffect(
    () => () => {
      delete window.__detail;
    },
    [],
  );

  // ---- country view: derived data and window hook ----
  const countryData = countryPanel?.status === 'ready' ? countryPanel.data : null;
  const { trends: countryTrends } = useCountryTrends(countryData, period);
  const selectedRec: CountryRec | null =
    countryPanel && countryPanel.status !== 'water' ? (countryPanel.status === 'ready' ? countryPanel.data.rec : countryPanel.rec) : null;

  const provinceFile = useProvinces(selectedRec ? selectedRec.idx : null);
  const provinceList = useProvinceTrends(provinceFile.list, countryData, period);
  useEffect(() => {
    const status = provinceFile.status === 'ready' && !provinceList ? 'loading' : provinceFile.status;
    window.__provinces = {
      status,
      countryIdx: selectedRec ? selectedRec.idx : null,
      list: provinceList
        ? provinceList.map((pv) => ({
            name: pv.name,
            nCells: pv.nCells,
            cells: pv.cells.filter((k) => k < (countryData?.cells.length ?? 0)).map((k) => [...(countryData as CountryData).cells[k]] as [number, number]),
            slopeDecade: pv.slopeDecade,
            p: pv.p,
          }))
        : [],
    };
  }, [provinceFile.status, provinceList, selectedRec, countryData]);
  useEffect(
    () => () => {
      delete window.__provinces;
    },
    [],
  );

  // Outlines (a separate lazy chunk) once a country is shown.
  useEffect(() => {
    if (!selectedRec || outlines) return;
    let alive = true;
    loadOutlines()
      .then((o) => alive && setOutlines(o))
      .catch((err) => {
        console.error('Country outlines unavailable', err);
        if (alive) setOutlineError(true);
      });
    return () => {
      alive = false;
    };
  }, [selectedRec, outlines]);

  const rawOutline = selectedRec && outlines ? outlines[selectedRec.idx] ?? null : null;
  const countryPolys = useMemo(
    () => (selectedRec && rawOutline ? countryPolygons(rawOutline, !!selectedRec.wraps, selectedRec.centre[1]) : null),
    [selectedRec, rawOutline],
  );
  const globeOutline = useMemo<LngLat[][] | null>(
    () => (rawOutline ? splitLines(rawOutline.flatMap((poly) => poly as LngLat[][])) : null),
    [rawOutline],
  );

  useEffect(() => {
    const sum = countryTrends ? summarize(countryTrends.cells) : null;
    let status: NonNullable<Window['__country']>['status'] = 'idle';
    if (countryPanel?.status === 'loading') status = 'loading';
    else if (countryPanel?.status === 'error') status = 'error';
    else if (countryPanel?.status === 'ready') status = countryTrends ? 'ready' : 'computing';
    window.__country = {
      status,
      idx: selectedRec ? selectedRec.idx : null,
      name: selectedRec ? selectedRec.name : null,
      nCells: selectedRec ? selectedRec.nCells : 0,
      tiny: selectedRec ? selectedRec.tiny : false,
      period: [period[0], period[1]],
      vmax: detailVmax,
      nSignificant: sum ? sum.nSignificant : 0,
      cells: countryTrends ? countryTrends.cells.map((c) => ({ lat: c.lat, lng: c.lng, slopeDecade: c.slopeDecade, p: c.p })) : [],
      cities: countryTrends
        ? countryTrends.cities.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, slopeDecade: c.slopeDecade, p: c.p }))
        : [],
    };
  }, [countryPanel, countryTrends, selectedRec, period, detailVmax]);
  useEffect(
    () => () => {
      delete window.__country;
    },
    [],
  );

  // "This spot is in X" line in the Point / box panel.
  const spotKey = panel ? `${panel.center.lat},${panel.center.lng}` : null;
  useEffect(() => {
    if (!panel || !spotKey) return;
    if (spotCountry?.key === spotKey) return;
    let alive = true;
    Promise.all([loadMask(), loadCountries()])
      .then(([mask, recs]) => {
        const idx = pickCountry(mask, recs, panel.center.lat, panel.center.lng);
        if (alive) setSpotCountry({ key: spotKey, rec: idx === undefined ? null : recs[idx] });
      })
      .catch(() => alive && setSpotCountry({ key: spotKey, rec: null }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotKey]);
  const inCountry = panel && spotCountry && spotCountry.key === spotKey ? spotCountry.rec : null;

  // A picked country opens the full-screen overlay; only the water-click message stays in the side panel.
  const overlayState = countryPanel && countryPanel.status !== 'water' && meta ? countryPanel : null;
  const overlayOpen = overlayState !== null;
  const waterPanel = countryPanel?.status === 'water';
  useEffect(() => {
    window.__countryOverlay = { open: overlayOpen };
  }, [overlayOpen]);
  useEffect(
    () => () => {
      delete window.__countryOverlay;
    },
    [],
  );

  const windAvailable = variable === 'WS2M' && !forceFlat && hasWebGL();

  const textureUrl =
    debugLandmarks && !range.shown.recomputed ? landmarksTextureUrl(variable) : range.textureUrl;
  const recomputing = range.status === 'loading' || range.status === 'computing' ? range.progress : null;

  return (
    <div className="app">
      <header className="header">
        <h1>Trend Detective</h1>
        <p className="subtitle">{subtitle}</p>
        <button className="howto-btn" onClick={() => setShowHelp(true)}>
          How to read this
        </button>
      </header>
      <main className={`globe-wrap${panel || waterPanel ? ' has-panel' : ''}${overlayOpen ? ' country-open' : ''}`}>
        <div className="globe-area">
          <GlobeArea
            forceFlat={forceFlat}
            textureUrl={textureUrl}
            initialView={initialView}
            onPick={handlePick}
            landmarks={debugLandmarks ? LANDMARKS : undefined}
            marker={panel ? { lat: panel.cell.lat, lng: panel.cell.lng } : null}
            box={panel?.box ?? null}
            countryOutline={globeOutline}
            flyRef={flyRef}
            wind={windAvailable && windOn}
            mapLines={mapLines}
          />
          <div className="overlay-tl">
            <Picker metas={metas} value={variable} onChange={(v) => selectVariable(v, true)} />
          </div>
          {meta && (
            <Legend
              meta={meta}
              wind={windAvailable ? { on: windOn, onChange: setWindOn } : undefined}
              mapLines={{ on: mapLines, onChange: setMapLines }}
              shown={range.shown}
            />
          )}
          {meta && !overlayOpen && (
            <PeriodBar
              period={period}
              full={fullYears}
              onChange={changePeriod}
              onCommit={() => commitPeriod()}
              onReset={resetPeriod}
              recomputing={recomputing}
              failed={range.status === 'error'}
            />
          )}
        </div>
        {waterPanel && meta && (
          <CountryPanel
            label={meta.label}
            sizeDeg={sizeDeg}
            onAreaChange={chooseArea}
            onCountryArea={selectCountryArea}
            onClose={closePanel}
          />
        )}
        {overlayState && meta && (
          <CountryOverlay
            state={overlayState}
            meta={meta}
            metas={metas}
            variable={variable}
            onVariable={(v) => selectVariable(v, true)}
            period={period}
            fullYears={fullYears}
            fullPeriod={isFull}
            onPeriodChange={changePeriod}
            onPeriodCommit={() => commitPeriod()}
            onPeriodReset={resetPeriod}
            recomputing={recomputing}
            mapFailed={range.status === 'error'}
            onClose={closePanel}
            onRetry={() => selectedRec && selectCountry(selectedRec, countryPosRef.current ?? { lat: selectedRec.centre[0], lng: selectedRec.centre[1] })}
            trends={countryTrends}
            provinces={provinceList}
            polys={countryPolys}
            outlineError={outlineError}
            wrapRef={selectedRec?.wraps ? selectedRec.centre[1] : null}
            vmax={detailVmax}
            onSelectCell={selectDetailCell}
            onSelectCity={(c: CityTrend) => selectDetailCell(c.lat, c.lng)}
          />
        )}
        {panel && meta && (
          <Panel
            state={panel}
            label={meta.label}
            yearsText={String(meta.years[1] - meta.years[0] + 1)}
            onClose={closePanel}
            sizeDeg={sizeDeg}
            onAreaChange={chooseArea}
            onCountryArea={selectCountryArea}
            inCountry={inCountry ? { name: inCountry.name, onShow: () => selectCountry(inCountry, panel.center) } : null}
            onRetry={() => load(panel.center, variable, sizeDeg)}
            period={period}
            fullPeriod={isFull}
            detail={
              panel.status === 'ready' || panel.status === 'insufficient' ? (
                <section className="detail" aria-label="Close-up map">
                  <h3 className="detail-title">Close-up: each ~50 km grid cell around this spot</h3>
                  {detail.status === 'loading' && <p className="panel-msg detail-msg">Loading close-up…</p>}
                  {detail.status === 'error' && (
                    <div className="panel-msg panel-error detail-msg">
                      <p>{detail.message}</p>
                      <button className="retry" onClick={() => loadDetail(panel.center, variable)}>
                        Try again
                      </button>
                    </div>
                  )}
                  {detail.status === 'ready' && (
                    <DetailMap
                      meta={meta}
                      box={detail.box}
                      cells={detailCells}
                      vmax={detailVmax}
                      center={panel.center}
                      selected={panel.box ? null : { lat: panel.cell.lat, lng: panel.cell.lng }}
                      onSelectCell={selectDetailCell}
                    />
                  )}
                </section>
              ) : null
            }
          />
        )}
      </main>
      <footer className="footer">
        Data: NASA POWER / MERRA-2 (NASA Langley Research Center). Not affiliated with or endorsed by NASA.
      </footer>
      {showHelp && <HowToRead onClose={() => setShowHelp(false)} />}
    </div>
  );
}
