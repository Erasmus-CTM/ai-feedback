-- Reveals, the lecture/reading switch, embedded pages, links into tabs and
-- the Markdown lint of CTM Assessment pages (ctm.ui; P18, F1, F2). Authors
-- write Markdown only:
--
--   ::: {.reading-step title="Gå i dybden: …"}   follows the lecture/reading switch
--   ::: {.hint}   ::: {.solution}   ::: {.details title="…"}   closed until opened
--   ::: {.modes}                                  places the switch (else the top of the page)
--   ::: {.embed src="…" title="…" height="…"}     an embedded page
--
-- ctm.filters() runs these passes after the settings are loaded and before AI
-- feedback's preparation. A reveal becomes raw <details> and <summary> tags
-- around a Div that holds its content, so headings inside it stay inside it,
-- and the context walk meets the same scope as for hand-written <details>
-- (lua/sections.lua). Pages without the syntax are unchanged, except that a
-- page with a tabset loads the tab links (ui/ctm-nav.js; ctm-assessment:
-- tab-links: false turns them off).
--
-- For maintainer tools (ctm-assessment's migrate-course-html.py), also outside
-- a render (docs/api.md), the rules that markdown-lint and the reveals apply:
--
--   ctm.ui.rawHTML(lines)            the raw HTML markdown-lint names in one file's lines
--                                    (ctm.source.read): {{rule = "details" | "anchor" |
--                                    "iframe" | "switch", line = n, text = …, raw = …}}, in order
--   ctm.ui.defaultTitle(kind, lang)  the title a reveal of `kind` ("reading-step", "hint",
--                                    "solution", "details") shows without title=, in `lang`
--                                    (a language of the ui catalogue: ctm.locale.language("ui", tag))
return function(ctm)
  local M = {}

  -- The classes of reveals that are Divs; .solution arrives as Quarto's Proof.
  local KINDS = {"reading-step", "hint", "details"}
  local DEFAULT_TITLE = {["reading-step"] = "readingStep", hint = "hint", solution = "solution", details = "details"}
  -- What pass 1 found on the page.
  local page = {reveals = 0, readingSteps = 0, embeds = 0, markers = {}, tabsets = 0, untitled = 0}

  local function html() return quarto.doc.is_format("html") end
  local fail = ctm.fail
  local function escape(value)
    return (tostring(value):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"))
  end

  local lang = nil
  local function text(key)
    if not lang then lang = ctm.locale.resolve("ui") end
    return ctm.locale.text("ui", key, lang)
  end

  function M.defaultTitle(kind, language)
    local key = DEFAULT_TITLE[kind]
    if not key then error("ctm.ui.defaultTitle: no reveal kind " .. tostring(kind), 2) end
    return ctm.locale.text("ui", key, language)
  end

  -- The kind's default title in the page's language.
  local function defaultTitle(kind)
    if not lang then lang = ctm.locale.resolve("ui") end
    return M.defaultTitle(kind, lang)
  end

  -- Where the source writes fenced divs of `class` ("file:line, ..."; only
  -- those without a value for `lacking`, when given), or the page's name.
  local function places(class, lacking)
    local found = {}
    for _, fence in ipairs(ctm.source.fences(class)) do
      local pattern = lacking and ("[%s{]" .. lacking .. "%s*=%s*[\"']?[^\"'%s}]")
      if not (pattern and fence.attributes:match(pattern)) then found[#found + 1] = fence.where end
    end
    return #found > 0 and table.concat(found, ", ") or ctm.source.pageName()
  end

  -- A title attribute is inline Markdown: what would start a block there
  -- ("2. forsøk", "(a) …", "- …", "# …", "> …", "% …") is text. Anything that
  -- still reads as more than one paragraph is shown as written. Pandoc has
  -- already applied backslash escapes to attribute values:
  -- title="$\\mathbf{A}$" arrives as $\mathbf{A}$ (and title="$a\,b$" as $a,b$).
  local function markdown(value)
    local written = value and value:match("^%s*(.-)%s*$") or ""
    if written == "" then return nil end
    local inline = written:gsub("^([%w@]+)([%.%)])(%s)", "%1\\%2%3"):gsub("^%(([%w@]+)%)(%s)", "\\(%1)%2")
      :gsub("^([%-+*])(%s)", "\\%1%2"):gsub("^([#>%%|:])", "\\%1")
    local blocks = pandoc.read(inline, "markdown").blocks
    if #blocks == 1 and (blocks[1].t == "Para" or blocks[1].t == "Plain") and #blocks[1].content > 0 then
      return blocks[1].content
    end
    return pandoc.Inlines(written)
  end

  -- The <details> element's attributes: its id, "ctm-reveal <kind>" and the
  -- block's other classes and attributes, without title, name and open
  -- (a reveal starts closed).
  local DROPPED = {title = true, name = true, open = true}
  local function detailsAttributes(attr, kind)
    local classes = {"ctm-reveal", kind}
    for _, class in ipairs(attr.classes) do
      if class ~= kind and class ~= "ctm-reveal" then classes[#classes + 1] = class end
    end
    local parts = {}
    if attr.identifier ~= "" then parts[#parts + 1] = 'id="' .. escape(attr.identifier) .. '"' end
    parts[#parts + 1] = 'class="' .. escape(table.concat(classes, " ")) .. '"'
    for key, value in pairs(attr.attributes) do
      if not DROPPED[key] and not key:match("^__") then parts[#parts + 1] = key .. '="' .. escape(value) .. '"' end
    end
    return table.concat(parts, " ")
  end

  local function reveal(kind, attr, title, content)
    return pandoc.Blocks({
      pandoc.RawBlock("html", "<details " .. detailsAttributes(attr, kind) .. ">"),
      pandoc.RawBlock("html", "<summary>"),
      pandoc.Plain(title),
      pandoc.RawBlock("html", "</summary>"),
      pandoc.Div(content, pandoc.Attr("", {"ctm-reveal-body"})),
      pandoc.RawBlock("html", "</details>"),
    })
  end

  -- Other formats show a reveal open: its title in bold, then its content.
  local function opened(kind, attr, title, content)
    local classes = {}
    for _, class in ipairs(attr.classes) do
      if class ~= kind then classes[#classes + 1] = class end
    end
    local blocks = pandoc.Blocks({pandoc.Para({pandoc.Strong(title)})})
    blocks:extend(content)
    return pandoc.Div(blocks, pandoc.Attr(attr.identifier, classes))
  end

  local function kindOf(div)
    local found = nil
    for _, kind in ipairs(KINDS) do
      if div.classes:includes(kind) then
        if found then
          fail("A block is either ." .. found .. " or ." .. kind .. ", not both (" .. places(kind) .. ").")
        end
        found = kind
      end
    end
    return found
  end

  -- The title, or the kind's default title in the page's language. A
  -- .details should say what it holds: markdown-lint names one without.
  local function titleOf(kind, attr)
    local title = markdown(attr.attributes.title)
    if title then return title end
    if kind == "details" then page.untitled = page.untitled + 1 end
    return pandoc.Inlines(defaultTitle(kind))
  end

  -- ::: {.embed src="…" title="…" height="920px"} becomes an iframe; its
  -- content, if any, follows it. The title names the page for screen readers.
  local LENGTH = {"^%d+%.?%d*px$", "^%d+%.?%d*r?em$", "^%d+%.?%d*vh$", "^%d+%.?%d*%%$"}
  local EMBED_OWN = {src = true, title = true, height = true}
  local function embed(div)
    local attrs = div.attributes
    for _, key in ipairs({"src", "title"}) do
      if not attrs[key] or attrs[key]:match("^%s*$") then
        fail("An .embed block needs " .. key .. '=: ::: {.embed src="…" title="…" height="…"} ('
          .. places("embed", key) .. ")." .. (key == "title" and " The title names the embedded page for screen readers." or ""))
      end
    end
    local height = attrs.height or "600px"
    local valid = false
    for _, pattern in ipairs(LENGTH) do valid = valid or height:match(pattern) ~= nil end
    if not valid then
      fail('.embed: height must be a length such as "920px", "40rem" or "80vh" (found ' .. height .. " in "
        .. places("embed") .. ").")
    end
    page.embeds = page.embeds + 1
    if not html() then
      local blocks = pandoc.Blocks({pandoc.Para({pandoc.Link(pandoc.Inlines(attrs.title), attrs.src)})})
      blocks:extend(div.content)
      return blocks
    end
    local parts = {}
    if div.identifier ~= "" then parts[#parts + 1] = 'id="' .. escape(div.identifier) .. '"' end
    local classes = {"ctm-embed"}
    for _, class in ipairs(div.classes) do
      if class ~= "embed" then classes[#classes + 1] = class end
    end
    parts[#parts + 1] = 'class="' .. escape(table.concat(classes, " ")) .. '"'
    parts[#parts + 1] = 'src="' .. escape(attrs.src) .. '"'
    parts[#parts + 1] = 'title="' .. escape(attrs.title) .. '"'
    parts[#parts + 1] = 'loading="lazy"'
    parts[#parts + 1] = 'style="height:' .. escape(height) .. '"'
    for key, value in pairs(attrs) do
      if not EMBED_OWN[key] and not key:match("^__") then parts[#parts + 1] = key .. '="' .. escape(value) .. '"' end
    end
    local blocks = pandoc.Blocks({pandoc.RawBlock("html", "<iframe " .. table.concat(parts, " ") .. "></iframe>")})
    blocks:extend(div.content)
    return blocks
  end

  -- ::: {.modes} + ::: marks where the switch goes; pass 2 fills it in.
  local function marker(div)
    if #div.content > 0 then
      fail("::: {.modes} marks where the lecture/reading switch goes and takes no content (" .. places("modes") .. ").")
    end
    page.markers[#page.markers + 1] = true
    return pandoc.Div({}, pandoc.Attr(div.identifier, {"ctm-modes-slot"}))
  end

  -- Pass 1: reveals, embeds and markers (bottom-up, inside tabs and callouts
  -- too); it counts the page's tabsets.
  function M.Div(div)
    local kind = kindOf(div)
    if kind then
      page.reveals = page.reveals + 1
      if kind == "reading-step" then page.readingSteps = page.readingSteps + 1 end
      local title = titleOf(kind, div.attr)
      if not html() then return opened(kind, div.attr, title, div.content) end
      return reveal(kind, div.attr, title, div.content)
    end
    if div.classes:includes("embed") then return embed(div) end
    if div.classes:includes("modes") then return marker(div) end
    return nil
  end

  -- ::: {.solution} is Quarto's Proof of type Solution, with its name (from
  -- name="…", or a heading that opens the block) and its Div. Other formats
  -- keep Quarto's Solution.
  function M.Proof(proof)
    if tostring(proof.type):lower() ~= "solution" or not html() then return nil end
    local div = proof.div
    local name = proof.name and quarto.utils.as_inlines(proof.name) or pandoc.Inlines({})
    local title = markdown(div.attributes.title)
    if title and #name > 0 then
      fail('A .solution block has both title= and a name (name="…", or a heading as its first block, which Quarto '
        .. "takes as the name): use one (" .. places("solution") .. ").")
    end
    title = title or (#name > 0 and name) or pandoc.Inlines(defaultTitle("solution"))
    page.reveals = page.reveals + 1
    local attr = pandoc.Attr(proof.identifier or "", div.classes, div.attributes)
    return reveal("solution", attr, title, div.content)
  end

  function M.Tabset()
    page.tabsets = page.tabsets + 1
    return nil
  end

  -- The switch: hidden until ui/ctm-reveal.js shows it (no dead buttons
  -- without JavaScript). The status line gets its role when the script has
  -- written the first text, so loading the page announces nothing.
  local function switch(id)
    return pandoc.RawBlock("html", table.concat({
      "<div" .. (id ~= "" and (' id="' .. escape(id) .. '"') or "") .. ' class="ctm-modes" role="group" aria-label="'
        .. escape(text("modesLabel")) .. '" hidden>',
      '<button type="button" data-mode="lecture" aria-pressed="true">' .. escape(text("modeLecture")) .. "</button>",
      '<button type="button" data-mode="reading" aria-pressed="false">' .. escape(text("modeReading")) .. "</button>",
      '<span class="ctm-modes-status" data-lecture="' .. escape(text("statusLecture")) .. '" data-reading="'
        .. escape(text("statusReading")) .. '"></span>',
      "</div>"}, "\n"))
  end

  -- markdown-lint: true warns, at render time, on raw HTML that has a
  -- Markdown form, and on tabsets whose tab-heading ids Quarto drops (the
  -- project lacks ctm-assessment's pre-ast tab-ids.lua).
  local LINT = {
    -- A <summary> right after its <details> is the same block.
    {name = "details", find = function(t, state)
      if t:match("<details[%s>]") then
        state.summary = not t:match("<summary[%s>]")
        return true
      end
      local follows = state.summary
      state.summary = false
      return t:match("<summary[%s>]") and not follows
    end,
      advice = 'raw HTML <details>/<summary> (%s): write ::: {.reading-step title="…"}, ::: {.hint}, ::: {.solution} or '
        .. '::: {.details title="…"}, closed with :::, instead.'},
    {name = "anchor", find = function(t) return t:match('<div%s+id%s*=%s*"[^"]*"%s*>%s*</div>') end,
      advice = "raw HTML <div id=\"…\"></div> (%s): write ::: {#id} and ::: on the next line instead."},
    {name = "iframe", find = function(t) return t:match("<iframe[%s>]") end,
      advice = 'raw HTML <iframe> (%s): write ::: {.embed src="…" title="…" height="…"} and ::: instead.'},
    {name = "switch", find = function(t) return t:match("<[^>]*data%-learning%-mode") end,
      advice = "a hand-written lecture/reading switch (data-learning-mode, %s): remove it. Pages with "
        .. ".reading-step blocks get the switch; ::: {.modes} places it."},
  }
  -- The rules' state is per file.
  function M.rawHTML(lines)
    local found, states = {}, {}
    for number, line in ipairs(ctm.source.read(lines)) do
      if line and line.text:match("%S") then
        local lower = line.text:lower()
        for _, rule in ipairs(LINT) do
          states[rule.name] = states[rule.name] or {}
          if rule.find(lower, states[rule.name]) then
            found[#found + 1] = {rule = rule.name, line = number, text = line.text, raw = line.raw}
          end
        end
      end
    end
    return found
  end

  local function lint(meta)
    local found = {}
    for _, file in ipairs(ctm.source.files()) do
      for _, hit in ipairs(M.rawHTML(file.lines)) do
        found[hit.rule] = found[hit.rule] or {}
        table.insert(found[hit.rule], file.label .. ":" .. hit.line)
      end
    end
    for _, rule in ipairs(LINT) do
      local where = found[rule.name]
      if where then
        local shown = {}
        for i = 1, math.min(#where, 5) do shown[i] = where[i] end
        local list = table.concat(shown, ", ") .. (#where > 5 and (" and " .. (#where - 5) .. " more") or "")
        quarto.log.warning("markdown-lint: " .. rule.advice:format(list))
      end
    end
    if page.untitled > 0 then
      quarto.log.warning("markdown-lint: .details without a title (" .. places("details", "title") .. ') shows "'
        .. defaultTitle("details") .. '": say what it holds with ::: {.details title="…"}.')
    end
    if page.tabsets > 0 and meta["ctm-tab-ids"] == nil then
      quarto.log.warning("markdown-lint: " .. ctm.source.pageName() .. " has tabsets, but Quarto drops the ids of "
        .. "their tab headings: list ctm-assessment's tab-ids.lua first in _quarto.yml (filters: - path: "
        .. "_extensions/ctm-assessment/tab-ids.lua, at: pre-ast; then - ctm-assessment).")
    end
  end

  -- Pass 2: the switch, the lint and the page's dependencies (once per page).
  function M.page(doc)
    if doc.meta["ctm-ui-prepared"] then return doc end
    doc.meta["ctm-ui-prepared"] = true
    local modes = ctm.settings.bool("ctm-assessment", "modes", {default = true})
    local links = ctm.settings.bool("ctm-assessment", "tab-links", {default = true})
    if #page.markers > 1 then
      fail("A page has one ::: {.modes} marker at most (" .. places("modes") .. ").")
    end
    local block = nil
    if html() and modes and page.readingSteps > 0 then block = switch("") end
    local placed = false
    doc.blocks = doc.blocks:walk({Div = function(div)
      if not div.classes:includes("ctm-modes-slot") then return nil end
      placed = true
      if block then return switch(div.identifier) end
      if modes and page.readingSteps == 0 then
        quarto.log.warning("::: {.modes} on " .. ctm.source.pageName() .. ", which has no .reading-step blocks: "
          .. "there is no switch to place.")
      end
      return {}
    end})
    if block and not placed then doc.blocks:insert(1, block) end
    if ctm.settings.bool("ctm-assessment", "markdown-lint", {default = false}) and html() then lint(doc.meta) end
    if quarto.doc.is_format("html") then
      local scripts = quarto.doc.is_format("html:js")
      local nav = scripts and links and (page.tabsets > 0 or page.reveals > 0)
        and not quarto.format.isRevealJsOutput() and not quarto.format.isDashboardOutput()
      if page.reveals > 0 or page.embeds > 0 or nav then
        ctm.deps.html({name = "ctm-ui", stylesheets = {"ui/ctm-ui.css"}})
      end
      if scripts and page.reveals > 0 then ctm.deps.html({name = "ctm-reveal", scripts = {"ui/ctm-reveal.js"}}) end
      if nav then ctm.deps.html({name = "ctm-nav", scripts = {"ui/ctm-nav.js"}}) end
    end
    return doc
  end

  -- Components call these after parsing their labelled exercise block.
  function M.exercise(spec) return ctm.store.exercise(spec) end
  function M.finalize(doc) return ctm.store.finalize(doc) end
  function M.exercises() return ctm.store.exercises() end

  -- Prepare quiz scopes before reveal conversion.
  function M.passes()
    return {
      {Pandoc = function(doc) return ctm.progress.prepare(doc) end},
      {Div = M.Div, Proof = M.Proof, Tabset = M.Tabset},
      {Pandoc = M.page},
    }
  end

  return M
end
