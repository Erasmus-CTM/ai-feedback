-- Filter entry of ctm-libs, the internal library of CTM Assessment. The
-- package lists it before the components; the ai-feedback alias returns the
-- same filters.
local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]")
return dofile(pandoc.path.join({dir, "lua", "ctm.lua"})).filters()
