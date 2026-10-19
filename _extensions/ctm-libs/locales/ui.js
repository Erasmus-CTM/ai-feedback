/* CTM Assessment message catalogue: ui. Edit the JSON only (scripts/check-locales.py).
 * Reveals' default titles and the lecture/reading switch (lua/ui.lua writes
 * them into the page). The status texts are the courses' texts (nb, en). */
CTMLocales.add("ui",
/*BEGIN-JSON*/
{"$languages": ["en", "de", "nb", "nn"],
 "en": {
  "readingStep": "Go deeper",
  "solution": "Solution",
  "hint": "Hint",
  "details": "Details",
  "modesLabel": "Choose reading mode",
  "modeLecture": "Explore",
  "modeReading": "Go deeper",
  "statusLecture": "Explore: experiment and discuss. Open explanations when needed.",
  "statusReading": "Go deeper: try it yourself, then follow the explanations step by step."
 },
 "de": {
  "readingStep": "Vertiefung",
  "solution": "Lösungsvorschlag",
  "hint": "Hinweis",
  "details": "Details",
  "modesLabel": "Lesemodus wählen",
  "modeLecture": "Vortrag",
  "modeReading": "Vertiefung",
  "statusLecture": "Vortrag: Experimente und Diskussion. Vertiefungen bei Bedarf öffnen.",
  "statusReading": "Vertiefung: selbst ausprobieren und den Erklärungen Schritt für Schritt folgen."
 },
 "nb": {
  "readingStep": "Gå i dybden",
  "solution": "Løsningsforslag",
  "hint": "Hint",
  "details": "Detaljer",
  "modesLabel": "Velg lesemodus",
  "modeLecture": "Forelesning",
  "modeReading": "Gå i dybden",
  "statusLecture": "Forelesning: eksperimenter og diskusjon. Åpne utdypningene ved behov.",
  "statusReading": "Gå i dybden: prøv selv, og følg forklaringene steg for steg."
 },
 "nn": {
  "readingStep": "Gå i djupna",
  "solution": "Løysingsforslag",
  "hint": "Hint",
  "details": "Detaljar",
  "modesLabel": "Vel lesemodus",
  "modeLecture": "Førelesing",
  "modeReading": "Gå i djupna",
  "statusLecture": "Førelesing: eksperiment og diskusjon. Opne utdjupingane ved behov.",
  "statusReading": "Gå i djupna: prøv sjølv, og følg forklaringane steg for steg."
 }}
/*END-JSON*/
);
