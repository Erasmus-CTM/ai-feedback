#!/usr/bin/env python3
"""Keep ctm-libs' generated and versioned files in step (requires PyYAML).

Generated from their sources:
  feedback/feedback-core.js   shipped teaching policies   <- feedback/feedback-defaults.yml
  feedback/ai-feedback.js     interface strings           <- locales/feedback.js (the catalogue;
                              ai-feedback.js stays self-contained for pages and tests that load
                              only the three feedback files)

Versions follow _extensions/ctm-libs/_extension.yml: the ai-feedback alias
manifest (older components' loaders compare it with ctm-libs' registration),
the manifest of the forwarder template (templates/ai-feedback, shipped by
pyodide-interaktiv), the VERSION constant of feedback-core.js, package.json
and package-lock.json.

  python scripts/sync-feedback-defaults.py           # write the files
  python scripts/sync-feedback-defaults.py --check   # fail if any file differs (CI)
"""
import argparse
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / '_extensions' / 'ctm-libs'
FEEDBACK = LIBRARY / 'feedback'


def manifest_version(path):
    found = re.search(r'^version:\s*[\'"]?([\w.-]+)', path.read_text(), re.M)
    if not found:
        raise SystemExit(f'{path} has no version')
    return found[1]


def sub_once(pattern, replacement, text, path, flags=0):
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: cannot find {pattern!r}')
    return new


def catalogue_json(path):
    found = re.search(r'/\*BEGIN-JSON\*/(.*?)/\*END-JSON\*/', path.read_text(), re.S)
    if not found:
        raise SystemExit(f'{path}: no /*BEGIN-JSON*/ ... /*END-JSON*/ catalogue')
    return json.loads(found[1])


def expected_files(version):
    """{path: (old text, expected text)} for every generated or versioned file."""
    files = {}

    def update(path, change):
        old = path.read_text()
        files[path] = (old, change(old, path))

    defaults = yaml.safe_load((FEEDBACK / 'feedback-defaults.yml').read_text())['ai-feedback']

    def core(text, path):
        text = sub_once(r'(// BEGIN GENERATED FEEDBACK DEFAULTS\n).*?(\n  // END GENERATED FEEDBACK DEFAULTS)',
                        lambda m: m[1] + '  const shippedPolicies = ' + json.dumps(defaults, ensure_ascii=False) + ';' + m[2],
                        text, path, re.S)
        text = sub_once(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", text, path)
        text = sub_once(r'^/\* AI Feedback v[\w.-]+', f'/* AI Feedback v{version}', text, path)
        return sub_once(r"const policyNames = \[.*?\];",
                        'const policyNames = ' + json.dumps(list(defaults['integrations'])) + ';', text, path)

    update(FEEDBACK / 'feedback-core.js', core)

    catalogue = catalogue_json(LIBRARY / 'locales' / 'feedback.js')
    strings = {}
    for lang in catalogue['$languages']:
        entries = catalogue[lang]
        for key, value in entries.items():
            if not isinstance(value, str):
                raise SystemExit(f'locales/feedback.js: {lang}.{key} must be a plain string (ai-feedback.js has no locale runtime)')
        strings[lang] = entries

    def interface(text, path):
        return sub_once(r'(// BEGIN GENERATED FEEDBACK STRINGS[^\n]*\n).*?(\n  // END GENERATED FEEDBACK STRINGS)',
                        lambda m: m[1] + '  const locale = ' + json.dumps(strings, ensure_ascii=False) + ';' + m[2],
                        text, path, re.S)

    update(FEEDBACK / 'ai-feedback.js', interface)
    # The forwarder pyodide-interaktiv ships (step 3, E9 (ii)).
    update(ROOT / 'templates' / 'ai-feedback' / '_extension.yml',
           lambda text, path: sub_once(r'^version:.*$', f'version: {version}', text, path, re.M))
    update(ROOT / 'package.json',
           lambda text, path: sub_once(r'^(  "version": )"[^"]*"', rf'\g<1>"{version}"', text, path, re.M))

    def lock(text, path):
        text = sub_once(r'^(  "version": )"[^"]*"', rf'\g<1>"{version}"', text, path, re.M)
        return sub_once(r'^(    "": \{\n      "name": "[^"]*",\n      "version": )"[^"]*"', rf'\g<1>"{version}"', text, path, re.M)

    update(ROOT / 'package-lock.json', lock)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--check', action='store_true', help='report differences instead of writing')
    args = parser.parse_args()
    version = manifest_version(LIBRARY / '_extension.yml')
    changed = [(path, new) for path, (old, new) in expected_files(version).items() if old != new]
    if args.check:
        if changed:
            raise SystemExit('Out of date (ctm-libs ' + version + '): ' + ', '.join(str(p.relative_to(ROOT)) for p, _ in changed)
                             + '\nRun: python scripts/sync-feedback-defaults.py')
        print('Generated files and versions match ctm-libs', version)
        return
    for path, new in changed:
        path.write_text(new)
        print('Updated', path.relative_to(ROOT))


if __name__ == '__main__':
    main()
