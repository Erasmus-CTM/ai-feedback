-- Shared matrix editor: presentation and editing only, with no CAS dependency.
-- Each consumer supplies its own translated labels and owns parsing/grading.
return function(ctm)
  local M = {}

  function M.use()
    ctm.deps.html({
      name = "ctm-matrix-input",
      stylesheets = {"ui/ctm-matrix-input.css"},
      scripts = {{path = "ui/ctm-matrix-input.js", afterBody = true}},
    })
  end

  return M
end
