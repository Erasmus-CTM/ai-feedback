# AI Feedback — Quarto extension

Shared browser feedback for text, translation, images, mathematics and Python.
The first release provides text activities and a stable adapter API. Existing
exercise integrations are migrated incrementally, with examples added alongside
each integration. No Python runtime is needed for the text activities.

[Rendered examples](https://erasmus-ctm.github.io/ai-feedback/examples.html)
· [Examples source](examples.qmd) · [API documentation](docs/api.md)

The rendered examples are published by GitHub Actions after Pages is enabled
in the repository settings (see Development below).

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

## API quick start

### Quarto: German source, Norwegian translation, English feedback

The source block is reusable. The short `.ai-context` class, canonical
`.ai-feedback-context`, and legacy `.math-exercise-context` are aliases.
`source="german-original"` gives the referenced block its role in this task.

````markdown
---
lang: en
filters:
  - ai-feedback
---

::: {#german-original .ai-context}
Am Samstag fährt Lena mit dem Zug nach Oslo.
:::

::: {.ai-feedback #translation profile="translation" source="german-original" source-language="de" response-language="nb" feedback-language="en" context="none"}
Translate the German passage into Norwegian Bokmål. Explain improvements
to meaning, phrasing and grammar in English.
:::
````

Use `context="id1,id2"` for additional learning context. `context="none"`
disables automatic context without removing the explicitly selected source.

### Images

Add `image-upload="true" image-role="response"` to an activity for images of
learner work, such as handwritten Spanish. Use `image-role="source"` for a
picture the learner must describe. A response image can replace typed text;
a source image still needs a learner response. Direct feedback requires a
vision-capable model and never silently discards a required image.

### JavaScript: request feedback

When the Quarto extension is enabled, `AIFeedback` is available in the browser:

```js
const request = {
  version: 1,
  profile: 'translation',
  task: 'Translate the German passage into Norwegian Bokmål.',
  materials: [{
    id: 'original', role: 'source', language: 'de',
    text: 'Am Samstag fährt Lena mit dem Zug nach Oslo.'
  }],
  responses: [{
    id: 'translation', format: 'text', language: 'nb',
    value: textarea.value
  }],
  feedback: { language: 'en', mode: 'review', maxIssues: 3,
    allowFullRewrite: false }
};

// Use the website's saved endpoint, model and personal key.
const result = await AIFeedback.getClient().request(request);
// result: { text: '...', format: 'markdown' }

// Or prepare a prompt without making any API request:
const prompt = AIFeedback.buildPrompt(request);
```

`learner: {level}`, `criteria: [string, ...]`, `evidence: [{label, text}, ...]`
and `attachments: [{id, role, label, dataUrl}, ...]` are optional. Image data
URLs must be PNG/JPEG/WebP. Do not include hidden test source, submission
identifiers or credentials in the request. The API does not run code or assign
grades. See [API v1](docs/api.md) for validation limits, hints and error codes.

### Attach an existing editor and button

```js
const adapter = AIFeedback.attach({
  id: 'my-activity',
  button: feedbackButton,
  output: feedbackArea,
  getRequest: () => ({ ...request,
    responses: [{ id: 'translation', format: 'text', language: 'nb',
      value: textarea.value }]
  })
});
buttonBar.append(AIFeedback.settingsButton());
// adapter.cancel(); adapter.dispose();
```

`getRequest()` collects a current snapshot; it must not run learner code.
The adapter handles copy/API mode, cancellation, errors and responses that
became stale during a request. It safely renders feedback Markdown.

### One cogwheel and one setup across the website

Every activity's cogwheel opens the same settings dialog.
`AIFeedback.openSettings()` opens it programmatically. By default one
localStorage record shares base URL, model, personal key and mode across all
pages and tabs on the same origin. Browser storage cannot span different
domains. Per-tab storage remains an optional user choice. Institutions can
provide defaults as shown below; keys are entered only in the browser.

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
