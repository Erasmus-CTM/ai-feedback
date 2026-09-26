#!/usr/bin/env python3
"""Generate embedded browser defaults from feedback-defaults.yml (requires PyYAML)."""
import argparse, json, re
from pathlib import Path
import yaml
p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');args=p.parse_args()
root=Path(__file__).resolve().parents[1]/'_extensions/ai-feedback'
data=yaml.safe_load((root/'feedback-defaults.yml').read_text())['ai-feedback']
f=root/'feedback-core.js';old=f.read_text()
new=re.sub(r'(// BEGIN GENERATED FEEDBACK DEFAULTS\n).*?(\n  // END GENERATED FEEDBACK DEFAULTS)',lambda m:m[1]+'  const shippedPolicies = '+json.dumps(data,ensure_ascii=False)+';'+m[2],old,flags=re.S)
if args.check:
    if new != old: raise SystemExit('Run python scripts/sync-feedback-defaults.py')
else:f.write_text(new)
