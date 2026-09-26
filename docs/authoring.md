# Author your first activity

Start with [the rendered examples](https://erasmus-ctm.github.io/ctm-assessment/example.html). Choose the **Plain text** tab. The extension setup is described
separately in [Installation and setup](installation.md).

[Example source — download and open in your editor](https://github.com/Erasmus-CTM/ai-feedback/blob/feature/scoped-policies/example.qmd).
Use GitHub’s **Download raw file** button and open the file in an editor such as
**VS Code**. [Getting all the accompanying files](example-source.md).

## Give students something to work on

Copy this activity into your Quarto page and adapt its task to your lesson.

````markdown
::: {.ai-feedback #morning profile="language-quality" response-language="es" feedback-language="en" learner-level="Spanish course 1"}
Write two sentences about your morning.

::: {.feedback-starter}
Yo vive en Oslo. Por la mañana yo come pan.
:::

::: {.feedback-criteria}
Suggest one useful improvement at a time. Keep the student's meaning
and do not replace the whole response.
:::
:::
````

The first paragraph is the student’s task. The starter fills the response box. The criteria tell the AI what to focus on and are hidden from the student’s task. Replace the languages and level with those for your class.

## Try it as a student

Make a plausible mistake, then correct it. Does the task give enough information?
Does the feedback help with the next step? Try a correct response as well as an
incomplete one. Adjust the instructions until the activity supports the learning
goal you had in mind.

## Choose the kind of help

A *feedback policy* is a named set of instructions for the help you want to offer.
For example, you might want a question during practice and a fuller explanation
afterwards. Put the instructions in a file such as `feedback.yml`:

```yaml
ai-feedback:
  policies:
    gentle-coach:
      max-words: 120
      steps:
        - prompt: Ask one useful question without giving the answer.
        - prompt: Explain the relevant idea and suggest a next step.
```

Load it in the page's front matter:

```yaml
ai-feedback:
  page-policy-files: feedback.yml
```

Select it on the activity with `feedback-policy="gentle-coach"`.
Keep the instructions in YAML; the exercise contains only their name. You can
reuse the same instructions in many activities. Each successful Feedback request
moves to the next hint, and the final hint repeats. A new Check or Run starts
the sequence again by default.

## Help feedback stay close to your lesson

Feedback normally uses nearby explanatory text. Put the method or terminology
you have taught before the activity. For a particular definition or formula,
you can select a named passage instead. Use `context: none` when the activity
should stand on its own (on text activities, write `context="none"`). For
Python exploration, use `feedback-context` to distinguish this from execution
settings. [Detailed context options](reference.md).

## Let students ask for feedback

With the default **Copy prompt** setting, Feedback prepares a message containing
the task and current response. Copy it into an AI chat you already use. For a
reply inside the exercise page, use the AI service arranged for your course;
the connection details are in the [setup guide](installation.md).

[All options](reference.md) · [Project overview](../README.md)
