/**
 * issue 154：对 docs/resource/StressTestChart 做静态盘点 + 当前导入闸门实测。
 *
 *   npx vite-node scripts/analyze-stress-test-charts.ts
 *
 * 写出（本地生成，不进仓库）：
 *   .cache/chart-compatibility-stress-corpus-results.json
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBpmEvents, maxNoteEndSeconds } from '../src/audio/AudioTiming';
import {
  convertChartCodeToNotes,
  convertNotesToChartCode,
  hasBeat0Bpm,
  validateChartCodeJSON,
  type ChartCodeNote,
} from '../src/chart/editing/ChartConverter';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(REPO_ROOT, 'docs/resource/StressTestChart');
const OUT = path.join(REPO_ROOT, '.cache/chart-compatibility-stress-corpus-results.json');

const TOP_KNOWN: Record<string, Set<string>> = {
  BPM: new Set(['beat', 'bpm', 'type']),
  Single: new Set(['beat', 'lane', 'type', 'flick', 'skill']),
  Directional: new Set(['beat', 'lane', 'type', 'direction', 'width', 'flick', 'skill']),
  Slide: new Set(['type', 'connections']),
  Long: new Set(['type', 'connections']),
  System: new Set(['type', 'data']),
};
const CONN_KNOWN = new Set(['beat', 'lane', 'hidden', 'flick', 'skill']);

type Kind = 'official' | 'community';

type FileStats = {
  path: string;
  kind: Kind;
  bytes: number;
  sha256: string;
  jsonOk: boolean;
  jsonError?: string;
  objectCount: number;
  types: Record<string, number>;
  connections: number;
  hidden: number;
  topFlick: number;
  connFlick: number;
  skill: number;
  unknownTypes: string[];
  unknownFields: string[];
  beatMin: number | null;
  beatMax: number | null;
  laneMin: number | null;
  laneMax: number | null;
  fractionalLane: number;
  oobLane: number;
  oobLaneHidden: number;
  oobLaneVisible: number;
  oobLaneTopLevel: number;
  widthMin: number | null;
  widthMax: number | null;
  widthFractional: number;
  widthOob: number;
  directions: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  bpmNegative: number;
  bpmZero: number;
  beatNegative: number;
  slideCount: number;
  slideConnMin: number | null;
  slideConnMax: number | null;
  sameBeatGroups: number;
  sameBeatSlides: number;
  sameBeatMaxGroup: number;
  nonMonotonicSlides: number;
  emptySlide: number;
  singleConnSlide: number;
  headHidden: number;
  tailHidden: number;
  allHidden: number;
  singleVisible: number;
  hasBeat0Bpm: boolean;
  validateOk: boolean;
  errorCount: number;
  errorFields: Record<string, number>;
  errorSamples: Array<{ path: string; field?: string; noteIndex: number; connIndex?: number }>;
  convertOk: boolean;
  convertCount: number | null;
  contentEqual: boolean | null;
  orderChanged: boolean | null;
  maxNoteEndSeconds: number | null;
};

function kindOf(rel: string): Kind {
  return rel.startsWith('Official/') ? 'official' : 'community';
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function bump(map: Record<string, number>, key: string, n = 1) {
  map[key] = (map[key] ?? 0) + n;
}

function mergeMin(cur: number | null, v: number): number {
  return cur == null ? v : Math.min(cur, v);
}

function mergeMax(cur: number | null, v: number): number {
  return cur == null ? v : Math.max(cur, v);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

async function listJsonFiles(dir: string, relBase = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'index.json') continue;
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listJsonFiles(abs, rel)));
    else if (entry.name.endsWith('.json')) out.push(rel);
  }
  return out.sort();
}

function analyzeObject(obj: Record<string, unknown>, stats: FileStats) {
  const type = String(obj.type ?? '');
  bump(stats.types, type || '<missing>');
  const known = TOP_KNOWN[type];
  if (!known && type) stats.unknownTypes.push(type);
  for (const key of Object.keys(obj)) {
    if (type === 'Slide' || type === 'Long') {
      if (!known?.has(key) && key !== 'connections') stats.unknownFields.push(`${type}.${key}`);
    } else if (!known) {
      if (!['beat', 'lane', 'type', 'bpm', 'direction', 'width', 'flick', 'skill', 'connections', 'data'].includes(key)) {
        stats.unknownFields.push(`${type || '?'}.${key}`);
      }
    } else if (!known.has(key)) {
      stats.unknownFields.push(`${type}.${key}`);
    }
  }

  if (obj.flick === true) stats.topFlick += 1;
  if (obj.skill === true) stats.skill += 1;
  if (obj.flick === false) stats.unknownFields.push(`${type}.flick=false`);
  if (obj.hidden === true) stats.unknownFields.push(`${type}.hidden@top`);

  if (isFiniteNum(obj.beat)) {
    stats.beatMin = mergeMin(stats.beatMin, obj.beat);
    stats.beatMax = mergeMax(stats.beatMax, obj.beat);
    if (obj.beat < 0) stats.beatNegative += 1;
  }
  if (isFiniteNum(obj.lane)) {
    stats.laneMin = mergeMin(stats.laneMin, obj.lane);
    stats.laneMax = mergeMax(stats.laneMax, obj.lane);
    if (!Number.isInteger(obj.lane)) stats.fractionalLane += 1;
    if (obj.lane < 0 || obj.lane > 6) {
      stats.oobLane += 1;
      stats.oobLaneTopLevel += 1;
    }
  }
  if (type === 'BPM' && isFiniteNum(obj.bpm)) {
    stats.bpmMin = mergeMin(stats.bpmMin, obj.bpm);
    stats.bpmMax = mergeMax(stats.bpmMax, obj.bpm);
    if (obj.bpm < 0) stats.bpmNegative += 1;
    if (obj.bpm === 0) stats.bpmZero += 1;
  }
  if (type === 'Directional') {
    if (isFiniteNum(obj.width)) {
      stats.widthMin = mergeMin(stats.widthMin, obj.width);
      stats.widthMax = mergeMax(stats.widthMax, obj.width);
      if (!Number.isInteger(obj.width)) stats.widthFractional += 1;
      if (obj.width < 1 || obj.width > 3) stats.widthOob += 1;
    }
    if (typeof obj.direction === 'string' && !stats.directions.includes(obj.direction)) {
      stats.directions.push(obj.direction);
    }
  }

  if ((type === 'Slide' || type === 'Long') && Array.isArray(obj.connections)) {
    stats.slideCount += 1;
    const conns = obj.connections as Record<string, unknown>[];
    stats.connections += conns.length;
    stats.slideConnMin = mergeMin(stats.slideConnMin, conns.length);
    stats.slideConnMax = mergeMax(stats.slideConnMax, conns.length);
    if (conns.length === 0) stats.emptySlide += 1;
    if (conns.length === 1) stats.singleConnSlide += 1;

    let visible = 0;
    const beatGroups = new Map<number, number>();
    let nonMono = false;
    let prevBeat: number | null = null;
    for (let i = 0; i < conns.length; i++) {
      const conn = conns[i] ?? {};
      for (const key of Object.keys(conn)) {
        if (!CONN_KNOWN.has(key)) stats.unknownFields.push(`connection.${key}`);
      }
      if (conn.flick === true) stats.connFlick += 1;
      if (conn.skill === true) stats.skill += 1;
      if (conn.flick === false) stats.unknownFields.push('connection.flick=false');
      if (conn.hidden === false) stats.unknownFields.push('connection.hidden=false');
      const hidden = conn.hidden === true;
      if (hidden) stats.hidden += 1;
      else visible += 1;
      if (i === 0 && hidden) stats.headHidden += 1;
      if (i === conns.length - 1 && hidden) stats.tailHidden += 1;
      if (isFiniteNum(conn.beat)) {
        stats.beatMin = mergeMin(stats.beatMin, conn.beat);
        stats.beatMax = mergeMax(stats.beatMax, conn.beat);
        if (conn.beat < 0) stats.beatNegative += 1;
        beatGroups.set(conn.beat, (beatGroups.get(conn.beat) ?? 0) + 1);
        if (prevBeat != null && conn.beat < prevBeat) nonMono = true;
        prevBeat = conn.beat;
      }
      if (isFiniteNum(conn.lane)) {
        stats.laneMin = mergeMin(stats.laneMin, conn.lane);
        stats.laneMax = mergeMax(stats.laneMax, conn.lane);
        if (!Number.isInteger(conn.lane)) stats.fractionalLane += 1;
        if (conn.lane < 0 || conn.lane > 6) {
          stats.oobLane += 1;
          if (hidden) stats.oobLaneHidden += 1;
          else stats.oobLaneVisible += 1;
        }
      }
    }
    if (visible === 0 && conns.length > 0) stats.allHidden += 1;
    if (visible === 1) stats.singleVisible += 1;
    if (nonMono) stats.nonMonotonicSlides += 1;
    let groups = 0;
    let maxGroup = 0;
    for (const n of beatGroups.values()) {
      if (n >= 2) {
        groups += 1;
        maxGroup = Math.max(maxGroup, n);
      }
    }
    if (groups > 0) {
      stats.sameBeatSlides += 1;
      stats.sameBeatGroups += groups;
      stats.sameBeatMaxGroup = Math.max(stats.sameBeatMaxGroup, maxGroup);
    }
  }
}

function emptyStats(rel: string, bytes: number, sha256: string): FileStats {
  return {
    path: rel,
    kind: kindOf(rel),
    bytes,
    sha256,
    jsonOk: false,
    objectCount: 0,
    types: {},
    connections: 0,
    hidden: 0,
    topFlick: 0,
    connFlick: 0,
    skill: 0,
    unknownTypes: [],
    unknownFields: [],
    beatMin: null,
    beatMax: null,
    laneMin: null,
    laneMax: null,
    fractionalLane: 0,
    oobLane: 0,
    oobLaneHidden: 0,
    oobLaneVisible: 0,
    oobLaneTopLevel: 0,
    widthMin: null,
    widthMax: null,
    widthFractional: 0,
    widthOob: 0,
    directions: [],
    bpmMin: null,
    bpmMax: null,
    bpmNegative: 0,
    bpmZero: 0,
    beatNegative: 0,
    slideCount: 0,
    slideConnMin: null,
    slideConnMax: null,
    sameBeatGroups: 0,
    sameBeatSlides: 0,
    sameBeatMaxGroup: 0,
    nonMonotonicSlides: 0,
    emptySlide: 0,
    singleConnSlide: 0,
    headHidden: 0,
    tailHidden: 0,
    allHidden: 0,
    singleVisible: 0,
    hasBeat0Bpm: false,
    validateOk: false,
    errorCount: 0,
    errorFields: {},
    errorSamples: [],
    convertOk: false,
    convertCount: null,
    contentEqual: null,
    orderChanged: null,
    maxNoteEndSeconds: null,
  };
}

async function analyzeFile(rel: string): Promise<FileStats> {
  const abs = path.join(CORPUS, rel);
  const buf = await readFile(abs);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const stats = emptyStats(rel, buf.length, sha256);
  const text = buf.toString('utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    stats.jsonOk = true;
  } catch (error) {
    stats.jsonError = (error as Error).message;
    const result = validateChartCodeJSON(text);
    stats.validateOk = result.valid;
    stats.errorCount = result.errors.length;
    return stats;
  }

  if (!Array.isArray(parsed)) {
    stats.jsonError = 'not-array';
    const result = validateChartCodeJSON(text);
    stats.validateOk = result.valid;
    stats.errorCount = result.errors.length;
    return stats;
  }

  stats.objectCount = parsed.length;
  for (const item of parsed) {
    if (item && typeof item === 'object') analyzeObject(item as Record<string, unknown>, stats);
  }
  stats.unknownTypes = [...new Set(stats.unknownTypes)];
  stats.unknownFields = [...new Set(stats.unknownFields)];

  const result = validateChartCodeJSON(text);
  stats.validateOk = result.valid;
  stats.errorCount = result.errors.length;
  for (const err of result.errors) {
    bump(stats.errorFields, err.field ?? err.reason);
    if (stats.errorSamples.length < 3) {
      stats.errorSamples.push({
        path: rel,
        field: err.field,
        noteIndex: err.noteIndex,
        connIndex: err.connIndex,
      });
    }
  }

  const code = parsed as ChartCodeNote[];
  stats.hasBeat0Bpm = hasBeat0Bpm(code);

  try {
    const notes = convertChartCodeToNotes(code);
    stats.convertOk = true;
    stats.convertCount = notes.length;
    const back = convertNotesToChartCode(notes);
    stats.contentEqual = sameContent(code, back);
    stats.orderChanged = JSON.stringify(code) !== JSON.stringify(back);
    stats.maxNoteEndSeconds = maxNoteEndSeconds(notes, 4, getBpmEvents(notes));
  } catch (error) {
    stats.convertOk = false;
    stats.jsonError = `convert: ${(error as Error).message}`;
  }

  return stats;
}

function sum(files: FileStats[], pick: (f: FileStats) => number): number {
  return files.reduce((n, f) => n + pick(f), 0);
}

function extrema(files: FileStats[], pick: (f: FileStats) => number | null, mode: 'min' | 'max'): number | null {
  let cur: number | null = null;
  for (const f of files) {
    const v = pick(f);
    if (v == null) continue;
    cur = cur == null ? v : mode === 'min' ? Math.min(cur, v) : Math.max(cur, v);
  }
  return cur;
}

function typeTotals(files: FileStats[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of files) {
    for (const [k, v] of Object.entries(f.types)) bump(out, k, v);
  }
  return out;
}

async function main() {
  const started = Date.now();
  const indexRaw = JSON.parse(await readFile(path.join(CORPUS, 'index.json'), 'utf8')) as {
    retrievedAt: string;
    server: string;
    scope: string;
    filters: unknown;
    fetched: number;
    failed: number;
    entries: Array<{ path: string; sha256: string; kind: string; error: string | null }>;
  };
  const files = await listJsonFiles(CORPUS);
  const hashByPath = new Map(indexRaw.entries.map((e) => [e.path, e.sha256]));
  const results: FileStats[] = [];
  let hashMismatch = 0;
  let missingInIndex = 0;

  for (let i = 0; i < files.length; i++) {
    const rel = files[i]!;
    const stats = await analyzeFile(rel);
    const expected = hashByPath.get(rel);
    if (!expected) missingInIndex += 1;
    else if (expected !== stats.sha256) hashMismatch += 1;
    results.push(stats);
    if ((i + 1) % 50 === 0 || i === files.length - 1) {
      process.stderr.write(`analyzed ${i + 1}/${files.length}\n`);
    }
  }

  const official = results.filter((f) => f.kind === 'official');
  const community = results.filter((f) => f.kind === 'community');
  const rejected = results.filter((f) => !f.validateOk);
  const orderChanged = results.filter((f) => f.orderChanged === true);
  const contentChanged = results.filter((f) => f.contentEqual === false);
  const convertFailed = results.filter((f) => !f.convertOk);
  const noBeat0 = results.filter((f) => f.jsonOk && !f.hasBeat0Bpm);

  const notables = {
    oobLane: results.filter((f) => f.oobLane > 0).map((f) => ({
      path: f.path, kind: f.kind, oobLane: f.oobLane, hidden: f.oobLaneHidden,
      visible: f.oobLaneVisible, top: f.oobLaneTopLevel, laneMin: f.laneMin, laneMax: f.laneMax,
    })),
    negativeBpm: results.filter((f) => f.bpmNegative > 0).map((f) => ({
      path: f.path, count: f.bpmNegative, bpmMin: f.bpmMin, bpmMax: f.bpmMax,
    })),
    negativeBeat: results.filter((f) => f.beatNegative > 0).map((f) => ({
      path: f.path, count: f.beatNegative, beatMin: f.beatMin,
    })),
    widthOob: results.filter((f) => f.widthOob > 0).map((f) => ({
      path: f.path, count: f.widthOob, widthMin: f.widthMin, widthMax: f.widthMax,
    })),
    widthFractional: results.filter((f) => f.widthFractional > 0).map((f) => ({
      path: f.path, count: f.widthFractional, widthMin: f.widthMin, widthMax: f.widthMax,
    })),
    unknownTypes: results.filter((f) => f.unknownTypes.length > 0).map((f) => ({
      path: f.path, types: f.unknownTypes,
    })),
    unknownFields: results.filter((f) => f.unknownFields.length > 0).map((f) => ({
      path: f.path, fields: f.unknownFields,
    })),
    longType: results.filter((f) => (f.types.Long ?? 0) > 0).map((f) => ({ path: f.path, count: f.types.Long })),
    systemType: results.filter((f) => (f.types.System ?? 0) > 0).map((f) => ({ path: f.path, count: f.types.System })),
    skill: results.filter((f) => f.skill > 0).map((f) => ({ path: f.path, count: f.skill })),
    nonMonotonic: results.filter((f) => f.nonMonotonicSlides > 0).map((f) => ({
      path: f.path, slides: f.nonMonotonicSlides,
    })),
    degenerateSlide: results.filter((f) =>
      f.emptySlide + f.singleConnSlide + f.headHidden + f.tailHidden + f.allHidden + f.singleVisible > 0
    ).map((f) => ({
      path: f.path, emptySlide: f.emptySlide, singleConn: f.singleConnSlide,
      headHidden: f.headHidden, tailHidden: f.tailHidden, allHidden: f.allHidden, singleVisible: f.singleVisible,
    })),
    unusualDirection: results.filter((f) => f.directions.some((d) => d !== 'Left' && d !== 'Right')).map((f) => ({
      path: f.path, directions: f.directions,
    })),
    noBeat0Bpm: noBeat0.map((f) => f.path),
    rejected: rejected.map((f) => ({
      path: f.path, kind: f.kind, errorCount: f.errorCount, errorFields: f.errorFields,
      samples: f.errorSamples, oobLane: f.oobLane, oobLaneHidden: f.oobLaneHidden,
      oobLaneVisible: f.oobLaneVisible, oobLaneTopLevel: f.oobLaneTopLevel,
    })),
    contentChanged: contentChanged.map((f) => f.path),
    convertFailed: convertFailed.map((f) => ({ path: f.path, error: f.jsonError })),
    largestConnections: [...results].sort((a, b) => b.connections - a.connections).slice(0, 10).map((f) => ({
      path: f.path, connections: f.connections, objects: f.objectCount, slideConnMax: f.slideConnMax,
    })),
    largestObjects: [...results].sort((a, b) => b.objectCount - a.objectCount).slice(0, 10).map((f) => ({
      path: f.path, objects: f.objectCount, connections: f.connections,
    })),
    longestSeconds: [...results]
      .filter((f) => f.maxNoteEndSeconds != null)
      .sort((a, b) => (b.maxNoteEndSeconds ?? 0) - (a.maxNoteEndSeconds ?? 0))
      .slice(0, 10)
      .map((f) => ({ path: f.path, maxNoteEndSeconds: f.maxNoteEndSeconds })),
  };

  const summary = {
    analyzedAt: new Date().toISOString(),
    corpus: {
      retrievedAt: indexRaw.retrievedAt,
      server: indexRaw.server,
      scope: indexRaw.scope,
      filters: indexRaw.filters,
      fetched: indexRaw.fetched,
      failed: indexRaw.failed,
      jsonFiles: files.length,
      hashMismatch,
      missingInIndex,
      extraInIndex: indexRaw.entries.length - files.length,
    },
    counts: {
      official: official.length,
      community: community.length,
      jsonOk: results.filter((f) => f.jsonOk).length,
      validatePass: results.filter((f) => f.validateOk).length,
      validateReject: rejected.length,
      convertOk: results.filter((f) => f.convertOk).length,
      orderChanged: orderChanged.length,
      contentChanged: contentChanged.length,
      hasBeat0Bpm: results.filter((f) => f.hasBeat0Bpm).length,
    },
    totals: {
      all: {
        objects: sum(results, (f) => f.objectCount),
        types: typeTotals(results),
        connections: sum(results, (f) => f.connections),
        hidden: sum(results, (f) => f.hidden),
        topFlick: sum(results, (f) => f.topFlick),
        connFlick: sum(results, (f) => f.connFlick),
        skill: sum(results, (f) => f.skill),
        fractionalLane: sum(results, (f) => f.fractionalLane),
        oobLane: sum(results, (f) => f.oobLane),
        oobLaneHidden: sum(results, (f) => f.oobLaneHidden),
        oobLaneVisible: sum(results, (f) => f.oobLaneVisible),
        oobLaneTopLevel: sum(results, (f) => f.oobLaneTopLevel),
        bpmNegative: sum(results, (f) => f.bpmNegative),
        beatNegative: sum(results, (f) => f.beatNegative),
        sameBeatGroups: sum(results, (f) => f.sameBeatGroups),
        sameBeatSlides: sum(results, (f) => f.sameBeatSlides),
        nonMonotonicSlides: sum(results, (f) => f.nonMonotonicSlides),
        beatMin: extrema(results, (f) => f.beatMin, 'min'),
        beatMax: extrema(results, (f) => f.beatMax, 'max'),
        laneMin: extrema(results, (f) => f.laneMin, 'min'),
        laneMax: extrema(results, (f) => f.laneMax, 'max'),
        bpmMin: extrema(results, (f) => f.bpmMin, 'min'),
        bpmMax: extrema(results, (f) => f.bpmMax, 'max'),
        widthMin: extrema(results, (f) => f.widthMin, 'min'),
        widthMax: extrema(results, (f) => f.widthMax, 'max'),
      },
      official: {
        objects: sum(official, (f) => f.objectCount),
        types: typeTotals(official),
        connections: sum(official, (f) => f.connections),
        hidden: sum(official, (f) => f.hidden),
        fractionalLane: sum(official, (f) => f.fractionalLane),
        oobLane: sum(official, (f) => f.oobLane),
        validateReject: official.filter((f) => !f.validateOk).length,
      },
      community: {
        objects: sum(community, (f) => f.objectCount),
        types: typeTotals(community),
        connections: sum(community, (f) => f.connections),
        hidden: sum(community, (f) => f.hidden),
        fractionalLane: sum(community, (f) => f.fractionalLane),
        oobLane: sum(community, (f) => f.oobLane),
        validateReject: community.filter((f) => !f.validateOk).length,
      },
    },
    elapsedMs: Date.now() - started,
    notables,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(summary, null, 2) + '\n');
  process.stderr.write(`wrote ${OUT} in ${summary.elapsedMs}ms\n`);
  process.stderr.write(
    `pass=${summary.counts.validatePass} reject=${summary.counts.validateReject} oobFiles=${notables.oobLane.length}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
