-- Shared filter entry point. Consumers can load the same module automatically.
local api = dofile(quarto.utils.resolve_path("feedback-quarto.lua"))
return {{Callout = api.markCallout}, {Pandoc = api.prepare}}
