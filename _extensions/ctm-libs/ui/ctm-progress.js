/* Progress tiles consume build-time data and events only. AGPL-3.0-or-later. */
(function () {
  "use strict";
  const pending = [];
  let dispatch = e => pending.push(e);
  for (const name of ["ctm:result", "ctm:store-restore", "ctm:store-clear"]) {
    document.addEventListener(name, event => dispatch({type: name, detail: event.detail}));
  }
  function init() {
    const node = document.getElementById("ctm-store-manifest");
    if (!node) return;
    let manifest;
    try { manifest = JSON.parse(node.textContent); } catch (_) { return; }
    const messages = manifest.messages || {};
    const text = (key, fallback) => typeof messages[key] === "string" ? messages[key] : fallback;
    const states = new Map(), tiles = new Map(), panels = [];
    const identity = e => typeof e.runtimeId === "string" && e.runtimeId ? e.runtimeId : e.id;
    const key = e => JSON.stringify([e.component, identity(e)]);
    const exercises = (manifest.exercises || []).filter(e =>
      (e.component === "math-exercise" || e.component === "py-exercise") && typeof identity(e) === "string" && identity(e));
    const duplicates = new Set(), seen = new Set();
    // Labels are page-wide DOM identities, including across components.
    for (const e of manifest.exercises || []) {
      if (e.runtimeId || typeof e.id !== "string" || !e.id) continue;
      if (seen.has(e.id)) duplicates.add(e.id);
      seen.add(e.id);
    }
    const findTarget = e => {
      if (e.runtimeId) return [...document.querySelectorAll("[data-ctm-runtime-id]")].find(element =>
        element.getAttribute("data-ctm-runtime-id") === e.runtimeId &&
        element.getAttribute("data-ctm-component") === e.component);
      return [...document.querySelectorAll("[data-ctm-id]")].find(element =>
      element.getAttribute("data-ctm-id") === e.id &&
      element.getAttribute("data-ctm-component") === e.component) || document.getElementById(e.id);
    };
    // Component filters register in batches. Prefer build-time source order;
    // older manifests use rendered roots. Neither path starts Python.
    const rootOrder = new Map([...document.querySelectorAll("[data-ctm-runtime-id], [data-ctm-id], [id]")].map((node, i) => [node, i]));
    const hasSourceOrder = exercises.every(e => Number.isSafeInteger(e.order) && e.order > 0);
    const entries = exercises.filter(e => e.runtimeId || !duplicates.has(e.id)).map((entry, i) => ({
      entry, order: hasSourceOrder ? entry.order : (rootOrder.get(findTarget(entry)) ?? rootOrder.size + i)
    })).sort((a, b) => a.order - b.order).map(row => row.entry);
    const number = n => {
      try { return new Intl.NumberFormat(text("locale", document.documentElement.lang || "en"), {maximumFractionDigits: 3}).format(n); }
      catch (_) { return String(n); }
    };
    const statusText = (key, fallback) => text(key, fallback).replace(/^\s*[✓½✗–]\s*/, "");
    const words = {
      correct: ["✓", statusText("correct", "correct")],
      partial: ["½", statusText("partial", "partly correct")],
      wrong: ["✗", statusText("wrong", "wrong")],
      unattempted: ["–", statusText("unattempted", "not attempted")]
    };
    function update() {
      for (const panel of panels) {
        let score = 0;
        panel.entries.forEach((e, i) => {
          const result = states.get(key(e)), status = result ? result.status : "unattempted";
          const label = words[status], button = tiles.get(key(e));
          const outdated = result && result.outdated ? " (" + text("outdated", "outdated") + ")" : "";
          button.textContent = (i + 1) + ". " + label[0] + " " + label[1] + outdated;
          button.setAttribute("aria-label", text("exercise", "Exercise") + " " + (i + 1) + ": " + label[1] + outdated);
          button.dataset.status = status;
          button.classList.toggle("ctm-progress-outdated", Boolean(result && result.outdated));
          if (result && !result.outdated) score += result.score;
        });
        panel.total.textContent = text("total", "{score} of {count}")
          .replace("{score}", number(score)).replace("{count}", number(panel.entries.length));
      }
    }
    function panel(items, title, slot) {
      if (!items.length || !slot) return;
      const region = document.createElement("section");
      region.className = "ctm-progress";
      region.setAttribute("aria-label", title);
      const heading = document.createElement("p");
      heading.className = "ctm-progress-title";
      heading.textContent = title;
      const total = document.createElement("p");
      total.className = "ctm-progress-total";
      const list = document.createElement("ol");
      // Keep list semantics when native markers are hidden in WebKit.
      list.setAttribute("role", "list");
      items.forEach(e => {
        const li = document.createElement("li"), button = document.createElement("button");
        button.type = "button";
        button.addEventListener("click", async () => {
          // Component roots may have generated DOM ids. Match the shared
          // registration attributes as data, without interpolating a selector.
          const target = findTarget(e);
          if (!target || !window.CTMNav || typeof window.CTMNav.reveal !== "function") return;
          await window.CTMNav.reveal(target);
          // CTMNav owns scrolling and focus, including nested tabs and reveals.
        });
        tiles.set(key(e), button);
        li.append(button); list.append(li);
      });
      region.append(heading, total, list); slot.append(region);
      panels.push({entries: items, total});
    }
    const slots = [...document.querySelectorAll(".ctm-progress-slot[data-ctm-quiz]")];
    for (const q of manifest.quizzes || []) {
      panel(entries.filter(e => e.quiz === q.id), q.title || q.id,
        slots.find(s => s.getAttribute("data-ctm-quiz") === q.id));
    }
    if (manifest.progress) {
      const slot = document.createElement("div");
      slot.className = "ctm-progress-page";
      const bar = document.querySelector(".ctm-save-bar");
      if (bar) bar.after(slot);
      else (document.querySelector("main") || document.body).prepend(slot);
      panel(entries.filter(e => !e.quiz), text("progressTitle", "Page progress"), slot);
    }
    function result(e, outdated) {
      const k = key(e);
      if (!tiles.has(k) || !["correct", "partial", "wrong"].includes(e.status)
        || typeof e.score !== "number" || !Number.isFinite(e.score) || e.score < 0 || e.score > 1) return;
      states.set(k, {status: e.status, score: e.score, outdated: Boolean(outdated)});
      update();
    }
    dispatch = event => {
      const e = event.detail;
      if (event.type === "ctm:result") { if (e) result(e, false); return; }
      if (event.type === "ctm:store-restore") {
        if (!e) return;
        if (e.result) result({component: e.component, id: e.id, runtimeId: e.runtimeId, ...e.result},
          e.outdated || e.state === "changed" || e.state === "withdrawn");
        else { states.delete(key(e)); update(); }
        return;
      }
      const store = window.CTMStore;
      if (e && e.course && store && store.course && e.course !== store.course) return;
      const page = store && store.page;
      const current = typeof page === "function" ? page() : page;
      if (e && e.page && current && e.page !== current) return;
      if (e && e.runtimeId) {
        for (const entry of entries) {
          if (entry.runtimeId === e.runtimeId && (!e.component || entry.component === e.component)) states.delete(key(entry));
        }
      } else if (e && typeof e.id === "string") {
        for (const entry of entries) {
          if (entry.id === e.id && (!e.component || entry.component === e.component)) states.delete(key(entry));
        }
      } else states.clear();
      update();
    };
    for (const event of pending.splice(0)) dispatch(event);
    update(); // No live region on load; tiles are available before Python starts.
  }
  window.CTMLayout.ready(init);
})();
