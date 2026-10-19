// Settings reader of ctm-libs: lua/settings.lua runs it with `quarto run`,
// at most once per page. Quarto supplies its offline YAML parser and Deno
// runtime; no author-installed dependency (deno.json keeps a project's own
// Deno or npm configuration out).
import { parse } from 'stdlib/yaml';
import { resolve, dirname, join, relative } from 'stdlib/path';
import './feedback/feedback-core.js';

// Input on stdin, never the command line (it can hold credentials an author
// put in metadata by mistake, and command lines are visible to other users):
//   {projectDirectory, inputFile, profiles, sections: [...],
//    documentMeta: {<section>: {<key>: <JSON value>}}}
// documentMeta is Quarto's merged metadata of the page, converted by Lua.
//
// Output on stdout:
//   {settings: {<section>: {<key>: {value, origin}}}, policies: "<JSON>",
//    policyNames: [...], warnings: [...], errors: [...]}
//
// Quarto replaces a whole custom metadata mapping when a page defines its own
// (F-79), so the reader reads every level itself and combines the keys one by
// one: _quarto.yml, the profiles (the first listed wins), _quarto.yml.local,
// the _metadata.yml files from the project root to the page, the page's front
// matter. For a key of a section:
//   1. the page's front matter;
//   2. Quarto's merged metadata (metadata-files, format-scoped metadata,
//      notebooks, -M): it holds the key unless the page's own map dropped it;
//   3. the levels above, the nearest one winning.
const input = JSON.parse(await new Response(Deno.stdin.readable).text());
const sections: string[] = input.sections || ['ai-feedback'];
const warnings: string[] = [];
const errors: string[] = [];
const root = resolve(input.projectDirectory || dirname(input.inputFile));
const has = (object: unknown, key: string) => !!object && typeof object === 'object' && Object.hasOwn(object as object, key);
const isMap = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
const label = (file: string) => relative(root, file).split(/[\\/]/).join('/') || file;

// YAML values as JSON: dates (`model: 2024-08-06`) become their written form.
function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(plain);
  if (isMap(value)) return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, plain(v)]));
  return value;
}

type Level = {origin: string, page: boolean, sections: Record<string, Record<string, unknown>>};
const levels: Level[] = [];

function readLevel(file: string, page = false) {
  let raw: string;
  try { raw = Deno.readTextFileSync(file); } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (page) {
    const match = raw.match(/^﻿?---\s*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (!match) return;
    raw = match[1];
  }
  const origin = label(file);
  let document: unknown;
  try { document = parse(raw); } catch (error) {
    errors.push('Cannot read the metadata of ' + origin + ': ' + (error as Error).message);
    return;
  }
  const level: Level = {origin, page, sections: {}};
  for (const section of sections) {
    if (!has(document, section)) continue;
    const value = (document as Record<string, unknown>)[section];
    if (!isMap(value)) {
      if (section === 'ai-feedback') errors.push('ai-feedback metadata must be a mapping: ' + origin);
      else warnings.push(section + ' in ' + origin + ' must be a mapping of options; it is ignored.');
      continue;
    }
    level.sections[section] = plain(value) as Record<string, unknown>;
  }
  levels.push(level);
}
function readMetadataFile(stem: string) {
  for (const suffix of ['.yml', '.yaml']) {
    try { Deno.statSync(stem + suffix); } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
    readLevel(stem + suffix);
    return;
  }
}

if (input.projectDirectory) {
  readMetadataFile(join(root, '_quarto'));
  // Quarto gives the first listed profile precedence, then _quarto.yml.local.
  for (const profile of [...(input.profiles || [])].reverse()) readMetadataFile(join(root, '_quarto-' + profile));
  for (const local of ['_quarto.yml.local', '_quarto.yaml.local']) readLevel(join(root, local));
}
const page = resolve(input.inputFile);
let directory = root;
readMetadataFile(join(directory, '_metadata'));
for (const part of relative(root, dirname(page)).split(/[\\/]/).filter(Boolean)) {
  directory = join(directory, part);
  readMetadataFile(join(directory, '_metadata'));
}
readLevel(page, true);

// Quarto's merged metadata, per section. Lua encodes an empty map as [].
const documentMeta: Record<string, Record<string, unknown>> = {};
for (const [section, value] of Object.entries(input.documentMeta || {})) {
  if (Array.isArray(value) && value.length === 0) documentMeta[section] = {};
  else if (isMap(value)) documentMeta[section] = value as Record<string, unknown>;
  else if (section === 'ai-feedback') errors.push('ai-feedback metadata must be a mapping (document metadata)');
  else warnings.push(section + ' (document metadata) must be a mapping of options; it is ignored.');
}

type Entry = {value: unknown, origin: string};
// Equal up to Pandoc's metadata strings (`7` arrives from Lua as "7").
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
  if (isMap(a) && isMap(b)) {
    const keys = Object.keys(a as object);
    return keys.length === Object.keys(b as object).length && keys.every(key => same((a as any)[key], (b as any)[key]));
  }
  if (a === null || b === null || typeof a === 'object' || typeof b === 'object') return a === b;
  return String(a) === String(b);
}
// The value of section.key by the rules above, or undefined. When the merged
// metadata holds what a file level says, the file is named as its origin.
function resolveKey(section: string, key: string, accept: (value: unknown) => boolean = () => true): Entry | undefined {
  let file: Entry | undefined, fromPage = false;
  for (const level of levels) {
    const values = level.sections[section];
    if (values && Object.hasOwn(values, key)) { file = {value: values[key], origin: level.origin}; fromPage = level.page; }
  }
  const meta = documentMeta[section];
  if (!fromPage && meta && Object.hasOwn(meta, key) && accept(meta[key]) && !(file && same(file.value, meta[key]))) {
    return {value: meta[key], origin: 'document metadata'};
  }
  return file;
}
// Every key of a section at any level or in the merged metadata, with where it was set.
function keysOf(section: string) {
  const found = new Map<string, string>();
  for (const level of levels) for (const key of Object.keys(level.sections[section] || {})) if (!found.has(key)) found.set(key, level.origin);
  for (const key of Object.keys(documentMeta[section] || {})) if (!found.has(key)) found.set(key, 'document metadata');
  return found;
}

