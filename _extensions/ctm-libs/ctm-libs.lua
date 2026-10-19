-- Filter entry of ctm-libs, the internal library of CTM Assessment. The
-- package lists it before the components; the ai-feedback alias returns it.
local dir = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]")
local api = dofile(pandoc.path.join({dir, "lua", "feedback.lua"}))
return {{Callout = api.markCallout}, {Pandoc = api.prepare}}
