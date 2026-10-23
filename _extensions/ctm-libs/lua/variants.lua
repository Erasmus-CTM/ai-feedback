-- Student chooser only; native generation and approval stay in the authoring tools.
return function(ctm)
  local M = {}
  local function environment()
    local value = os.getenv("CTM_VARIANTS")
    if value == "" then value = nil end
    if value and value ~= "required" and value ~= "optional" and value ~= "review" then
      ctm.fail("CTM_VARIANTS must be required, optional or review.")
    end
    return value
  end
  function M.approval()
    local value = environment()
    if value == "required" or value == "optional" then return value end
    return ctm.settings.choice("ctm-assessment", "variants.approval", {"required", "optional"}, {default = "required"})
  end
  function M.renderMode(explicit)
    if environment() == "review" then return "review" end
    local value = explicit or "publish"
    if value ~= "review" and value ~= "preview" and value ~= "publish" then
      ctm.fail("Variant render mode must be review, preview or publish.")
    end
    return value
  end
  function M.use()
    if not quarto.doc.is_format("html:js") then return end
    ctm.deps.html({name = "ctm-variants", scripts = {"ui/variants.js"}})
  end
  return M
end
