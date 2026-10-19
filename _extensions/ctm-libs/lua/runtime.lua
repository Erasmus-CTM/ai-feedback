-- The page-wide Python runtime (runtime/pyodide-runtime.js, global
-- MathExerciseRuntime): one cacheable file, loaded once whatever the mix of
-- components on the page (Quarto keeps one dependency per name).
return function(ctm)
  local M = {}

  -- Registers the ctm-runtime dependency (a classic script in the head).
  function M.use()
    ctm.deps.html({name = "ctm-runtime", scripts = {"runtime/pyodide-runtime.js"}})
  end

  -- Seconds after which a running check offers Stop (worker runtimes only):
  -- `<component>: stop-after:` for one component, `ctm-assessment: stop-after:`
  -- for all components; default 20.
  function M.stopAfter(component)
    return (ctm.settings.number(component, "stop-after", {shared = true, default = 20, positive = true, unit = "seconds"}))
  end

  return M
end
