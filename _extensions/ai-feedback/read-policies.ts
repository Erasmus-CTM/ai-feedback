// Quarto supplies its offline YAML parser and Deno runtime; no author-installed dependency.
import { parse } from 'stdlib/yaml';
import { resolve, dirname, join, relative } from 'stdlib/path';
import './feedback-core.js';

const config = JSON.parse(Deno.args[0]);
// Read author metadata before Pandoc's Markdown conversion. Quarto may replace a
// whole custom metadata mapping at page scope, so retain project policy fields
// independently and overlay only explicitly supplied page keys.
const settings: Record<string, any> = {};
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
  if (document?.['ai-feedback']) Object.assign(settings, document['ai-feedback']);
}
const root = resolve(config.projectDirectory || dirname(config.inputFile));
if (config.projectDirectory) {
  metadata(join(root, '_quarto.yml'));
  for (const profile of config.profiles || []) metadata(join(root, '_quarto-' + profile + '.yml'));
}
const input = resolve(config.inputFile);
const directories = relative(root, dirname(input)).split(/[\\/]/).filter(Boolean);
let directory = root;
metadata(join(directory, '_metadata.yml'));
for (const part of directories) { directory = join(directory, part); metadata(join(directory, '_metadata.yml')); }
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
console.log(JSON.stringify(config));
