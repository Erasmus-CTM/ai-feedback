// Quarto supplies its offline YAML parser and Deno runtime; no author-installed dependency.
import { parse } from 'stdlib/yaml';
import { resolve, dirname, join, relative } from 'stdlib/path';
import './feedback-core.js';

const config = JSON.parse(Deno.args[0]);
// Read author metadata before Pandoc's Markdown conversion. Quarto replaces a
// whole custom metadata mapping at page (and _metadata) scope, so merge every
// level here, key by key: project, profiles, directory _metadata, front matter.
const settings: Record<string, any> = {};
const origins: Record<string, string> = {};
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
    for (const key of Object.keys(value)) origins[key] = file;
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
  for (const profile of config.profiles || []) metadataFile(join(root, '_quarto-' + profile));
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
// Runtime settings use the same key-by-key merge as policy selection, so a page
// that selects a policy keeps the project's mode, provider defaults and storage.
const runtimeKeys = ['mode', 'storage', 'base-url', 'model', 'ui-language', 'feedback-language'];
const policyKeys = ['policy-files', 'page-policy-files', 'project-policy', 'page-policy'];
const warnings: string[] = [];
const runtime: Record<string, string> = {};
for (const [key, value] of Object.entries(settings)) {
  const where = ' (' + relative(root, origins[key]) + ')';
  if (/^(api[-_]?key|apikey|key|token|secret|password|authorization)$/i.test(key)) {
    warnings.push('ai-feedback: ' + key + where + ' looks like a credential. It is ignored and must not be stored in Quarto metadata, ' +
      'which is published with the site; learners enter personal keys in the Feedback settings.');
  } else if (runtimeKeys.includes(key)) {
    if (value !== null && typeof value === 'object') warnings.push('ai-feedback: ' + key + where + ' must be a single value; it is ignored.');
    else if (value !== null && value !== undefined) runtime[key] = String(value);
  } else if (!policyKeys.includes(key)) {
    warnings.push('ai-feedback: unknown option ' + key + where + ' is ignored. Known options: ' + [...runtimeKeys, ...policyKeys].join(', ') + '.');
  }
}
const allowed: Record<string, string[]> = { mode: ['copy', 'api'], storage: ['local', 'session'] };
for (const [key, values] of Object.entries(allowed)) {
  if (Object.hasOwn(runtime, key) && !values.includes(runtime[key])) {
    warnings.push('ai-feedback: ' + key + ' must be ' + values.join(' or ') + ' (found ' + JSON.stringify(runtime[key]) + '); using ' + values[0] + '.');
    delete runtime[key];
  }
}
if (Object.hasOwn(runtime, 'base-url') && runtime['base-url'] !== '') {
  let url: URL | null = null;
  try { url = new URL(runtime['base-url']); } catch { url = null; }
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    warnings.push('ai-feedback: base-url must be an http(s) URL without credentials, query or fragment (found ' + JSON.stringify(runtime['base-url']) + '); it is ignored.');
    delete runtime['base-url'];
  }
}
delete config.projectDirectory; delete config.inputFile; delete config.profiles;
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
console.log(JSON.stringify({ policies: JSON.stringify(config), settings: runtime, read: Object.keys(settings), warnings }));
