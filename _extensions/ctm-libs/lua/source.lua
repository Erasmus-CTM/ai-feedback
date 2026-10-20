-- The page's Markdown source, for messages that name a file and line
-- (ctm.source): Quarto does not tell which file or line a block came from.
--
--   ctm.source.pageName()        "pages/x.qmd", followed by " (or a file it includes)" when it does
--   ctm.source.files()           the page and the files it includes ({{< include >}}, nested ones
--                                too, relative to the page as in Quarto), in order:
--                                {{path, label, lines}}; labels are relative to the project
--   ctm.source.read(lines)       how markdown-lint reads one file's lines: for each line, in
--                                order, {text = …, raw = …} when it is Markdown (`text` without
--                                inline code and comments: blank for a comment alone), else
--                                false (code, fenced or indented, a fence's own lines, front
--                                matter); `raw` is true inside ```{=html}. Needs no page:
--                                maintainer tools run it outside a render (docs/api.md)
--   ctm.source.scan(visit)       visit(text, file, line, raw) for every line of files() that
--                                read() gives a text that is not blank
--   ctm.source.fences(class)     "file:line" of each fenced div with the class, with its attributes
--                                ({where, attributes = "{...}"})
return function(ctm)
  local M = {}

  -- a/b/../c -> a/c (pandoc.path.normalize keeps "..").
  local function tidy(path)
    local parts = {}
    for part in path:gmatch("[^/\\]+") do
      if part == ".." and #parts > 0 and parts[#parts] ~= ".." then
        table.remove(parts)
      elseif part ~= "." then
        parts[#parts + 1] = part
      end
    end
    return (path:match("^[/\\]") and "/" or "") .. table.concat(parts, "/")
  end

  local function label(path)
    local root = quarto.project and quarto.project.directory
    if root and root ~= "" then return pandoc.path.make_relative(tidy(path), tidy(root)) end
    return pandoc.path.filename(path)
  end

  local function readLines(path)
    local handle = io.open(path, "r")
    if not handle then return nil end
    local text = handle:read("*a")
    handle:close()
    local lines = {}
    for line in (text:gsub("\r\n", "\n") .. "\n"):gmatch("([^\n]*)\n") do lines[#lines + 1] = line end
    return lines
  end

  local cached = nil
  -- Includes resolve as Quarto resolves them, nested ones too: relative to
  -- the page's folder (not to the file that includes them), or to the
  -- project's root when they start with "/".
  function M.files()
    if cached then return cached end
    cached = {}
    local seen = {}
    local page = quarto.doc.input_file
    if not page then return cached end
    local folder = pandoc.path.directory(page)
    local root = quarto.project and quarto.project.directory
    local function add(path)
      path = tidy(pandoc.path.normalize(path))
      if seen[path] then return end
      seen[path] = true
      local lines = readLines(path)
      if not lines then return end
      cached[#cached + 1] = {path = path, label = label(path), lines = lines}
      for _, line in ipairs(lines) do
        local include = line:match("{{<%s*include%s+(.-)%s*>}}")
        if include then
          include = include:gsub('^"(.*)"$', "%1"):gsub("^'(.*)'$", "%1")
          if include:sub(1, 1) == "/" and root and root ~= "" then
            add(pandoc.path.join({root, include:sub(2)}))
          else
            add(pandoc.path.join({folder, include}))
          end
        end
      end
    end
    add(page)
    return cached
  end

  -- The page as messages name it: its file, and the files it includes.
  function M.pageName()
    local file = quarto.doc.input_file or ""
    local name = label(file)
    local page = M.files()[1]
    if page and table.concat(page.lines, "\n"):find("{{<%s*include%s") then name = name .. " (or a file it includes)" end
    return name
  end

  -- A list item's first line.
  local function item(line)
    return line:match("^%s*[-+*]%s+%S") or line:match("^%s*%d+[.)]%s+%S")
  end

  -- Lines outside code blocks (fenced, or indented by four spaces or a tab
  -- after a blank line outside a list), inline code, HTML comments and front
  -- matter: one file's lines, as markdown-lint reads them. A comment runs on
  -- across lines; a line that is all comment is Markdown with a blank text.
  function M.read(lines)
    local found = {}
    local fence, raw, comment = nil, false, false
    local afterBlank, inList, indented = true, false, false
    for number, line in ipairs(lines) do
      local skip = false
      local blank = not line:match("%S")
      local deep = line:match("^    ") or line:match("^ *\t")
      if number == 1 and line:match("^%-%-%-%s*$") then
        fence = "front matter"
        skip = true
      elseif fence == "front matter" then
        if line:match("^%-%-%-%s*$") or line:match("^%.%.%.%s*$") then fence = nil end
        skip = true
      elseif fence then
        local close = line:match("^%s*([`~]+)%s*$")
        if close and close:sub(1, 1) == fence:sub(1, 1) and #close >= #fence then
          fence, raw = nil, false
          skip = true
        else
          skip = not raw
        end
      elseif indented and (blank or deep) then
        skip = true
      elseif deep and afterBlank and not inList and not blank then
        indented, skip = true, true
      else
        indented = false
        local open, info = line:match("^%s*(```+)%s*(.-)%s*$")
        if not open then open, info = line:match("^%s*(~~~+)%s*(.-)%s*$") end
        if open then
          fence, raw = open, info:match("^{=html5?}$") ~= nil
          skip = true
        end
      end
      if not fence and not indented and not blank then
        if item(line) then
          inList = true
        elseif not line:match("^%s") then
          inList = false
        end
      end
      afterBlank = blank
      if skip then
        found[number] = false
      else
        local text = line
        if comment then
          local stop = text:find("-->", 1, true)
          if stop then text, comment = text:sub(stop + 3), false else text = "" end
        end
        text = text:gsub("<!%-%-.-%-%->", "")
        local start = text:find("<!--", 1, true)
        if start then text, comment = text:sub(1, start - 1), true end
        if not raw then text = text:gsub("``.-``", ""):gsub("`[^`]*`", "") end
        found[number] = {text = text, raw = raw}
      end
    end
    return found
  end

  -- The lines of the page and the files it includes that hold Markdown text
  -- (read()), with their file and number.
  function M.scan(visit)
    for _, file in ipairs(M.files()) do
      for number, line in ipairs(M.read(file.lines)) do
        if line and line.text:match("%S") then visit(line.text, file, number, line.raw) end
      end
    end
  end

  -- Fenced divs (::: {...} or ::: name) whose classes include `class`.
  function M.fences(class)
    local found = {}
    M.scan(function(text, file, number, raw)
      if raw then return end
      local attributes = text:match("^%s*:::+%s*(%b{})")
      local word = not attributes and text:match("^%s*:::+%s*([%w_%-]+)%s*:*%s*$")
      local classes = {}
      if attributes then
        local bare = attributes:gsub('"[^"]*"', '""'):gsub("'[^']*'", "''")
        for name in bare:gmatch("%.([%w_%-]+)") do classes[name] = true end
      elseif word then
        classes[word] = true
      end
      if classes[class] then
        found[#found + 1] = {where = file.label .. ":" .. number, attributes = attributes or ""}
      end
    end)
    return found
  end

  return M
end
