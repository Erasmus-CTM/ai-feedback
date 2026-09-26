-- Documentation-only source panels, emitted before the exercise filters.
local policyFiles = {}
local function escape(text)
  return text:gsub('&','&amp;'):gsub('<','&lt;'):gsub('>','&gt;'):gsub('"','&quot;')
end
local function panel(source, title)
  local pieces = {'<details class="math-example-source example-author-notes ai-feedback-ignore"><summary>'..title..'</summary><pre><code class="language-markdown">'..escape(source)..'</code></pre>'}
  for _, file in ipairs(policyFiles) do
    table.insert(pieces, '<p><strong>Policy YAML: '..escape(file.name)..'</strong></p><pre><code class="language-yaml">'..escape(file.content)..'</code></pre>')
  end
  table.insert(pieces, '</details>')
  return pandoc.RawBlock('html',table.concat(pieces,'\n'))
end
local function meta(m)
  policyFiles = {}
  local cfg=m['ai-feedback'] or {}
  for _, key in ipairs({'policy-files','page-policy-files'}) do
    local files=cfg[key]
    if files then
      if pandoc.utils.type(files)~='List' then files={files} end
      for _, name in ipairs(files) do
        name=pandoc.utils.stringify(name)
        local base=quarto.project.directory or pandoc.path.directory(quarto.doc.input_file)
        local path=pandoc.path.is_absolute(name) and name or pandoc.path.join({base,name})
        local f=assert(io.open(path,'r'),'Cannot read example policy source: '..path)
        table.insert(policyFiles,{name=name,content=f:read('*a')});f:close()
      end
    end
  end
end
local function code(el)
  if not quarto.doc.is_format('html') then return end
  local opening
  for _, name in ipairs({'math-exercise','py-exercise','pyodide-python'}) do
    if el.classes:includes('{'..name..'}') or el.classes:includes(name) then opening='{'..name..'}' end
  end
  local jsx=el.classes:includes('jsxgraph')
  if jsx then
    local args={'.jsxgraph'}
    if el.identifier~='' then table.insert(args,'#'..el.identifier) end
    for key,value in pairs(el.attributes) do table.insert(args,key..'="'..tostring(value):gsub('"','\\"')..'"') end
    opening='{'..table.concat(args,' ')..'}'
  end
  if not opening then return end
  return {el,panel('```'..opening..'\n'..el.text..'\n```',jsx and 'Show JSXGraph source and policy YAML' or 'Show source and policy YAML')}
end
local function div(el)
  if not quarto.doc.is_format('html') or not el.classes:includes('ai-feedback') then return end
  local source=pandoc.write(pandoc.Pandoc({el}),'markdown',{wrap_text='none'})
  return {el,panel(source,'Show source and policy YAML')}
end
return {{Meta=meta},{CodeBlock=code,Div=div}}
