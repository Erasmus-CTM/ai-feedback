-- Languages of CTM Assessment: one resolver and one message catalogue
-- (locales/<namespace>.js, read here between /*BEGIN-JSON*/ and /*END-JSON*/;
-- the browser runs the same files through locales/ctm-locale.js).
--
--   ctm.locale.resolve(component)        lang, tag, origin   (lang: supported code)
--   ctm.locale.tag(section, key)         tag, origin         (the raw tag, e.g. for feedback-language)
--   ctm.locale.language(namespace, tag)  first language of the tag's chain the namespace supports
--   ctm.locale.text(namespace, key, lang, ...)
--   ctm.locale.use(namespace)            HTML dependencies ctm-locale and ctm-locale-<namespace>
--   ctm.locale.supported(namespace)      {"en", "de", ...} from the catalogue
--   ctm.locale.normalize(tag), ctm.locale.chain(tag)
return function(ctm)
  local M = {}
  local catalogues = {}
  local warned = {}

  -- Where a component's language option lives, and its catalogue.
  local COMPONENTS = {
    ["math-exercise"] = {namespace = "math-exercise", section = "math-exercise", key = "lang"},
    ["py-exercise"] = {namespace = "py-exercise", section = "py-exercise", key = "lang"},
    ["ai-feedback"] = {namespace = "feedback", section = "ai-feedback", key = "ui-language"},
    -- Reveals' titles and the lecture/reading switch (lua/ui.lua).
    ui = {namespace = "ui", section = "ctm-assessment", key = "lang"},
    -- pyodide-interaktiv's cells and status line: pyodide: lang.
    ["pyodide-interaktiv"] = {namespace = "pyodide-interaktiv", section = "pyodide", key = "lang"},
  }

  local function catalogue(namespace)
    if catalogues[namespace] then return catalogues[namespace] end
    assert(type(namespace) == "string" and namespace:match("^[%w%-]+$"), "ctm-libs: invalid catalogue name " .. tostring(namespace))
    local path = ctm.path("locales", namespace .. ".js")
    local file = io.open(path, "r")
    assert(file, "ctm-libs: there is no message catalogue " .. namespace .. " (" .. path .. ")")
    local text = file:read("*a")
    file:close()
    local json = text:match("/%*BEGIN%-JSON%*/(.-)/%*END%-JSON%*/")
    assert(json, "ctm-libs: " .. path .. " has no /*BEGIN-JSON*/ ... /*END-JSON*/ catalogue")
    catalogues[namespace] = quarto.json.decode(json)
    return catalogues[namespace]
  end

  -- Lowercase primary subtag; no -> nb.
  function M.normalize(tag)
    local primary = tostring(tag or ""):lower():gsub("_", "-"):match("^%s*([^%-%s]*)") or ""
    if primary == "no" then return "nb" end
    return primary
  end

  -- Languages to try: nb-NO -> nb, en; nn -> nn, nb, en; de-CH -> de, en.
  function M.chain(tag)
    local primary, list = M.normalize(tag), {}
    if primary ~= "" then list[#list + 1] = primary end
    if primary == "nn" then list[#list + 1] = "nb" end
    if primary ~= "en" then list[#list + 1] = "en" end
    return list
  end

  function M.supported(namespace)
    local list = {}
    for i, lang in ipairs(catalogue(namespace)["$languages"] or {}) do list[i] = lang end
    return list
  end

  function M.language(namespace, tag)
    local supported = {}
    for _, lang in ipairs(M.supported(namespace)) do supported[lang] = true end
    for _, lang in ipairs(M.chain(tag)) do
      if supported[lang] then return lang end
    end
    return "en"
  end

  -- The raw language tag for an option: <section>.<key>, then ctm-assessment.lang,
  -- then Quarto's lang, then "en".
  function M.tag(section, key)
    local value, origin = ctm.settings.string(section, key)
    if value and value ~= "" then return value, origin end
    value, origin = ctm.settings.string("ctm-assessment", "lang")
    if value and value ~= "" then return value, origin end
    local meta = ctm.settings.meta and ctm.settings.meta()
    if meta and meta.lang ~= nil then
      local lang = pandoc.utils.stringify(meta.lang)
      if lang ~= "" then return lang, "lang" end
    end
    return "en", nil
  end

  -- A component's interface language: its own option (math-exercise: lang,
  -- py-exercise: lang; ai-feedback: ui-language), ctm-assessment: lang,
  -- Quarto's lang, en; then the first language of that tag's chain that its
  -- catalogue supports.
  function M.resolve(component)
    local spec = COMPONENTS[component] or {namespace = component, section = component, key = "lang"}
    local tag, origin = M.tag(spec.section, spec.key)
    return M.language(spec.namespace, tag), tag, origin
  end

  local function raw(namespace, lang, key)
    local own = catalogue(namespace)[lang]
    if own and own[key] ~= nil then return own[key], lang end
    local english = catalogue(namespace).en
    assert(english and english[key] ~= nil, "ctm-libs: the catalogue " .. namespace .. " has no message " .. tostring(key))
    if lang ~= "en" and not warned[namespace .. "|" .. lang .. "|" .. key] then
      warned[namespace .. "|" .. lang .. "|" .. key] = true
      quarto.log.warning("ctm-libs: the " .. namespace .. " message " .. key .. " has no " .. lang .. " text; using English.")
    end
    return english[key], "en"
  end

  local function special(entry)
    if type(entry) ~= "table" then return false end
    for key in pairs(entry) do
      if type(key) == "string" and key:sub(1, 1) == "$" then return true end
    end
    return false
  end

  local function fill(text, values)
    return (tostring(text):gsub("{([%a_][%w_%-]*)}", function(name)
      if values[name] == nil then return nil end
      return tostring(values[name])
    end))
  end

  local function compile(namespace, lang, entry, args, depth)
    if not special(entry) then return entry end
    assert(depth < 10, "ctm-libs: $ref chain too deep in " .. namespace)
    if entry["$ref"] then
      local target = tostring(entry["$ref"])
      local ns, key = target:match("^([^%.]+)%.(.+)$")
      local value, used = raw(ns, lang, key)
      return compile(ns, used, value, args, depth + 1)
    end
    local values = {}
    for i, name in ipairs(entry["$args"] or {}) do values[name] = args[i] end
    for name, dataKey in pairs(entry["$lookup"] or {}) do
      local data = raw(namespace, lang, dataKey)
      local value = values[name]
      values[name] = (value ~= nil and data[tostring(value)] ~= nil) and data[tostring(value)] or data["*"]
    end
    if entry["$plural"] then
      local count = values[entry["$plural"]]
      return fill((count == 1) and entry.one or entry.other, values)
    end
    return fill(entry["$t"], values)
  end

  -- One message of `namespace` in `lang` (a supported code), with its arguments.
  -- A key the language lacks falls back to English with one build warning.
  function M.text(namespace, key, lang, ...)
    local entry, used = raw(namespace, lang or "en", key)
    return compile(namespace, used, entry, table.pack(...), 0)
  end

  -- HTML dependencies: the resolver and the common messages (ctm-locale),
  -- then the namespace's catalogue (ctm-locale-<namespace>), all in the head.
  function M.use(namespace)
    ctm.deps.html({name = "ctm-locale", scripts = {"locales/ctm-locale.js", "locales/common.js"}})
    if namespace and namespace ~= "common" then
      catalogue(namespace)
      ctm.deps.html({name = "ctm-locale-" .. namespace, scripts = {"locales/" .. namespace .. ".js"}})
    end
  end

  return M
end
