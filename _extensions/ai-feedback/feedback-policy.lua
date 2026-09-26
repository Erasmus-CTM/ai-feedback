-- Shared policy metadata loader; consumers use the installed shared extension.
local M = {}
local function fail(message) assert(false, message) end
local function text(value)
  if type(value) == 'string' then return value end
  -- Metadata strings are Pandoc inlines: retain mathematical source explicitly.
  local t = pandoc.utils.type(value)
  if t == 'Inlines' or t == 'Blocks' then
    value = (t == 'Inlines' and pandoc.Span(value) or pandoc.Div(value)):walk({Math = function(m)
      return pandoc.Str((m.mathtype == 'DisplayMath' and '\\[' or '\\(') .. m.text .. (m.mathtype == 'DisplayMath' and '\\]' or '\\)'))
    end, RawInline = function(raw) return pandoc.Str(raw.text) end,
    RawBlock = function(raw) return pandoc.Plain({pandoc.Str(raw.text)}) end,
    Code = function(code) return pandoc.Str('`'..code.text..'`') end})
  end
  return pandoc.utils.stringify(value)
end
local keys = {prompt='string', language='string', ['max-words']='number', ['max-issues']='number', ['allow-full-solution']='boolean', ['reset-on-run']='boolean', steps='list'}
local function policy(value, where, step)
  if type(value) ~= 'table' or pandoc.utils.type(value) ~= 'table' then fail('ai-feedback: '..where..' must be a mapping') end
  local out = {}
  for key, v in pairs(value) do
    local kind = keys[key]
    if not kind or (step and (key == 'steps' or key == 'language' or key == 'reset-on-run')) then fail('ai-feedback: unknown policy option '..where..'.'..key) end
    if kind == 'list' then
      if pandoc.utils.type(v) ~= 'List' then fail('ai-feedback: '..where..'.steps must be a list') end
      if #v > 20 then fail('ai-feedback: at most 20 steps are allowed') end
      out.steps = {}
      for i, entry in ipairs(v) do
        local item = policy(entry, where..'.steps['..i..']', true)
        if not item.prompt then fail('ai-feedback: each step needs a prompt') end
        table.insert(out.steps, item)
      end
    elseif kind == 'boolean' then
      if type(v) ~= 'boolean' then fail('ai-feedback: '..where..'.'..key..' must be true or false') end
      out[key] = v
    elseif kind == 'number' then
      local n = tonumber(text(v))
      local minimum, maximum = key == 'max-words' and 20 or 1, key == 'max-words' and 2000 or 20
      if not n or n % 1 ~= 0 or n < minimum or n > maximum then fail('ai-feedback: invalid '..where..'.'..key) end
      out[key] = n
    else
      if type(v) == 'boolean' or (type(v) == 'table' and pandoc.utils.type(v) ~= 'Inlines' and pandoc.utils.type(v) ~= 'Blocks') then fail('ai-feedback: '..where..'.'..key..' must be text') end
      out[key] = text(v)
      if not out[key]:match('%S') then fail('ai-feedback: '..where..'.'..key..' must not be empty') end
    end
  end
  return out
