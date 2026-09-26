# Development and builds

[Start here](../README.md) · [Authoring guide](authoring.md)

## Development

```sh
npm ci
npm test
python -m pip install PyYAML==6.0.2
python scripts/sync-feedback-defaults.py --check
```

Edit `feedback-defaults.yml`, then run `python scripts/sync-feedback-defaults.py`
to regenerate the embedded browser policy. This repository tests the shared
runtime and API. It does not own consumer examples, installation assembly or site
deployment: those live in [ctm-assessment](https://github.com/Erasmus-CTM/ctm-assessment).
That repository pins consumer branches and runs Quarto and real-browser gates.

