-- Student chooser only; native generation and approval stay in the authoring tools.
return function(ctm)
  local M = {}
  function M.use()
    if not quarto.doc.is_format("html:js") then return end
    ctm.deps.html({name = "ctm-variants", scripts = {"ui/variants.js"}})
  end
  return M
end
