-- Last filter of the CTM Assessment package (listed after every component):
-- prints the page's build message about AI feedback left out (P22) at a fixed
-- point. Pages without ctm-libs are untouched. Without this filter the message
-- is printed when Pandoc closes the page's Lua state (lua/feedback.lua).
return {
  {Pandoc = function(doc)
    local ctm = rawget(_G, "__ctmLibs")
    local feedback = ctm and rawget(ctm, "feedback")
    if feedback then feedback.flush() end
    return doc
  end},
}
