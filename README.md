# AI Feedback — Quarto extension

Shared browser feedback for text, translation, images, mathematics and Python.
The first release provides text activities and a stable adapter API. Existing
exercise integrations are migrated incrementally, with examples added alongside
each integration. No Python runtime is needed for the text activities.

## Install

```sh
quarto add Erasmus-CTM/ai-feedback
```

```yaml
filters:
  - ai-feedback
ai-feedback:
  mode: copy
  storage: local
```

Use **Feedback settings** to switch between a copyable prompt and direct API
feedback. API requests use a personal key supplied in the browser. No key is
needed for Copy prompt mode. Selected text and images are sent to the selected
provider only when you request direct feedback. Uploaded images are kept in
memory, never in browser storage. Copy prompt requires attaching the original
images separately in your chosen chat application.

## Author an activity

```markdown
::: {.ai-feedback #spanish profile="language-quality" response-language="es" feedback-language="en" learner-level="Spanish course 1"}
Write five sentences about your daily routine.
:::
```

For translation, supply an original source using a nested `.feedback-source`
block or `source="block-id"`. Mark referenced blocks `.ai-feedback-context`;
the existing `.math-exercise-context` class is a permanent alias.

See [examples.qmd](examples.qmd), [the API contract](docs/api.md), and
[the migration plan](docs/migration.md). New features must bring a working
example and a regression test. Examples use copy mode initially so they work
without credentials; live provider replies are never simulated.

## Institution configuration

No provider presets are bundled. Institutions can prefill their own endpoint
and model in `_quarto.yml` (never an API key):

```yaml
ai-feedback:
  base-url: https://your-institution.example/v1
  model: your-model-id
  mode: copy
  storage: local
```

For NTNU, the documented base URL is `https://llm.hpc.ntnu.no/v1`;
`moonshotai/Kimi-K2.6` accepts text and images.
Access requires the NTNU network or VPN and a personal API key. Browser CORS
access must also be allowed by the server; the public examples cannot establish
a VPN connection for the student. The provider and model remain editable.

Source: [NTNU LLM API instructions](https://www.hpc.ntnu.no/idun/documentation/ai-coding-assistant-and-large-language-models-llms-on-idun/), checked 2026-09-25.

## Development

```sh
npm ci
npm test
quarto render
npm run test:render
```

CI runs the tests and renders the examples on pull requests. A successful main
build deploys the examples through GitHub Pages. Set the repository's Pages
source to **GitHub Actions**. Provider access is not needed by CI; transport
tests explicitly use mocked HTTP responses.

## License

AGPL-3.0-or-later. Shared rendering, context serialization and model-policy code
are derived from Erasmus-CTM/math-exercise (fc549d2) and feedback interface ideas
from Erasmus-CTM/pyodide-interaktiv (f815bc2), under the same license.