end
local names = {['non-python']=true, ['py-exercise']=true, ['math-exercise']=true, ['pyodide-interaktiv']=true}
local function layer(cfg)
  local out = {}
  if cfg.defaults ~= nil then local p = policy(cfg.defaults, 'defaults'); if next(p) then out.defaults = p end end
  if cfg.integrations ~= nil then
    if type(cfg.integrations) ~= 'table' or pandoc.utils.type(cfg.integrations) ~= 'table' then fail('ai-feedback: integrations must be a mapping') end
    local integrations = {}
    for name, value in pairs(cfg.integrations) do
      if not names[name] then fail('ai-feedback: unknown integration '..name) end
      local p = policy(value, name)
      if next(p) then integrations[name] = p end
    end
    if next(integrations) then out.integrations = integrations end
  end
  for _, section in ipairs({'policies', 'exercises'}) do
    if cfg[section] ~= nil then
      if type(cfg[section]) ~= 'table' or pandoc.utils.type(cfg[section]) ~= 'table' then fail('ai-feedback: '..section..' must be a mapping') end
      out[section] = {}
      for name, value in pairs(cfg[section]) do
        if section == 'policies' then
          local entry = policy(value, section..'.'..name)
          if not next(entry) then fail('ai-feedback: named policy '..name..' must define at least one option') end
          out[section][name] = entry
        else
          if not names[name] then fail('ai-feedback: unknown integration '..name) end
          if type(value) ~= 'table' or pandoc.utils.type(value) ~= 'table' then fail('ai-feedback: exercises.'..name..' must be a mapping') end
          out[section][name] = {}
          for id, entry in pairs(value) do
            local p = policy(entry, 'exercises.'..name..'.'..id)
            if not next(p) then fail('ai-feedback: exercise policy '..name..'.'..id..' must define at least one option') end
            out[section][name][id] = p
          end
          if not next(out[section][name]) then out[section][name] = nil end
        end
      end
      if not next(out[section]) then out[section] = nil end
    end
  end
  return next(out) and out or nil
end
function M.emit(meta)
  local cfg = meta['ai-feedback'] or {}
  local function readFiles(files)
  local layers = {}
  if files then
    if pandoc.utils.type(files) ~= 'List' then files = {files} end
    for _, file in ipairs(files) do
      local name = text(file)
      local base = quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
      local path = pandoc.path.is_absolute(name) and name or pandoc.path.join({base, name})
      local f = io.open(path, 'r')
      if not f then fail('ai-feedback: cannot open policy file '..path) end
      local raw = f:read('*a'); f:close()
      raw = raw:gsub('^%-%-%-%s*\n', ''):gsub('\n%-%-%-%s*$', '')
      local parsed = pandoc.read('---\n'..raw..'\n---\n', 'markdown+tex_math_single_backslash').meta
      local data = parsed['ai-feedback']
      if not data then fail('ai-feedback: policy file must contain an ai-feedback mapping: '..name) end
      for key, _ in pairs(data) do if key ~= 'defaults' and key ~= 'integrations' and key ~= 'policies' and key ~= 'exercises' then fail('ai-feedback: unknown policy file section: '..key) end end
      local result = layer(data); if result then table.insert(layers, result) end
    end
  end
  return layers
  end
  local layers = readFiles(cfg['policy-files'])
  local pageLayers = readFiles(cfg['page-policy-files'])
  if cfg.policies or cfg.exercises then fail('ai-feedback: policies and exercises must be defined in external YAML policy files') end
  local inline = layer({defaults=cfg.defaults, integrations=cfg.integrations}); if inline then table.insert(layers, inline) end
  _G.ctmFeedbackPolicies = {layers=layers, pageLayers=pageLayers}
  local encoded = quarto.json.encode(_G.ctmFeedbackPolicies):gsub('<','\\u003c'):gsub('>','\\u003e'):gsub('&','\\u0026')
  quarto.doc.include_text('before-body','<script>window.__aiFeedbackPolicies = '..encoded..';</script>')
end
function M.selection(block, opts)
  local name = opts['feedback-policy'] or block.attributes['feedback-policy'] or ''
  if type(name) ~= 'string' then fail('ai-feedback: feedback-policy must name an existing YAML policy, not contain inline settings') end
  name = name:gsub('^"(.*)"$', '%1'):gsub("^'(.*)'$", '%1')
  if name ~= '' then
    local found = false
    local config = _G.ctmFeedbackPolicies or {}
    for _, layers in ipairs({config.layers or {}, config.pageLayers or {}}) do
      for _, item in ipairs(layers) do if item.policies and item.policies[name] then found = true end end
    end
    if not found then fail('ai-feedback: unknown feedback-policy '..name..'; define it in a policy YAML file') end
  end
  local id = opts.label
  if id == nil or id == '' then id = block.identifier or '' end
  id = tostring(id):gsub('^"(.*)"$', '%1'):gsub("^'(.*)'$", '%1')
  return {exercise=id, name=name}
end
return M