const CREDENTIAL = /^(api[-_]?key|apikey|key|token|secret|password|authorization)$/i;
const settings: Record<string, Record<string, Entry>> = {};

// --- ai-feedback ------------------------------------------------------------
const RUNTIME_KEYS = ['mode', 'storage', 'base-url', 'model', 'ui-language', 'feedback-language'];
const POLICY_KEYS = ['policy-files', 'page-policy-files', 'project-policy', 'page-policy'];
function scalar(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value === 'object') return undefined;
  return String(value);
}
function feedbackSettings() {
  const out: Record<string, Entry> = {};
  for (const [key, origin] of keysOf('ai-feedback')) {
    if (CREDENTIAL.test(key)) {
      warnings.push('ai-feedback: ' + key + ' (' + origin + ') looks like a credential. It is ignored and must not be stored in Quarto metadata, ' +
        'which is published with the site; learners enter personal keys in the Feedback settings.');
    } else if (['defaults', 'integrations', 'policies', 'exercises'].includes(key)) {
      errors.push('ai-feedback: inline ' + key + ' (' + origin + ') is not supported; load definitions and select project-policy/page-policy');
    } else if (!RUNTIME_KEYS.includes(key) && !POLICY_KEYS.includes(key)) {
      warnings.push('ai-feedback: unknown option ' + key + ' (' + origin + ') is ignored. Known options: ' + [...RUNTIME_KEYS, ...POLICY_KEYS].join(', ') + '.');
    }
  }
  for (const key of RUNTIME_KEYS) {
    // Only a single value of the merged metadata counts (as before).
    const entry = resolveKey('ai-feedback', key, value => scalar(value) !== undefined);
    if (!entry || entry.value === null) continue;
    const value = scalar(entry.value);
    if (value === undefined) {
      warnings.push('ai-feedback: ' + key + ' (' + entry.origin + ') must be a single value; it is ignored.');
      continue;
    }
    out[key] = {value, origin: entry.origin};
  }
  const allowed: Record<string, string[]> = {mode: ['copy', 'api'], storage: ['local', 'session']};
  for (const [key, values] of Object.entries(allowed)) {
    if (out[key] && !values.includes(out[key].value as string)) {
      warnings.push('ai-feedback: ' + key + ' (' + out[key].origin + ') must be ' + values.join(' or ') + ' (found ' + JSON.stringify(out[key].value) + '); using ' + values[0] + '.');
      delete out[key];
    }
  }
  if (out['base-url'] && out['base-url'].value !== '') {
    // Never echo the value: a rejected URL may itself contain a secret.
    let url: URL | null = null;
    try { url = new URL(out['base-url'].value as string); } catch { url = null; }
    const problems = !url ? ['is not a valid URL'] : [
      ...(['https:', 'http:'].includes(url.protocol) ? [] : ['must use http or https']),
      ...(url.username || url.password ? ['contains a user name or password'] : []),
      ...(url.search ? ['contains a query'] : []),
      ...(url.hash ? ['contains a fragment'] : []),
    ];
    if (problems.length) {
      const shown = url && ['https:', 'http:'].includes(url.protocol) ? ' ' + url.origin.replace(/\/\/[^@/]*@/, '//') + url.pathname : '';
      warnings.push('ai-feedback: base-url' + shown + ' (' + out['base-url'].origin + ') ' + problems.join(', ') + '; it is ignored.');
      delete out['base-url'];
    }
  }
  return out;
}

