-- `filters: [ai-feedback]` (deprecated alias for one release): the filters of
-- ctm-libs, found next to this folder by feedback-quarto.lua.
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]")
local api = dofile(pandoc.path.join({here, "feedback-quarto.lua"}))
quarto.log.warning("filters: [ai-feedback] is deprecated: AI feedback is part of CTM Assessment (filters: [ctm-assessment]). It keeps working in 0.9.")
return {{Callout = api.markCallout}, {Pandoc = api.prepare}}
