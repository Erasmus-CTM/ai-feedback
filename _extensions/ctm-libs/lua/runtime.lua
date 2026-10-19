-- The page-wide Python runtime (runtime/pyodide-runtime.js, global
-- MathExerciseRuntime): one cacheable file, loaded once whatever the mix of
-- components on the page (Quarto keeps one dependency per name).
return function(ctm)
  local M = {}

  -- Registers the ctm-runtime dependency (a classic script in the head).
  function M.use()
    ctm.deps.html({name = "ctm-runtime", scripts = {"runtime/pyodide-runtime.js"}})
  end

  return M
end
