-- Quiz scopes use the same section walker as feedback (AGPL-3.0-or-later).
return function(ctm)
  local M = {}
  local quizzes, byId, membership, sourceMembership = {}, {}, {}, {}
  local prepared = false
  local function clone(list)
    local out = {}
    for i, v in ipairs(list) do out[i] = v end
    return out
  end
  local function snapshot(s)
    return {heads = clone(s.heads), quiz = s.quiz, title = s.title, reveal = s.reveal}
  end
  local function restore(s, t)
    s.heads, s.quiz, s.title, s.reveal = clone(t.heads), t.quiz, t.title, t.reveal
  end
  local function fail(message) ctm.fail(message .. " (" .. ctm.source.pageName() .. ").") end
  local function slot(id, attr)
    attr = attr or pandoc.Attr()
    attr.classes:insert("ctm-progress-slot")
    attr.attributes["data-ctm-quiz"] = id
    return pandoc.Div({}, attr)
  end
  local function start(id, s, title)
    id = tostring(id or ""):match("^%s*(.-)%s*$")
    if id == "" then fail("A quiz needs a nonempty id") end
    if s.reveal > 0 then fail("A quiz cannot start inside a reveal: " .. id) end
    if byId[id] then fail("Duplicate quiz id: " .. id) end
    local q = {id = id, title = title ~= "" and title or id}
    quizzes[#quizzes + 1], byId[id], s.quiz = q, q, id
    return id
  end
  local function label(b)
    if b.identifier and b.identifier ~= "" then return b.identifier end
    return b.attributes.label or (b.text and b.text:match("^#|%s*label:%s*([^\r\n]+)"))
      or (b.text and b.text:match("\n#|%s*label:%s*([^\r\n]+)")) or b.identifier
  end
  function M.prepare(doc)
    if prepared then return doc end
    prepared = true
    local s = {heads = {}, quiz = nil, title = "", reveal = 0}
    local scopes = {}
    local hooks = {}
    hooks.open = function(state, kind)
      local t = snapshot(state)
      scopes[#scopes + 1] = t
      if kind == "details" then state.reveal = state.reveal + 1 end
      return t
    end
    hooks.close = function(state, token)
      restore(state, token)
      scopes[#scopes] = nil
    end
    hooks.tab = function(tab, state)
      -- Sibling tabs restart from the enclosing section, including nested tabs.
      restore(state, scopes[#scopes])
      state.heads, state.title = {}, pandoc.utils.stringify(tab.title or "")
    end
    hooks.header = function(b, state)
      while #state.heads > 0 and state.heads[#state.heads].level >= b.level do
        local old = table.remove(state.heads)
        state.quiz, state.title = old.quiz, old.title
      end
      state.heads[#state.heads + 1] = {level = b.level, quiz = state.quiz, title = state.title}
      state.title = pandoc.utils.stringify(b.content)
      if b.attributes.quiz ~= nil then
        b.attributes["data-ctm-quiz-heading"] = start(b.attributes.quiz, state, state.title)
        b.attributes.quiz = nil
      end
    end
    hooks.block = function(b, state, walk)
      if b.t == "CodeBlock" then
        local source = pandoc.utils.sha1(b.text):sub(1, 16)
        local scope = state.quiz or false
        if sourceMembership[source] ~= nil and sourceMembership[source] ~= scope then
          sourceMembership[source] = false
        else sourceMembership[source] = scope end
        local id = label(b)
        if id and id ~= "" then
          -- Duplicate labels are dealt with by the store; never silently choose
          -- a quiz when the same label appears in different scopes.
          if membership[id] ~= nil and membership[id] ~= (state.quiz or false) then membership[id] = false
          else membership[id] = state.quiz or false end
        end
        return true, b
      end
      if b.t ~= "Div" then return false end
      local reveal = b.classes:includes("reading-step") or b.classes:includes("hint")
        or b.classes:includes("details") or ctm.sections.custom(b, "Proof") ~= nil
      if reveal then
        local old = snapshot(state)
        state.reveal = state.reveal + 1
        b.content = walk(b.content)
        restore(state, old)
        return true, b
      end
      local marker = b.classes:includes("quiz")
      local tab = b.classes:includes("ctm-tab-target") and b.attributes.quiz ~= nil
      if marker or tab then
        if #b.content > 0 then fail("A .quiz marker must be empty") end
        local id = start(tab and b.attributes.quiz or b.identifier, state, state.title)
        b.attributes.quiz = nil
        return true, slot(id, b.attr)
      end
      return false
    end
    doc.blocks = ctm.sections.walk(doc.blocks, hooks, s)
    doc.blocks = doc.blocks:walk({Header = function(h)
      local id = h.attributes["data-ctm-quiz-heading"]
      if not id then return nil end
      h.attributes["data-ctm-quiz-heading"] = nil
      return {h, slot(id)}
    end})
    return doc
  end
  function M.quizFor(id, source)
    -- Components parse their own labels; use their unchanged block hash when
    -- Quarto has not materialized a quoted YAML label on the CodeBlock.
    if membership[id] ~= nil then return membership[id] or nil end
    return sourceMembership[source] or nil
  end
  function M.finalize(exercises)
    local counts = {}
    for _, e in ipairs(exercises) do
      if (e.component == "math-exercise" or e.component == "py-exercise") and e.quiz then
        counts[e.quiz] = (counts[e.quiz] or 0) + 1
      end
    end
    for _, q in ipairs(quizzes) do
      if not counts[q.id] then fail("A quiz has no exercises: " .. q.id) end
    end
    return quizzes
  end
  return M
end