// Policy selection and files. The merged metadata seeds them (so that
// metadata-files and format-scoped settings keep working); a key set at a
// file level replaces the seed.
function policies() {
  const meta = documentMeta['ai-feedback'] || {};
  const files = (value: unknown, key: string, origin: string): string[] | null => {
    if (!(typeof value === 'string' || Array.isArray(value) && value.every(file => typeof file === 'string'))) {
      errors.push('ai-feedback: ' + key + ' (' + origin + ') must be a path or ordered path list');
      return null;
    }
    return (Array.isArray(value) ? value : [value]).map(file => resolve(root, file));
  };
  const selection = (value: unknown, origin: string) => {
    if (typeof value === 'boolean' || Array.isArray(value) && origin === 'document metadata') {
      errors.push('ai-feedback: policy selection needs a policy name or integration mapping (' + origin + ')');
      return undefined;
    }
    return value;
  };
  const config: Record<string, unknown> = {layers: [], pageLayers: []};
  const slots: [string, string, 'files' | 'selection'][] = [['policy-files', 'layers', 'files'], ['page-policy-files', 'pageLayers', 'files'],
    ['project-policy', 'projectPolicy', 'selection'], ['page-policy', 'pagePolicy', 'selection']];
  for (const [key, slot, kind] of slots) {
    let entry: Entry | undefined;
    for (const level of levels) {
      const values = level.sections['ai-feedback'];
      if (values && Object.hasOwn(values, key)) entry = {value: values[key], origin: level.origin};
    }
    if (!entry && Object.hasOwn(meta, key)) entry = {value: meta[key], origin: 'document metadata'};
    if (!entry) continue;
    const value = kind === 'files' ? files(entry.value, key, entry.origin) : selection(entry.value, entry.origin);
    if (value !== undefined && value !== null) config[slot] = value;
  }
  for (const slot of ['layers', 'pageLayers']) {
    config[slot] = (config[slot] as string[]).flatMap((file: string) => {
      let document: unknown;
      try { document = parse(Deno.readTextFileSync(file)); } catch (error) {
        errors.push('ai-feedback: cannot read the policy file ' + file + ': ' + (error as Error).message);
        return [];
      }
      if (!isMap(document) || !Object.hasOwn(document as object, 'ai-feedback')) {
        errors.push('ai-feedback: policy file needs an ai-feedback mapping: ' + file);
        return [];
      }
      return [(document as Record<string, unknown>)['ai-feedback']];
    });
  }
  // The browser's exact schema and graph checks, at render time, including
  // unused definitions: both builds (with and without AI feedback) fail alike.
  if (!errors.length) {
    const feedback = (globalThis as any).AIFeedback;
    try {
      for (const integration of ['plain-text', 'py-exercise', 'math-exercise', 'pyodide-interaktiv']) feedback.resolvePolicy(integration, 'en', {}, config);
    } catch (error) {
      errors.push('ai-feedback: ' + (error as Error).message);
    }
  }
  const names = new Set<string>();
  for (const layers of [config.layers, config.pageLayers] as unknown[][]) {
    for (const layer of layers) if (isMap(layer) && isMap((layer as any).policies)) for (const name of Object.keys((layer as any).policies)) names.add(name);
  }
  return {config, names: [...names]};
}

// --- ctm-assessment and the components --------------------------------------
const SHARED_KEYS = ['stop-after', 'lang'];
function sectionSettings(section: string) {
  const out: Record<string, Entry> = {};
  for (const [key, origin] of keysOf(section)) {
    if (CREDENTIAL.test(key)) {
      warnings.push(section + ': ' + key + ' (' + origin + ') looks like a credential. It is ignored and must not be stored in Quarto metadata, ' +
        'which is published with the site.');
      continue;
    }
    if (section === 'ctm-assessment' && !SHARED_KEYS.includes(key)) {
      warnings.push('ctm-assessment: unknown option ' + key + ' (' + origin + ') is ignored. Known options: ' + SHARED_KEYS.join(', ') + '.');
      continue;
    }
    const entry = resolveKey(section, key);
    if (entry && entry.value !== null && entry.value !== undefined) out[key] = entry;
  }
  return out;
}

let policyResult = {config: {layers: [], pageLayers: []} as Record<string, unknown>, names: [] as string[]};
try {
  for (const section of sections) settings[section] = section === 'ai-feedback' ? feedbackSettings() : sectionSettings(section);
  if (sections.includes('ai-feedback')) policyResult = policies();
} catch (error) {
  errors.push('ctm-libs settings: ' + ((error as Error).message || String(error)));
}
// Policies stay a JSON string: Lua's JSON decoder would drop explicit nulls (extends: null).
console.log(JSON.stringify({settings, policies: JSON.stringify(policyResult.config), policyNames: policyResult.names, warnings, errors}));
