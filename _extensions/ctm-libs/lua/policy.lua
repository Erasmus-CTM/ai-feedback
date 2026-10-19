-- Teaching policies: the page's policy files and selections, read and
-- validated by the settings reader (ctm.settings.policies()), emitted for the
-- browser as window.__aiFeedbackPolicies, and an exercise's own selection.
return function(ctm)
  local M = {}
  local function fail(message) assert(false, message) end

  -- window.__aiFeedbackPolicies for the browser (once per page, by feedback.prepare).
  function M.emit()
    local encoded = ctm.settings.policies().json:gsub('<', '\\u003c'):gsub('>', '\\u003e'):gsub('&', '\\u0026')
    quarto.doc.include_text('before-body', '<script>window.__aiFeedbackPolicies = ' .. encoded .. ';</script>')
  end

  -- {exercise = label or id, name = selected policy}; the name must be defined.
  function M.selection(block, opts)
    local name = opts['feedback-policy'] or block.attributes['feedback-policy'] or ''
    if type(name) ~= 'string' then fail('ai-feedback: feedback-policy must name an existing YAML policy') end
    name = name:gsub('^"(.*)"$', '%1'):gsub("^'(.*)'$", '%1')
    if name ~= '' and not ctm.settings.policies().names[name] then fail('ai-feedback: unknown feedback-policy ' .. name) end
    local id = opts.label
    if id == nil or id == '' then id = block.identifier or '' end
    id = tostring(id):gsub('^"(.*)"$', '%1'):gsub("^'(.*)'$", '%1')
    return {exercise = id, name = name}
  end

  -- A build without AI feedback and the exercises that only AI feedback can
  -- assess: ai-feedback: without-ai, read key by key like every setting.
  --   unset       the build stops; one error names every such exercise of the page
  --   text        the question stays, without answer box and Check button
  --   self-check  the question and its model answer to compare with; no
  --               exercise has a model answer yet, so for now it is text
  --   drop        the exercise is removed (only where the author writes it)
  -- Returns the choice (nil when unset) and where it is set.
  local WITHOUT_AI = {'text', 'self-check', 'drop'}
  function M.withoutAI()
    return ctm.settings.choice('ai-feedback', 'without-ai', WITHOUT_AI)
  end

  -- What a build without AI feedback does with such an exercise: "stop",
  -- "text" or "drop". Under self-check an exercise without a model answer
  -- is text, and none has one yet.
  function M.withoutAIAction()
    local choice = M.withoutAI()
    if choice == nil then return 'stop' end
    if choice == 'self-check' then return 'text' end
    return choice
  end

  return M
end
