// Quarto supplies its offline YAML parser and Deno runtime; no author-installed dependency.
import { parse } from 'stdlib/yaml';
import { resolve, dirname, join, relative } from 'stdlib/path';
import './feedback-core.js';

// Read from stdin, never the command line (see feedback-policy.lua).
const config = JSON.parse(await new Response(Deno.stdin.readable).text());
// Read author metadata before Pandoc's Markdown conversion. Quarto replaces a
// whole custom metadata mapping when page front matter defines one, so merge
// every level here, key by key: project, profiles, _quarto.yml.local, directory
// _metadata, front matter.
const settings: Record<string, any> = {};
const origins: Record<string, string> = {};
const pageKeys = new Set<string>();
function metadata(file: string, frontMatter = false) {
  let raw: string;
  try { raw = Deno.readTextFileSync(file); } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (frontMatter) {
    const match = raw.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/);
    if (!match) return;
    raw = match[1];
  }
  const document = parse(raw) as Record<string, any>;
  if (document && Object.hasOwn(document, 'ai-feedback')) {
    const value = document['ai-feedback'];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ai-feedback metadata must be a mapping: ' + file);
    Object.assign(settings, value);
    for (const key of Object.keys(value)) { origins[key] = file; if (frontMatter) pageKeys.add(key); }
  }
}
function metadataFile(stem: string) {
  for (const suffix of ['.yml','.yaml']) {
    try { Deno.statSync(stem + suffix); metadata(stem + suffix); return; } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}
const root = resolve(config.projectDirectory || dirname(config.inputFile));
if (config.projectDirectory) {
  metadataFile(join(root, '_quarto'));
  // Quarto gives the first listed profile precedence, then _quarto.yml.local.
  for (const profile of [...(config.profiles || [])].reverse()) metadataFile(join(root, '_quarto-' + profile));
  for (const local of ['_quarto.yml.local', '_quarto.yaml.local']) metadata(join(root, local));
}
const input = resolve(config.inputFile);
const directories = relative(root, dirname(input)).split(/[\\/]/).filter(Boolean);
let directory = root;
metadataFile(join(directory, '_metadata'));
for (const part of directories) { directory = join(directory, part); metadataFile(join(directory, '_metadata')); }
metadata(input, true);
for (const [field, key] of [['policy-files','layers'],['page-policy-files','pageLayers']]) {
  if (Object.hasOwn(settings, field)) {
    const files = settings[field];
    if (!(typeof files === 'string' || Array.isArray(files) && files.every(file => typeof file === 'string'))) throw new Error(field + ' must be a path or ordered path list');
    config[key] = (Array.isArray(files) ? files : [files]).map(file => resolve(root, file));
  }
}
for (const [field,key] of [['project-policy','projectPolicy'],['page-policy','pagePolicy']]) {
  if (Object.hasOwn(settings,field)) config[key] = settings[field];
}
for (const field of ['defaults','integrations','policies','exercises']) {
  if (Object.hasOwn(settings,field)) throw new Error('ai-feedback: inline ' + field + ' is not supported; load definitions and select project-policy/page-policy');
}
// Runtime settings. A key from the page's own front matter wins; otherwise the
// value in Quarto's document metadata wins (it already merges project, profile,
// _metadata, format-scoped and notebook metadata, but loses project keys when
// the page defines its own mapping); otherwise the value merged from the files.
const runtimeKeys = ['mode', 'storage', 'base-url', 'model', 'ui-language', 'feedback-language'];
const policyKeys = ['policy-files', 'page-policy-files', 'project-policy', 'page-policy'];
const documentMeta = config.documentMeta || {values: {}, keys: []};
const warnings: string[] = [];
const runtime: Record<string, string> = {};
const origin: Record<string, string> = {};
function scalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return undefined;
  return String(value);
}
const where = (key: string) => origins[key] ? relative(root, origins[key]) : 'document metadata';
for (const key of new Set([...Object.keys(settings), ...documentMeta.keys])) {
  if (/^(api[-_]?key|apikey|key|token|secret|password|authorization)$/i.test(key)) {
    warnings.push('ai-feedback: ' + key + ' (' + where(key) + ') looks like a credential. It is ignored and must not be stored in Quarto metadata, ' +
      'which is published with the site; learners enter personal keys in the Feedback settings.');
  } else if (!runtimeKeys.includes(key) && !policyKeys.includes(key)) {
    warnings.push('ai-feedback: unknown option ' + key + ' (' + where(key) + ') is ignored. Known options: ' + [...runtimeKeys, ...policyKeys].join(', ') + '.');
  }
}
for (const key of runtimeKeys) {
  let value: string | undefined;
  if (pageKeys.has(key) || !Object.hasOwn(documentMeta.values, key)) {
    if (Object.hasOwn(settings, key) && settings[key] !== null && scalar(settings[key]) === undefined) {
      warnings.push('ai-feedback: ' + key + ' (' + where(key) + ') must be a single value; it is ignored.');
    }
    value = scalar(settings[key]);
    origin[key] = where(key);
  } else {
    value = documentMeta.values[key];
    origin[key] = 'document metadata';
  }
  if (value !== undefined) runtime[key] = value;
}
const allowed: Record<string, string[]> = { mode: ['copy', 'api'], storage: ['local', 'session'] };
for (const [key, values] of Object.entries(allowed)) {
  if (Object.hasOwn(runtime, key) && !values.includes(runtime[key])) {
    warnings.push('ai-feedback: ' + key + ' (' + origin[key] + ') must be ' + values.join(' or ') + ' (found ' + JSON.stringify(runtime[key]) + '); using ' + values[0] + '.');
    delete runtime[key];
  }
}
if (Object.hasOwn(runtime, 'base-url') && runtime['base-url'] !== '') {
  // Never echo the value: a rejected URL may itself contain a secret.
  let url: URL | null = null;
  try { url = new URL(runtime['base-url']); } catch { url = null; }
  const problems = !url ? ['is not a valid URL'] : [
    ...(['https:', 'http:'].includes(url.protocol) ? [] : ['must use http or https']),
    ...(url.username || url.password ? ['contains a user name or password'] : []),
    ...(url.search ? ['contains a query'] : []),
    ...(url.hash ? ['contains a fragment'] : []),
  ];
  if (problems.length) {
    const shown = url && ['https:', 'http:'].includes(url.protocol) ? ' ' + url.origin.replace(/\/\/[^@/]*@/, '//') + url.pathname : '';
    warnings.push('ai-feedback: base-url' + shown + ' (' + origin['base-url'] + ') ' + problems.join(', ') + '; it is ignored.');
    delete runtime['base-url'];
  }
}
delete config.projectDirectory; delete config.inputFile; delete config.profiles; delete config.documentMeta;
for (const key of ['layers', 'pageLayers']) {
  config[key] = config[key].map((file: string) => {
    const document = parse(Deno.readTextFileSync(file)) as Record<string, unknown>;
    if (!document || typeof document !== 'object' || Array.isArray(document) || !Object.hasOwn(document, 'ai-feedback')) {
      throw new Error('ai-feedback: policy file needs an ai-feedback mapping: ' + file);
    }
    return document['ai-feedback'];
  });
}
// Use the browser's exact schema/graph checks at render time, including unused definitions.
const feedback = (globalThis as any).AIFeedback;
for (const integration of ['plain-text', 'py-exercise', 'math-exercise', 'pyodide-interaktiv']) {
  feedback.resolvePolicy(integration, 'en', {}, config);
}
// Policies stay a JSON string: Lua's JSON decoder would drop explicit nulls (extends: null).
console.log(JSON.stringify({ policies: JSON.stringify(config), settings: runtime, warnings }));
