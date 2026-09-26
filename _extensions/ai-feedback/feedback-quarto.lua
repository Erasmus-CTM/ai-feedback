-- AI Feedback: shared resources, context aliases and plain-text activities.
-- AGPL-3.0-or-later. Context preservation follows math-exercise fc549d2.
local M = {}
local directory = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]")
local counter = 0
local cfg = {}
local language = "en"
local function str(v, fallback)
  if v == nil then return fallback end
  return pandoc.utils.stringify(v)
end
local function json(value)
  return quarto.json.encode(value):gsub("<", "\\u003c"):gsub(">", "\\u003e"):gsub("&", "\\u0026")
end
local function excluded(b, retainActivity)
  local attrs = b.attributes or {}
  if attrs["hidden"] ~= nil or attrs["aria-hidden"] == "true" then return true end
  local style = (attrs.style or ""):lower()
  if style:match("display%s*:%s*none") or style:match("visibility%s*:%s*hidden") then return true end
  for _, class in ipairs(b.classes or {}) do
    if (class == "ai-feedback" and not retainActivity) or class == "ai-feedback-activity" or class == "feedback-criteria" or class == "feedback-starter" or class == "example-author-notes" or class == "ai-feedback-ignore" or class == "hidden" or class:match("^cell%-output") then return true end
  end
  return false
end
local function sourceText(block)
  if excluded(block) then return "" end
  local source = block:walk({
    Math = function(m)
      local display = m.mathtype == "DisplayMath"
      return pandoc.Str((display and "\\[" or "\\(") .. m.text .. (display and "\\]" or "\\)"))
    end,
    traverse = "topdown",
    Div = function(b) if excluded(b) then return {}, false end end,
    Span = function(b) if excluded(b) then return {}, false end end,
    RawBlock = function() return {} end,
    RawInline = function() return {} end,
    CodeBlock = function() return {} end,
  })
  return pandoc.utils.stringify(source):match("^%s*(.-)%s*$")
end
local function preserveMath(block)
  return block:walk({ Math = function(m)
    return pandoc.Span({m}, pandoc.Attr("", {}, {
      ["data-ai-feedback-tex"] = m.text,
      ["data-ai-feedback-display"] = m.mathtype == "DisplayMath" and "true" or "false"
    }))
  end })
end
local function isContext(b)
  return b.t == "Div" and (b.classes:includes("ai-feedback-context") or b.classes:includes("ai-context") or b.classes:includes("math-exercise-context"))
end
local function bounded(blocks)
  local kept, length = {}, 0
  for i = #blocks, 1, -1 do
    local size = utf8.len(blocks[i])
    local sep = #kept > 0 and 1 or 0
    if length + size + sep > 1500 then break end
    table.insert(kept, 1, blocks[i]); length = length + size + sep
  end
  return table.concat(kept, "\n")
end
local function activity(block, context)
  counter = counter + 1
  local attrs = block.attributes
  local id = block.identifier ~= "" and block.identifier or "ai-feedback-" .. counter
  local visible, taskBlocks, materials, criteria = pandoc.Blocks({}), pandoc.Blocks({}), {}, nil
  local profile = attrs["profile"] or "review"
  local starter = ""
  for _, child in ipairs(block.content) do
    if child.t == "Div" and child.classes:includes("feedback-source") then
      table.insert(materials, { id = child.identifier ~= "" and child.identifier or id .. "-source", role = "source", language = attrs["source-language"] or "", text = sourceText(child) })
      visible:insert(preserveMath(child))
    elseif child.t == "Div" and child.classes:includes("feedback-criteria") then
      -- Criteria configure the reviewer; they are not instructions to the learner.
      criteria = criteria or {}
      table.insert(criteria, sourceText(pandoc.Div(child.content)))
    elseif child.t == "Div" and child.classes:includes("feedback-starter") then
      starter = sourceText(pandoc.Div(child.content))
    else
      visible:insert(child); taskBlocks:insert(child)
    end
  end
  local taskParts = {}
  for _, child in ipairs(taskBlocks) do table.insert(taskParts, sourceText(child)) end
  local task = table.concat(taskParts, "\n\n")
  if task == "" then task = profile == "translation" and "Translate the supplied source into the response language." or "Give feedback on the learner's response." end
  local contextMode = attrs["context"] == "none" and "none" or (attrs["context"] and attrs["context"] ~= "auto" and "explicit" or "auto")
  local data = {
    id = id, profile = profile, task = task, materials = materials, criteria = criteria,
    uiLanguage = attrs["ui-language"] or str(cfg["ui-language"], language),
    responseLanguage = attrs["response-language"] or "",
    feedbackLanguage = attrs["feedback-language"] or str(cfg["feedback-language"], language),
    sourceLanguage = attrs["source-language"] or "", sourceRef = attrs["source"],
    learnerLevel = attrs["learner-level"] or "", starter = starter,
    imageUpload = attrs["image-upload"] == "true", imageRole = attrs["image-role"] or "response",
    contextMode = contextMode, contextRefs = attrs["context"] or "", context = contextMode == "auto" and bounded(context) or "",
    maxIssues = tonumber(attrs["max-issues"])
  }
  visible:insert(pandoc.RawBlock("html", '<script type="application/json" class="ai-feedback-data">' .. json(data) .. '</script>'))
  visible:insert(pandoc.RawBlock("html", '<noscript>Enable JavaScript to use this feedback activity.</noscript>'))
  return pandoc.Div(visible, pandoc.Attr(id, {"ai-feedback-activity"}))
