-- CTM bootstrap: byte-identical in every CTM component (the package build checks it).
-- Finds ctm-libs, the internal library of CTM Assessment, and returns the page's instance.
-- Components are parts of the CTM Assessment package: without the package
-- (ctm-assessment next to the component or in the project's _extensions) the
-- render stops with the install command. Component development builds and CI
-- set CTM_COMPONENT_DEV=1 to use a ctm-libs installation without the package.
-- Options (the second argument, a table):
--   standalone  the component also works without the package, with the
--               ctm-libs it ships (decision 5); the value is its own install
--               command, named when that ctm-libs is missing or too old.
--               Inside the package the package's messages apply.
--   api         the ctm-libs interface level the component needs (default API).
local INSTALL = "quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz"
local API = 1
local function exists(p) local f = p and io.open(p, "r"); if f then f:close() return true end return false end
local function candidates(name)
  local list = {}
  -- 1. Next to this component: the package (_extensions/<name>) or one owner folder.
  local root = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\][^/\\]+[/\\][^/\\]+$")
  if root then list[#list + 1] = pandoc.path.join({root, name}) end
  -- 2. The project's _extensions (nearest one for a single file), with owner folders.
  local base = quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
  while base and base ~= "" do
    local ext = pandoc.path.join({base, "_extensions"})
    list[#list + 1] = pandoc.path.join({ext, name})
    local ok, owners = pcall(pandoc.system.list_directory, ext)
    if ok then for _, o in ipairs(owners) do list[#list + 1] = pandoc.path.join({ext, o, name}) end end
    if quarto.project.directory then break end
    local parent = pandoc.path.directory(base); if parent == base then break end; base = parent
  end
  return list
end
local function find(name, entry)
  for _, dir in ipairs(candidates(name)) do
    if exists(pandoc.path.join({dir, entry})) then return dir end
  end
end
return function(component, opts)
  opts = opts or {}
  local package = find("ctm-assessment", "_extension.yml")
  if not package and not opts.standalone and os.getenv("CTM_COMPONENT_DEV") ~= "1" then
    assert(false, component .. " is part of CTM Assessment, which is not installed in this project. Install CTM Assessment: " .. INSTALL)
  end
  local again = opts.standalone and not package and (" Install " .. component .. " again: " .. opts.standalone)
  local dir = find("ctm-libs", pandoc.path.join({"lua", "ctm.lua"}))
  assert(dir, again and (component .. " needs its library ctm-libs, which is missing next to it." .. again)
    or (component .. " is part of CTM Assessment and needs its library ctm-libs, which is not installed. Install CTM Assessment: " .. INSTALL))
  local ctm = dofile(pandoc.path.join({dir, "lua", "ctm.lua"}))
  assert(ctm.api >= (opts.api or API), component .. " needs a newer ctm-libs than " .. dir .. " (" .. ctm.version .. ")."
    .. (again or (" Update CTM Assessment: " .. INSTALL)))
  return ctm
end
