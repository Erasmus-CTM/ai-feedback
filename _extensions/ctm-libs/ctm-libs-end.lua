-- Last filter of the CTM Assessment package (listed after every component):
-- prints the page's build message about AI feedback left out (P22) at a fixed
-- point, or stops the build that has exercises only AI feedback can assess
-- (ai-feedback: without-ai unset). Pages without ctm-libs are untouched.
-- Without this filter the message is printed when Pandoc closes the page's
-- Lua state, and the stop comes at the end of ctm-libs' preparation
-- (lua/feedback.lua). Quarto loads every filter before it runs any, so
-- ctm-libs knows from this flag that the filter will run.
_G.__ctmLibsEnd = true
return {
  {Pandoc = function(doc)
    local ctm = rawget(_G, "__ctmLibs")
    local feedback = ctm and rawget(ctm, "feedback")
    if feedback then feedback.flush() end
    return doc
  end},
}