end
-- One source-order pass for every integration, before consumers transform cells.
local function walk(blocks, state)
  local out = pandoc.Blocks({})
  for _, b in ipairs(blocks) do
    if excluded(b, true) then
      -- Hidden, generated and author-only content does not change section state.
    elseif b.t == "Header" then
      state.context = {sourceText(b)}
    elseif b.t == "Div" and b.classes:includes("ai-feedback") then
      b = activity(b, state.context)
    elseif b.t == "CodeBlock" then
      b.attributes["data-ai-feedback-context"] = bounded(state.context)
    elseif isContext(b) then
      b = preserveMath(b); b.content = walk(b.content, state)
    elseif b.t == "Div" or b.t == "BlockQuote" then
      b.content = walk(b.content, state)
    elseif b.t == "BulletList" or b.t == "OrderedList" then
      for i, item in ipairs(b.content) do b.content[i] = walk(item, state) end
    elseif b.t == "DefinitionList" then
      for _, item in ipairs(b.content) do
        local term = pandoc.utils.stringify(item[1]); if term ~= "" then table.insert(state.context, term) end
        for i, definition in ipairs(item[2]) do item[2][i] = walk(definition, state) end
      end
    elseif b.t ~= "RawBlock" then
      b = b:walk({CodeBlock = function(code) code.attributes["data-ai-feedback-context"] = bounded(state.context); return code end})
      local text = sourceText(b); if text ~= "" then table.insert(state.context, text) end
    end
    out:insert(b)
  end
  return out
end
-- This callback is a Quarto filter pass, not a Pandoc-only walk.
function M.markCallout(c)
  if c.attr.attributes["data-ai-feedback-marked"] then return c end
  if excluded(pandoc.Div({}, c.attr)) then
    c.content = pandoc.Blocks({pandoc.Div(c.content, pandoc.Attr("", {"ai-feedback-ignore"}))})
    c.title = pandoc.Inlines({pandoc.Span(quarto.utils.as_inlines(c.title or {}), pandoc.Attr("", {"ai-feedback-ignore"}))})
    c.attr.attributes["data-ai-feedback-marked"] = "true"
  end
  return c
end
function M.prepare(doc)
  if not quarto.doc.is_format("html") then return doc end
  if doc.meta["ctm-feedback-prepared"] then return doc end
  doc.meta["ctm-feedback-prepared"] = true
  cfg = doc.meta["ai-feedback"] or {}
  language = str(doc.meta.lang, "en")
  dofile(directory .. "/feedback-policy.lua").emit(doc.meta)
  quarto.doc.add_html_dependency({
    name = "ai-feedback", version = "0.5.0",
    scripts = {directory .. "/feedback-core.js", directory .. "/feedback-dom.js", directory .. "/ai-feedback.js"},
    stylesheets = {directory .. "/ai-feedback.css"}
  })
  quarto.doc.include_text("before-body", '<script>window.__aiFeedbackConfig = ' .. json({ mode = str(cfg.mode, "copy"), storage = str(cfg.storage, "local"), baseUrl = str(cfg["base-url"], ""), model = str(cfg.model, "") }) .. ';</script>')
  doc.blocks = walk(doc.blocks, {context = {}})
  return doc
end

function M.context(block, opts, pyodide)
  local ref = opts["feedback-context"] or opts["context"] or "auto"
  ref = tostring(ref):gsub('^"(.*)"$', '%1'):gsub("^'(.*)'$", "%1")
  if ref == "" or (pyodide and (ref == "setup" or ref == "output" or ref == "interactive")) then ref = "auto" end
  return {mode = ref == "none" and "none" or (ref == "auto" and "auto" or "explicit"),
    refs = ref, text = block.attributes["data-ai-feedback-context"] or ""}
end
return M
