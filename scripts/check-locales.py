#!/usr/bin/env python3
"""Check the message catalogues of ctm-libs (_extensions/ctm-libs/locales/<namespace>.js).

Each catalogue is valid JavaScript, `CTMLocales.add("<namespace>", ...)`, whose
payload between /*BEGIN-JSON*/ and /*END-JSON*/ is strict JSON:

  {"$languages": ["en", ...], "en": {<key>: <entry>, ...}, "<lang>": {...}}

English is the reference. Every listed language has exactly its keys, with
entries of the same kind and arguments. Entry kinds: a string; data (arrays,
objects without "$" keys); {"$ref": "<namespace>.<key>"}; {"$t": "...{arg}...",
"$args": [...], "$lookup": {arg: <data key with a "*" default>}}; and plurals
{"$args": [...], "$plural": <arg>, "one": "...", "other": "..."}.

  python scripts/check-locales.py       # exit status 1 on any error; prints the coverage
"""
import json
import re
import sys
from pathlib import Path

LOCALES = Path(__file__).resolve().parents[1] / '_extensions' / 'ctm-libs' / 'locales'
RUNTIME = 'ctm-locale.js'
NAME = re.compile(r'^[A-Za-z_][\w-]*$')
PLACEHOLDER = re.compile(r'\{([A-Za-z_][\w-]*)\}')
TAG = re.compile(r'^[a-z]{2,3}$')


def kind(entry):
    if isinstance(entry, str):
        return 'string'
    if isinstance(entry, list):
        return 'data'
    if isinstance(entry, dict):
        special = [key for key in entry if key.startswith('$')]
        if not special:
            return 'data'
        if '$ref' in entry:
            return 'ref'
        if '$plural' in entry:
            return 'plural'
        if '$t' in entry:
            return 'template'
        return 'invalid'
    return 'invalid'


def read(path, errors):
    text = path.read_text(encoding='utf-8')
    namespace = path.stem
    if text.count('/*BEGIN-JSON*/') != 1 or text.count('/*END-JSON*/') != 1:
        errors.append(f'{path.name}: needs exactly one /*BEGIN-JSON*/ and one /*END-JSON*/ marker')
        return None
    head, rest = text.split('/*BEGIN-JSON*/')
    payload, tail = rest.split('/*END-JSON*/')
    if not re.search(r'CTMLocales\.add\(\s*"' + re.escape(namespace) + r'"\s*,\s*$', head):
        errors.append(f'{path.name}: must call CTMLocales.add("{namespace}", ...) right before /*BEGIN-JSON*/')
    if not re.fullmatch(r'\s*\);\s*', tail):
        errors.append(f'{path.name}: only ");" may follow /*END-JSON*/')
    try:
        return json.loads(payload)
    except json.JSONDecodeError as error:
        errors.append(f'{path.name}: the catalogue is not valid JSON: {error}')
        return None


