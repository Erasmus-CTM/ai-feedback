-- Sections of a page, in source order (ctm.sections): what AI feedback's
-- learning context follows (lua/feedback.lua), and what quizzes will follow.
--
-- A section is a heading or a tab. Closed material is a scope: a <details>
-- (raw tags, as reveals are written out by lua/ui.lua) or a collapsed
-- callout. What is inside a scope belongs to it; nothing after it sees it.
--
--   ctm.sections.walk(blocks, hooks, state)   the blocks, as the hooks changed them
--   ctm.sections.tabset(b)                    a Tabset's data ({tabs, attr}) or nil
--   ctm.sections.custom(b, kind)              Quarto's data of a custom node, nil or false
--   ctm.sections.detailsTags(b)               the <details> tags of a raw block (true opens)
--   ctm.sections.collapsed(b)                 whether b is a collapsed callout
--
-- The walk runs in a Pandoc pass, where Quarto's custom nodes (tabsets,
-- callouts) are Divs that hold Quarto's slots.
return function(ctm)
  local M = {}

  -- Quarto's data of a custom node of type `kind` (the table a filter
  -- callback for that type gets; tabs[i].title and tabs[i].content of a
  -- Tabset): nil for any other block, false when it cannot be read.
  function M.custom(b, kind)
    if b.t ~= "Div" or b.attributes["__quarto_custom"] ~= "true" or b.attributes["__quarto_custom_type"] ~= kind then return nil end
    local ok, data = pcall(function() return quarto._quarto.ast.resolve_custom_data(b) end)
    return ok and data or false
  end

  -- A tabset's data (its tabs, attr), or nil. Should a Quarto version keep its
  -- tabs from this filter, the tabset is walked as one block, with a warning:
  -- its exercises' context could then cross tabs.
  local unreadable = false
  function M.tabset(b)
    local data = M.custom(b, "Tabset")
    if data == nil then return nil end
    if data and data.tabs then return data end
    if not unreadable then
      unreadable = true
      quarto.log.warning("ctm-libs cannot read the tabs of a tabset with this Quarto version: the AI context "
        .. "of an exercise in a tab may include other tabs' prose.")
    end
    return nil
  end

  -- The <details> tags of an HTML raw block, in order (true opens one).
  function M.detailsTags(b)
    local tags = {}
    if b.format:match("^html") then
      for slash in b.text:lower():gmatch("<(/?)details[%s>]") do tags[#tags + 1] = slash == "" end
    end
    return tags
  end

  function M.collapsed(b)
    local data = M.custom(b, "Callout")
    local value = data and data.collapse
    return value == true or (type(value) == "string" and value == "true")
  end

  -- Walks `blocks` in source order and returns them. `state` belongs to the
  -- caller; every hook is optional:
  --   skip(b, tabset)          true: pass b through untouched (hidden material)
  --   header(b, state)         a heading starts a section
  --   open(state, kind) -> token     a scope starts (<details>, collapsed callout, tabset)
  --   close(state, token)      ... and ends; a <details> left open ends with its list
  --   tab(tab, state)          a tab starts a section ({title, content})
  --   block(b, state, walk)    -> true, replacement: the hook takes b over
  --                            (walk(blocks) goes on inside; replacement nil drops b)
  --   term(inlines, state)     a definition list's term
  --   leaf(b, state) -> b      any other block (paragraphs, tables, ...)
  -- A tabset is a scope too: after it, its section goes on without its tabs.
  function M.walk(blocks, hooks, state)
    local out = pandoc.Blocks({})
    -- The token of each <details> still open in this list.
    local scopes = {}
    local function open(kind) return hooks.open and hooks.open(state, kind) end
    local function close(token) if hooks.close then hooks.close(state, token) end end
    local function walk(list) return M.walk(list, hooks, state) end
    for _, b in ipairs(blocks) do
      local tabbed = M.tabset(b)
      if hooks.skip and hooks.skip(b, tabbed) then
        -- Hidden, generated and author-only content does not change the sections.
      elseif b.t == "RawBlock" then
        for _, opening in ipairs(M.detailsTags(b)) do
          if opening then
            scopes[#scopes + 1] = open("details")
          elseif #scopes > 0 then
            close(table.remove(scopes))
          end
        end
      elseif b.t == "Header" then
        if hooks.header then hooks.header(b, state) end
      elseif tabbed then
        local token = open("tabset")
        for i = 1, #tabbed.tabs do
          local tab = tabbed.tabs[i]
          if hooks.tab then hooks.tab(tab, state) end
          if tab.content then tab.content = walk(quarto.utils.as_blocks(tab.content)) end
        end
        close(token)
      elseif M.collapsed(b) then
        local token = open("callout")
        b.content = walk(b.content)
        close(token)
      else
        local handled, replacement = false, nil
        if hooks.block then handled, replacement = hooks.block(b, state, walk) end
        if handled then
          b = replacement
        elseif b.t == "Div" or b.t == "BlockQuote" then
          b.content = walk(b.content)
        elseif b.t == "BulletList" or b.t == "OrderedList" then
          for i, item in ipairs(b.content) do b.content[i] = walk(item) end
        elseif b.t == "DefinitionList" then
          for _, item in ipairs(b.content) do
            if hooks.term then hooks.term(item[1], state) end
            for i, definition in ipairs(item[2]) do item[2][i] = walk(definition) end
          end
        elseif hooks.leaf then
          b = hooks.leaf(b, state)
        end
      end
      if b then out:insert(b) end
    end
    if #scopes > 0 then close(scopes[1]) end
    return out
  end

  return M
end
