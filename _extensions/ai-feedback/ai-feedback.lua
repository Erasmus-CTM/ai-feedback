-- AI Feedback: shared resources, context aliases and plain-text activities.
-- AGPL-3.0-or-later. Context preservation follows math-exercise fc549d2.
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
local function sourceText(block)
  local source = block:walk({
    Math = function(m)
      local display = m.mathtype == "DisplayMath"
      return pandoc.Str((display and "\\[" or "\\(") .. m.text .. (display and "\\]" or "\\)"))
    end,
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
      criteria = {sourceText(child)}; visible:insert(child)
    elseif child.t == "Div" and child.classes:includes("feedback-starter") then
      starter = sourceText(child)
    else
      visible:insert(child); taskBlocks:insert(child)
    end
  end
  local task = sourceText(pandoc.Div(taskBlocks))
  if task == "" then task = profile == "translation" and "Translate the supplied source into the response language." or "Give feedback on the learner's response." end
  local contextMode = attrs["context"] == "none" and "none" or (attrs["context"] and "explicit" or "auto")
  local data = {
    id = id, profile = profile, task = task, materials = materials, criteria = criteria,
    uiLanguage = attrs["ui-language"] or str(cfg["ui-language"], language),
    responseLanguage = attrs["response-language"] or "",
    feedbackLanguage = attrs["feedback-language"] or str(cfg["feedback-language"], language),
    sourceLanguage = attrs["source-language"] or "", sourceRef = attrs["source"],
    learnerLevel = attrs["learner-level"] or "", starter = starter,
    imageUpload = attrs["image-upload"] == "true", imageRole = attrs["image-role"] or "response",
    contextMode = contextMode, contextRefs = attrs["context"] or "", context = contextMode == "auto" and bounded(context) or "",
    maxIssues = tonumber(attrs["max-issues"] or "3")
  }
  visible:insert(pandoc.RawBlock("html", '<script type="application/json" class="ai-feedback-data">' .. json(data) .. '</script>'))
  visible:insert(pandoc.RawBlock("html", '<noscript>Enable JavaScript to use this feedback activity.</noscript>'))
  return pandoc.Div(visible, pandoc.Attr(id, {"ai-feedback-activity"}))
end
local function walk(blocks, context)
  local out = pandoc.Blocks({})
  for _, b in ipairs(blocks) do
    if b.t == "Header" then
      context = {sourceText(b)}; out:insert(b)
    elseif b.t == "Div" and b.classes:includes("ai-feedback") then
      out:insert(activity(b, context))
    elseif isContext(b) then
      table.insert(context, sourceText(b)); out:insert(preserveMath(b))
    elseif b.t == "Div" or b.t == "BlockQuote" then
      b.content = walk(b.content, context); out:insert(b)
    elseif b.t == "CodeBlock" or b.t == "RawBlock" then out:insert(b)
    else
      local text = sourceText(b); if text ~= "" then table.insert(context, text) end
      out:insert(b)
    end
  end
  return out
end
function Pandoc(doc)
  if not quarto.doc.is_format("html") then return doc end
  cfg = doc.meta["ai-feedback"] or {}
  language = str(doc.meta.lang, "en")
  quarto.doc.add_html_dependency({
    name = "ai-feedback", version = "0.1.0",
    scripts = {"feedback-core.js", "feedback-dom.js", "ai-feedback.js"},
    stylesheets = {"ai-feedback.css"}
  })
  quarto.doc.include_text("before-body", '<script>window.__aiFeedbackConfig = ' .. json({ mode = str(cfg.mode, "copy"), storage = str(cfg.storage, "local"), baseUrl = str(cfg["base-url"], ""), model = str(cfg.model, "") }) .. ';</script>')
  doc.blocks = walk(doc.blocks, {})
  return doc
end
