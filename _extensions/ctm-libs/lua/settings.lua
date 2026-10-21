-- CTM settings, key by key (F-79): every CTM section (ai-feedback,
-- ctm-assessment, math-exercise, py-exercise, pyodide) is read by read-settings.ts
-- from _quarto.yml, the profiles, _quarto.yml.local, the _metadata.yml files
-- and the page, plus Quarto's merged metadata, so a page that sets one key of
-- a section keeps the project's other keys.
--
--   ctm.settings.load(meta)                          every entry point, once per page
--   ctm.settings.get(section, key, opts)             value, origin, section
--   ctm.settings.string / bool / number / choice / list (typed; see below)
--   ctm.settings.policies()                          {json = ..., names = {[name] = true}}
--
-- opts.shared: fall back to ctm-assessment.<key> (stop-after, lang); a
-- component's own spelling wins at any level. opts.default: value when unset.
--
-- The reader runs once per page, on the first value asked for, and only on
-- HTML pages whose metadata has a CTM section: without one, no level sets a
-- CTM key (Quarto merges every level into the page's metadata), and every
-- value is its default.
return function(ctm)
  local M = {}

  -- pyodide: pyodide-interaktiv's options (step 3); it reads them on HTML
  -- pages only, and `meta.pyodide` as before in other formats.
  M.SECTIONS = {"ai-feedback", "ctm-assessment", "math-exercise", "py-exercise", "pyodide"}
  local EMPTY_POLICIES = '{"layers":[],"pageLayers":[]}'

  local pageMeta = nil
  local result = nil

  -- Metadata value -> JSON value. Text keeps its mathematics as \(...\) / \[...\].
  local function plain(value)
    local kind = pandoc.utils.type(value)
    if kind == "boolean" or kind == "number" or kind == "string" then return value end
    if kind == "Inlines" or kind == "Blocks" then
      value = (kind == "Inlines" and pandoc.Span(value) or pandoc.Div(value)):walk({
        Math = function(m)
          local display = m.mathtype == "DisplayMath"
          return pandoc.Str((display and "\\[" or "\\(") .. m.text .. (display and "\\]" or "\\)"))
        end,
        RawInline = function(raw) return pandoc.Str(raw.text) end,
        RawBlock = function(raw) return pandoc.Plain({pandoc.Str(raw.text)}) end,
        Code = function(code) return pandoc.Str("`" .. code.text .. "`") end,
      })
      return pandoc.utils.stringify(value)
    end
    if kind == "List" then
      local out = {}
      for i, item in ipairs(value) do out[i] = plain(item) end
      return out
    end
    if kind == "table" or kind == "Meta" then
      local out = {}
      for key, item in pairs(value) do out[key] = plain(item) end
      return out
    end
    return pandoc.utils.stringify(value)
  end

  function M.load(meta)
    if pageMeta == nil then pageMeta = meta end
  end

  function M.loaded()
    return pageMeta ~= nil
  end

  -- The page's metadata as recorded by load().
  function M.meta()
    return pageMeta
  end

  local function hasSection(meta)
    for _, section in ipairs(M.SECTIONS) do
      if meta[section] ~= nil then return true end
    end
    return false
  end

  local function run()
    local documentMeta = {}
    for _, section in ipairs(M.SECTIONS) do
      if pageMeta[section] ~= nil then documentMeta[section] = plain(pageMeta[section]) end
    end
    local input = {projectDirectory = quarto.project.directory, inputFile = quarto.doc.input_file,
      profiles = quarto.project.profile, sections = M.SECTIONS, documentMeta = documentMeta}
    -- Use the running Quarto, which need not be on PATH (IDE-bundled installations).
    local cli = (quarto.config and quarto.config.cli_path and quarto.config.cli_path()) or "quarto"
    -- The input travels on stdin: it can hold credentials an author put in
    -- metadata by mistake, and command lines are visible to other local users.
    local ok, output = pcall(pandoc.pipe, cli, {"run", ctm.path("read-settings.ts")}, quarto.json.encode(input))
    if not ok then ctm.fail("ctm-libs: the settings reader failed: " .. tostring(output)) end
    local decoded = quarto.json.decode((output:gsub("%s+$", "")))
    for _, warning in ipairs(decoded.warnings or {}) do quarto.log.warning(warning) end
    if decoded.errors and #decoded.errors > 0 then ctm.fail(table.concat(decoded.errors, "\n")) end
    return decoded
  end

  local function read()
    if result then return result end
    if not quarto.doc.is_format("html") then
      result = {settings = {}, policies = EMPTY_POLICIES, policyNames = {}}
      return result
    end
    assert(pageMeta, "ctm-libs: a CTM setting was read before ctm.settings.load(meta) on this page. "
      .. "Every CTM filter calls ctm.settings.load (or ctm.feedback.prepare) first.")
    if hasSection(pageMeta) then
      result = run()
    else
      result = {settings = {}, policies = EMPTY_POLICIES, policyNames = {}}
    end
    result.settings = result.settings or {}
    return result
  end

  local function entry(section, key)
    local values = read().settings[section]
    local found = values and values[key]
    if found ~= nil and found.value ~= nil then return found.value, found.origin, section end
  end

  -- The reader's record of section.key ({value, origin, ...}), or nil.
  function M.entry(section, key)
    local values = read().settings[section]
    return values and values[key] or nil
  end

  -- value, origin, section (where the value was found); opts.default when unset.
  function M.get(section, key, opts)
    opts = opts or {}
    local value, origin, where = entry(section, key)
    if value == nil and opts.shared and section ~= "ctm-assessment" then value, origin, where = entry("ctm-assessment", key) end
    if value == nil then return opts.default, nil, nil end
    return value, origin, where
  end

  local function show(value)
    if type(value) == "table" then return quarto.json.encode(value) end
    return tostring(value)
  end
  local function found(value, origin)
    return "(found " .. show(value) .. (origin and (" in " .. origin) or "") .. ")"
  end
  local function text(value)
    if type(value) ~= "table" then return tostring(value) end
    local parts = {}
    for _, item in ipairs(value) do parts[#parts + 1] = text(item) end
    return table.concat(parts)
  end
  local function oneOf(values)
    if #values == 1 then return values[1] end
    return table.concat(values, ", ", 1, #values - 1) .. " or " .. values[#values]
  end

  -- A string (lists are joined, as pandoc.utils.stringify did).
  function M.string(section, key, opts)
    local value, origin, where = M.get(section, key, opts)
    if value == nil then return nil end
    return text(value), origin, where
  end

  -- true or false (also the strings "true"/"false"). Anything else stops the
  -- render, or with opts.loose warns and uses opts.default (values that
  -- were accepted loosely before 0.9). opts.digits also takes 1 and 0
  -- (numbers or strings) and true/false in any case: the values that an
  -- option written into a page's script, or compared case-insensitively,
  -- meant before (pyodide-interaktiv's on/off keys).
  local warned = {}
  local DIGITS = {["true"] = true, ["1"] = true, ["false"] = false, ["0"] = false}
  function M.bool(section, key, opts)
    opts = opts or {}
    local value, origin, where = M.get(section, key, opts)
    if value == true or value == "true" then return true, origin, where end
    if value == false or value == "false" then return false, origin, where end
    if value == nil then return opts.default, origin, where end
    if opts.digits then
      local digit = type(value) == "number" and ((value == 1 and "1") or (value == 0 and "0"))
        or (type(value) == "string" and value:lower()) or nil
      if digit ~= nil and DIGITS[digit] ~= nil then return DIGITS[digit], origin, where end
    end
    local message = (where or section) .. ": " .. key .. " must be true or false"
      .. (opts.digits and " (or 1 or 0) " or " ") .. found(value, origin)
    if not opts.loose then ctm.fail(message) end
    if not warned[section .. "." .. key] then
      warned[section .. "." .. key] = true
      quarto.log.warning(message .. "; using " .. tostring(opts.default) .. ". This becomes an error in CTM Assessment 1.0.")
    end
    return opts.default, origin, where
  end

  -- A number; opts.positive requires > 0, opts.unit names it ("seconds").
  function M.number(section, key, opts)
    opts = opts or {}
    local value, origin, where = M.get(section, key, opts)
    if value == nil then return nil end
    local number = tonumber(type(value) == "table" and "" or tostring(value))
    if not number or (opts.positive and number <= 0) then
      ctm.fail((where or section) .. ": " .. key .. " must be a number" .. (opts.unit and (" of " .. opts.unit) or "")
        .. (opts.positive and " greater than 0" or "") .. " " .. found(value, origin))
    end
    return number, origin, where
  end

  -- One of `values` (strings; true/false count as "true"/"false").
  function M.choice(section, key, values, opts)
    opts = opts or {}
    local value, origin, where = M.get(section, key, opts)
    if value == nil then return nil end
    local chosen = type(value) == "boolean" and tostring(value) or text(value)
    for _, allowed in ipairs(values) do
      if chosen == allowed then return chosen, origin, where end
    end
    ctm.fail((where or section) .. ": " .. key .. " must be " .. oneOf(values) .. " " .. found(value, origin))
  end

  -- A list of trimmed, non-empty strings, from a YAML list or a comma-separated string.
  function M.list(section, key, opts)
    opts = opts or {}
    local value, origin, where = M.get(section, key, opts)
    local out = {}
    if value == nil then return out, origin, where end
    local items = type(value) == "table" and value or {}
    if type(value) ~= "table" then
      for item in tostring(value):gmatch("[^,]+") do items[#items + 1] = item end
    end
    for _, item in ipairs(items) do
      local trimmed = text(item):match("^%s*(.-)%s*$")
      if trimmed ~= "" then out[#out + 1] = trimmed end
    end
    return out, origin, where
  end

  -- The page's teaching policies for the browser contract
  -- ({layers, pageLayers, projectPolicy, pagePolicy}) and their names.
  function M.policies()
    local current = read()
    if not current.names then
      current.names = {}
      for _, name in ipairs(current.policyNames or {}) do current.names[name] = true end
    end
    return {json = current.policies or EMPTY_POLICIES, names = current.names}
  end

  return M
end
