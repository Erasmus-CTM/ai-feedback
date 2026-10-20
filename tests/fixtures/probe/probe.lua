-- A CTM component for tests: it loads ctm-libs through the canonical
-- ctm-bootstrap.lua (copied next to it by the tests) and replaces each
--   ```{.ctm-probe #name}
--   return <Lua using ctm, doc, meta>
--   ```
-- block by <script type="application/json" class="ctm-probe" data-name="name">
-- holding the JSON of the values the code returns (a list when several).
-- probe-options.lua next to it, when a test writes one, returns the
-- bootstrap's options ({standalone = ..., api = ...}).
local options = io.open(quarto.utils.resolve_path("probe-options.lua"), "r")
if options then options:close(); options = dofile(quarto.utils.resolve_path("probe-options.lua")) end
local ctm = dofile(quarto.utils.resolve_path("ctm-bootstrap.lua"))("probe", options)

local function evaluate(code, doc)
  local env = setmetatable({ctm = ctm, doc = doc, meta = doc.meta}, {__index = _G})
  local chunk = assert(load(code, "=probe", "t", env))
  local results = table.pack(chunk())
  if results.n <= 1 then return results[1] end
  local list = {}
  for i = 1, results.n do if results[i] == nil then list[i] = "<nil>" else list[i] = results[i] end end
  return list
end

local function encode(value)
  if value == nil then return "null" end
  return (quarto.json.encode(value):gsub("<", "\\u003c"))
end

return {
  {Pandoc = function(doc)
    if not quarto.doc.is_format("html") then return doc end
    if ctm.settings and ctm.settings.load then ctm.settings.load(doc.meta) end
    doc.blocks = doc.blocks:walk({CodeBlock = function(block)
      if not block.classes:includes("ctm-probe") then return nil end
      local value = evaluate(block.text, doc)
      return pandoc.RawBlock("html", '<script type="application/json" class="ctm-probe" data-name="'
        .. block.identifier .. '">' .. encode(value) .. '</script>')
    end})
    return doc
  end},
}
