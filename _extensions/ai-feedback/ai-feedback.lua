-- `filters: [ai-feedback]` (deprecated alias, 0.9.x only): the filters of the
-- ctm-libs next to this folder, located by feedback-quarto.lua.
local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)[/\\]")
dofile(pandoc.path.join({here, "feedback-quarto.lua"}))
quarto.log.warning("filters: [ai-feedback] is deprecated: AI feedback is part of CTM Assessment (filters: [ctm-assessment]). It keeps working in 0.9.")
return _G.__ctmLibs.filters()
