#!/usr/bin/env python3
"""Build/test a common page from explicit CTM repository revisions (Python 3.12+)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / 'integration' / 'feedback'


def run(args, cwd=None, env=None):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def git(path, *args):
    return subprocess.check_output(['git', '-C', str(path), *args], text=True).strip()


def download(url, target):
    request = urllib.request.Request(url, headers={'User-Agent': 'CTM-feedback-integration'})
    with urllib.request.urlopen(request, timeout=120) as response, target.open('wb') as out:
        shutil.copyfileobj(response, out)


def snapshot(repo, sha, cache):
    target = cache / (repo.rsplit('/', 1)[1] + '-' + sha)
    if (target / '.integration-source.json').exists():
        return target
    with tempfile.TemporaryDirectory(dir=cache) as temp:
        temp = Path(temp)
        archive = temp / 'source.tar.gz'
        download(f'https://codeload.github.com/{repo}/tar.gz/{sha}', archive)
        with tarfile.open(archive) as tar:
            tar.extractall(temp / 'unpacked', filter='data')
        roots = list((temp / 'unpacked').iterdir())
        if len(roots) != 1 or not roots[0].is_dir():
            raise RuntimeError('Unexpected repository archive structure')
        # Do not treat generated metadata as part of upstream source.
        (roots[0] / '.integration-source.json').write_text(json.dumps({'repository': repo, 'commit': sha}))
        roots[0].rename(target)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=ROOT / '.feedback-workspace')
    parser.add_argument('--refresh', action='store_true', help='Resolve the configured remote branch tips instead of external pins')
    parser.add_argument('--source', action='append', default=[], metavar='NAME=PATH', help='Use a local Git checkout for a repository; record SHA and dirty files')
    parser.add_argument('--test', action='store_true', help='Run repository and common-page tests after rendering')
    parser.add_argument('--browser', action='store_true', help='Also run real Chromium/Pyodide/Monaco smoke tests (requires Playwright browser)')
    args = parser.parse_args()
    config = json.loads((TEMPLATE / 'repos.json').read_text())
    if subprocess.check_output(['quarto', '--version'], text=True).strip() != config['quarto']:
        raise SystemExit('Use Quarto ' + config['quarto'] + ' to match this integration baseline.')
    workspace = args.workspace.resolve()
    if workspace == ROOT or workspace in ROOT.parents:
        raise SystemExit('Workspace must not replace the project or its ancestors.')
    workspace.mkdir(parents=True, exist_ok=True)
    marker = workspace / '.ctm-feedback-workspace'
    if not marker.exists() and any(workspace.iterdir()):
        raise SystemExit('Refusing a nonempty workspace not created by this script.')
    marker.touch()
    (workspace / 'tmp').mkdir(exist_ok=True)
    base_env = dict(os.environ, TMPDIR=str(workspace / 'tmp'))
    cache = workspace / 'repos'
    cache.mkdir(exist_ok=True)
    local = {'ai-feedback': ROOT}
    for entry in args.source:
        name, path = entry.split('=', 1)
        if name not in config['repositories']:
            raise SystemExit('Unknown repository: ' + name)
        local[name] = Path(path).resolve()
    sources, revisions = {}, {}
    for name, spec in config['repositories'].items():
        sha = spec['commit']
        dirty = []
        if name in local:
            source = local[name]
            sha = git(source, 'rev-parse', 'HEAD')
            dirty = git(source, 'status', '--porcelain', '--untracked-files=all').splitlines()
        else:
            if args.refresh:
                refs = subprocess.check_output(['git', 'ls-remote', f'https://github.com/{spec["repository"]}.git', 'refs/heads/' + spec['branch']], text=True).split()
                if len(refs) != 2:
                    raise SystemExit('Could not resolve branch: ' + name)
                sha = refs[0]
            if not re.fullmatch(r'[0-9a-f]{40}', sha):
                raise SystemExit('Expected a full commit SHA: ' + name)
            source = snapshot(spec['repository'], sha, cache)
        sources[name] = source
        revisions[name] = {'repository': spec['repository'], 'branch': spec['branch'], 'commit': sha, 'local_override': name in local, 'dirty_files': dirty}
    site = workspace / 'site'
    if site.exists():
        shutil.rmtree(site)  # Generated site inside the marked workspace only.
    site.mkdir()
    for name in ['_quarto.yml', 'index.qmd', 'examples.qmd']:
        shutil.copy2(ROOT / name, site / name)
    shutil.copytree(ROOT / 'assets', site / 'assets')
    shutil.copytree(ROOT / 'examples', site / 'examples')
    hashes = {}
    for name, source in sources.items():
        extension = source / '_extensions' / name
        destination = site / '_extensions' / name
        shutil.copytree(extension, destination)
        hashes[name] = {str(p.relative_to(extension)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(extension.rglob('*')) if p.is_file()}
    for filename, digest in hashes['ai-feedback'].items():
        if filename in ('feedback-core.js', 'feedback-dom.js', 'ai-feedback.js', 'ai-feedback.css'):
            for consumer in ('math-exercise', 'pyodide-interaktiv'):
                if hashes[consumer].get('ai-feedback/' + filename) != digest:
                    raise SystemExit(consumer + ' shared runtime differs: ' + filename + '. Run its scripts/sync-ai-feedback.py with this checkout.')
    result = {'quarto': config['quarto'], 'refresh': args.refresh, 'repositories': revisions, 'extension_sha256': hashes}
    (workspace / 'resolved-repos.json').write_text(json.dumps(result, indent=2) + '\n')
    shutil.copy2(workspace / 'resolved-repos.json', site / 'resolved-repos.json')
    run(['quarto', 'render'], cwd=site, env=base_env)
    if args.test or args.browser:
        env = dict(base_env, CTM_INTEGRATION_SITE=str(site / '_site'), CTM_INTEGRATION_RECORD=str(workspace / 'resolved-repos.json'))
        run(['npm', 'ci', '--ignore-scripts'], cwd=ROOT)
        if args.test:
            run(['npm', 'test'], cwd=ROOT, env=env)
            for consumer in ('math-exercise', 'pyodide-interaktiv'):
                run(['npm', 'ci', '--ignore-scripts'], cwd=sources[consumer])
                run(['npm', 'test'], cwd=sources[consumer], env=env)
            run(['npm', 'run', 'test:integration'], cwd=ROOT, env=env)
        if args.browser:
            run(['npm', 'run', 'test:browser'], cwd=ROOT, env=env)
    print('Common page:', site / '_site' / 'examples.html')
    print('Revision and file record:', workspace / 'resolved-repos.json')
    print('Serve with: python -m http.server 8000 --directory ' + str(site / '_site'))


if __name__ == '__main__':
    main()
