-- ai-feedback is now part of CTM Assessment: this alias (one release) keeps
-- `filters: [ai-feedback]` and the loaders of older components working. They
-- load this file; it returns the feedback module of ctm-libs, installed next
-- to this folder.
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]")
local entry = pandoc.path.join({pandoc.path.directory(here), "ctm-libs", "lua", "feedback.lua"})
local f = io.open(entry, "r")
assert(f, "ai-feedback is now part of CTM Assessment, and its library ctm-libs is missing next to " .. here
  .. ". Install CTM Assessment: quarto add https://erasmus-ctm.github.io/ctm-assessment/ctm-assessment.tar.gz")
f:close()
return dofile(entry)
