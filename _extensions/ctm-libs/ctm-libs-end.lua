-- Last filter of the CTM Assessment package (listed after every component):
-- prints the page's build message (P22) at a fixed point, or stops the build
-- when the page has exercises that only AI feedback can assess and
-- ai-feedback: without-ai is unset. Pages without ctm-libs are untouched.
-- Without this filter the message is printed when Pandoc closes the page's
-- Lua state, and the stop comes as soon as ctm-libs meets such an exercise
-- (lua/feedback.lua, lua/policy.lua). Quarto loads every filter before it runs
-- any: ctm-libs knows from __ctmLibsEnd that this filter will run, and from
-- __ctmLibsEndRan that it has run (then a later CTM filter is in the wrong
-- order, which stops the render).
_G.__ctmLibsEnd = true
return {
  {Pandoc = function(doc)
    _G.__ctmLibsEndRan = true
    local ctm = rawget(_G, "__ctmLibs")
    local feedback = ctm and rawget(ctm, "feedback")
    if feedback then feedback.flush() end
    if ctm then
      doc = ctm.ui.finalize(doc)
      return ctm.progress.cleanup(doc)
    end
    return doc
  end},
}
