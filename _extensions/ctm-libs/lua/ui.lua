-- Reveals, the lecture/reading switch and embedded pages of CTM Assessment
-- pages (ctm.ui; P18, F1, F2). Authors
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
-- (lua/sections.lua). Pages without the syntax are unchanged.
return function(ctm)
  local M = {}

  -- The classes of reveals that are Divs; .solution arrives as Quarto's Proof.
  local KINDS = {"reading-step", "hint", "details"}
  local DEFAULT_TITLE = {["reading-step"] = "readingStep", hint = "hint", solution = "solution"}
  -- What pass 1 found on the page.
  local page = {reveals = 0, readingSteps = 0, embeds = 0, markers = {}}

  local function html() return quarto.doc.is_format("html") end
  local function fail(message) assert(false, message) end
  local function escape(value)
    return (tostring(value):gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"))
  end

  local lang = nil
  local function text(key)
    if not lang then lang = ctm.locale.resolve("ui") end
    return ctm.locale.text("ui", key, lang)
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

  -- A title attribute is inline Markdown. Pandoc has already applied
  -- backslash escapes to attribute values: title="$\\mathbf{A}$" arrives as
  -- $\mathbf{A}$ (and title="$a\,b$" as $a,b$).
  local function markdown(value)
    if value == nil or value == "" then return nil end
    local inlines = pandoc.utils.blocks_to_inlines(pandoc.read(value, "markdown").blocks)
    return #inlines > 0 and inlines or nil
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

  local function titleOf(kind, attr)
    local title = markdown(attr.attributes.title)
    if title then return title end
    if not DEFAULT_TITLE[kind] then
      fail("A ." .. kind .. ' block needs a title: ::: {.' .. kind .. ' title="…"} (' .. places(kind, "title") .. ").")
    end
    return pandoc.Inlines(text(DEFAULT_TITLE[kind]))
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
  -- too).
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
    title = title or (#name > 0 and name) or pandoc.Inlines(text("solution"))
    page.reveals = page.reveals + 1
    local attr = pandoc.Attr(proof.identifier or "", div.classes, div.attributes)
    return reveal("solution", attr, title, div.content)
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

  -- Pass 2: the switch and the page's dependencies (once per page).
  function M.page(doc)
    if doc.meta["ctm-ui-prepared"] then return doc end
    doc.meta["ctm-ui-prepared"] = true
    local modes = ctm.settings.bool("ctm-assessment", "modes", {default = true})
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
    if quarto.doc.is_format("html") then
      if page.reveals > 0 or page.embeds > 0 then ctm.deps.html({name = "ctm-ui", stylesheets = {"ui/ctm-ui.css"}}) end
      if quarto.doc.is_format("html:js") and page.reveals > 0 then
        ctm.deps.html({name = "ctm-reveal", scripts = {"ui/ctm-reveal.js"}})
      end
    end
    return doc
  end

  -- The two passes of ctm.filters().
  function M.passes()
    return {
      {Div = M.Div, Proof = M.Proof},
      {Pandoc = M.page},
    }
  end

  return M
end
