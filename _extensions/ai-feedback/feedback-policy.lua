-- Shared policy metadata loader; consumers use the installed shared extension.
local M = {}
local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]")
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
local names={['plain-text']=true,['py-exercise']=true,['math-exercise']=true,['pyodide-interaktiv']=true}
function M.emit(meta)
  local cfg=meta['ai-feedback'] or {}
  for _,key in ipairs({'defaults','integrations','policies','exercises'}) do
    if cfg[key]~=nil then fail('ai-feedback: define named policies in YAML files and activate project-policy/page-policy; inline '..key..' is not supported') end
  end
  local function files(value)
    local paths={}
    if value then
      if pandoc.utils.type(value)~='List' then value={value} end
      for _,file in ipairs(value) do
        local name=text(file)
        local base=quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
        table.insert(paths,pandoc.path.is_absolute(name) and name or pandoc.path.join({base,name}))
      end
    end
    return paths
  end
  local function selection(value)
    if value==nil then return nil end
    if type(value)=='table' and pandoc.utils.type(value)=='table' then
      local out={};for key,v in pairs(value) do out[key]=text(v) end;return out
    end
    if type(value)=='boolean' or pandoc.utils.type(value)=='List' then fail('ai-feedback: policy selection needs a policy name or integration mapping') end
    return text(value)
  end
  local input={layers=files(cfg['policy-files']),pageLayers=files(cfg['page-policy-files']),
    projectPolicy=selection(cfg['project-policy']),pagePolicy=selection(cfg['page-policy'])}
  input.projectDirectory=quarto.project.directory
  input.inputFile=quarto.doc.input_file
  input.profiles=quarto.project.profiles
  local parser=directory .. '/read-policies.ts'
  local encoded=pandoc.pipe('quarto',{'run',parser,quarto.json.encode(input)},''):gsub('%s+$','')
  local config=quarto.json.decode(encoded)
  local registry={}
  for _,layers in ipairs({config.layers or {},config.pageLayers or {}}) do
    for _,layer in ipairs(layers) do for name,_ in pairs(layer.policies or {}) do registry[name]=true end end
  end
  _G.ctmFeedbackPolicies=config
  _G.ctmFeedbackPolicyNames=registry
  encoded=encoded:gsub('<','\\u003c'):gsub('>','\\u003e'):gsub('&','\\u0026')
  quarto.doc.include_text('before-body','<script>window.__aiFeedbackPolicies = '..encoded..';</script>')
end
function M.selection(block,opts)
  local name=opts['feedback-policy'] or block.attributes['feedback-policy'] or ''
  if type(name)~='string' then fail('ai-feedback: feedback-policy must name an existing YAML policy') end
  name=name:gsub('^"(.*)"$','%1'):gsub("^'(.*)'$",'%1')
  if name~='' and not (_G.ctmFeedbackPolicyNames or {})[name] then fail('ai-feedback: unknown feedback-policy '..name) end
  local id=opts.label
  if id==nil or id=='' then id=block.identifier or '' end
  id=tostring(id):gsub('^"(.*)"$','%1'):gsub("^'(.*)'$",'%1')
  return {exercise=id,name=name}
end
return M