def check_entry(where, entry, english, catalogue, catalogues, lang, errors):
    entry_kind = kind(entry)
    if entry_kind == 'invalid':
        errors.append(f'{where}: unknown entry {json.dumps(entry, ensure_ascii=False)[:80]}')
        return
    if english is not None and entry_kind != kind(english):
        errors.append(f'{where}: is a {entry_kind} entry, English has a {kind(english)} entry')
        return
    if entry_kind == 'ref':
        target = entry['$ref']
        if set(entry) != {'$ref'} or not isinstance(target, str) or '.' not in target:
            errors.append(f'{where}: $ref must be the only key, "<namespace>.<key>"')
            return
        namespace, key = target.split('.', 1)
        other = catalogues.get(namespace)
        if other is None:
            errors.append(f'{where}: $ref to the unknown catalogue {namespace}')
        elif key not in other.get('en', {}):
            errors.append(f'{where}: $ref to {target}, which does not exist')
        elif lang not in other.get('$languages', []):
            errors.append(f'{where}: $ref to {target}, which has no {lang} text')
        elif kind(other['en'][key]) == 'ref':
            errors.append(f'{where}: $ref to {target}, which is itself a $ref')
        return
    if entry_kind in ('template', 'plural'):
        args = entry.get('$args', [])
        if not isinstance(args, list) or not all(isinstance(a, str) and NAME.match(a) for a in args) or len(set(args)) != len(args):
            errors.append(f'{where}: $args must be a list of distinct names')
            return
        if english is not None and args != english.get('$args', []):
            errors.append(f'{where}: $args {args} differ from English {english.get("$args", [])}')
        texts = []
        if entry_kind == 'template':
            allowed = {'$t', '$args', '$lookup'}
            texts.append(entry['$t'])
            for name, data_key in (entry.get('$lookup') or {}).items():
                data = catalogue.get(lang, {}).get(data_key)
                if name not in args:
                    errors.append(f'{where}: $lookup of the undeclared argument {name}')
                elif kind(data) != 'data' or not isinstance(data, dict) or '*' not in data:
                    errors.append(f'{where}: $lookup {name} needs the data entry {data_key} with a "*" default')
        else:
            allowed = {'$args', '$plural', 'one', 'other'}
            if entry.get('$plural') not in args:
                errors.append(f'{where}: $plural must name one of $args')
            texts += [entry.get('one'), entry.get('other')]
        if set(entry) - allowed:
            errors.append(f'{where}: unknown keys {sorted(set(entry) - allowed)}')
        for text in texts:
            if not isinstance(text, str):
                errors.append(f'{where}: texts must be strings')
                continue
            for name in PLACEHOLDER.findall(text):
                if name not in args:
                    errors.append(f'{where}: {{{name}}} is not one of $args {args}')


def main():
    errors = []
    files = sorted(p for p in LOCALES.glob('*.js') if p.name != RUNTIME)
    if not (LOCALES / RUNTIME).is_file():
        errors.append(f'{RUNTIME} is missing')
    catalogues = {}
    for path in files:
        catalogue = read(path, errors)
        if catalogue is not None:
            catalogues[path.stem] = catalogue
    coverage = []
    for namespace, catalogue in catalogues.items():
        name = namespace + '.js'
        if not isinstance(catalogue, dict):
            errors.append(f'{name}: the catalogue must be an object')
            continue
        languages = catalogue.get('$languages')
        if not isinstance(languages, list) or not languages or 'en' not in languages or len(set(languages)) != len(languages) \
                or not all(isinstance(lang, str) and TAG.match(lang) for lang in languages):
            errors.append(f'{name}: $languages must list distinct primary language codes, including en')
            continue
        for key in catalogue:
            if key != '$languages' and key not in languages:
                errors.append(f'{name}: {key} is not listed in $languages')
        english = catalogue.get('en')
        if not isinstance(english, dict) or not english:
            errors.append(f'{name}: en must hold the messages')
            continue
        for lang in languages:
            own = catalogue.get(lang)
            if not isinstance(own, dict):
                errors.append(f'{name}: {lang} must be an object of messages')
                continue
            missing = [key for key in english if key not in own]
            extra = [key for key in own if key not in english]
            if missing:
                errors.append(f'{name}: {lang} lacks {", ".join(missing)}')
            if extra:
                errors.append(f'{name}: {lang} has keys English lacks: {", ".join(extra)}')
            for key, entry in own.items():
                if not NAME.match(key):
                    errors.append(f'{name}: {lang}.{key} is not a valid key')
                check_entry(f'{name}: {lang}.{key}', entry, None if lang == 'en' else english.get(key), catalogue, catalogues, lang, errors)
        coverage.append(f'  {namespace}: {", ".join(languages)} ({len(english)} messages)')
    print('Catalogues:\n' + '\n'.join(coverage))
    if errors:
        print('\n'.join('error: ' + e for e in errors), file=sys.stderr)
        sys.exit(1)
    print('All catalogues are complete and valid.')


if __name__ == '__main__':
    main()
