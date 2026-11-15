// Static checks on generated modules: parse with acorn, enforce the module
// contract, reject deny-listed identifiers. This is defence in depth; the
// sandbox (opaque-origin iframe + CSP) is the real boundary.
import * as acorn from 'acorn';

export const DENY = new Set([
  'fetch', 'XMLHttpRequest', 'WebSocket', 'eval', 'Function', 'document', 'parent', 'top', 'localStorage', 'sessionStorage',
  'indexedDB', 'navigator', 'postMessage', 'window', 'globalThis', 'self', 'importScripts', 'Worker', 'SharedWorker',
  'EventSource', 'opener', 'setInterval', 'requestAnimationFrame', 'caches', 'cookieStore',
]);
// note: setTimeout is allowed (gsap.delayedCall is preferred); setInterval / rAF are not — use update(dt).

export interface StaticResult {
  ok: boolean;
  errors: string[];
}

type Node = acorn.Node & Record<string, any>;

function walk(node: Node, visit: (n: Node, parent: Node | null, key: string) => void, parent: Node | null = null, key = '') {
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, visit, node, k));
    else if (v && typeof v.type === 'string') walk(v, visit, node, k);
  }
}

export function staticCheck(code: string): StaticResult {
  const errors: string[] = [];
  if (code.length > 120_000) errors.push(`module is too long (${code.length} chars; max 120000)`);
  let ast: Node;
  try {
    ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module', locations: true }) as Node;
  } catch (e) {
    return { ok: false, errors: [`syntax error: ${(e as Error).message}`] };
  }
  const exports = ast.body.filter((n: Node) => /^Export/.test(n.type));
  const imports = ast.body.filter((n: Node) => n.type === 'ImportDeclaration');
  if (imports.length) errors.push('imports are not allowed: everything comes from `lp`');
  const def = exports.find((n: Node) => n.type === 'ExportDefaultDeclaration');
  if (exports.length !== 1 || !def) errors.push('the module must have exactly one export: `export default function create(lp, ctx) { … }`');
  else if (def.declaration.type !== 'FunctionDeclaration') errors.push('the default export must be a function declaration: `export default function create(lp, ctx) { … }`');
  else if (def.declaration.params.length < 1) errors.push('create() must take (lp, ctx)');

  const line = (n: Node) => (n.loc ? ` (line ${n.loc.start.line})` : '');
  // names the module declares itself (const top = …, function parent(…), (self) => …)
  // are local variables, not the browser globals: only free uses are denied.
  // eval / Function / import() stay denied in every form.
  const declared = new Set<string>();
  const addPattern = (p: Node | null) => {
    if (!p) return;
    if (p.type === 'Identifier') declared.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach((q: Node) => addPattern(q.type === 'RestElement' ? q.argument : q.value));
    else if (p.type === 'ArrayPattern') p.elements.forEach((q: Node | null) => q && addPattern(q.type === 'RestElement' ? q.argument : q));
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'RestElement') addPattern(p.argument);
  };
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator') addPattern(n.id);
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') ) {
      if (n.id) declared.add(n.id.name);
      n.params.forEach((q: Node) => addPattern(q));
    }
    if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
    if (n.type === 'CatchClause' && n.param) addPattern(n.param);
  });
  const ALWAYS = new Set(['eval', 'Function']);
  walk(ast, (n, p, key) => {
    if (n.type === 'ImportExpression') errors.push(`dynamic import() is not allowed${line(n)}`);
    if (n.type === 'Identifier') {
      // property names (obj.fetch, { fetch: … }) are fine; free/declared identifiers are not
      const isProp = p && ((p.type === 'MemberExpression' && key === 'property' && !p.computed) || (p.type === 'Property' && key === 'key' && !p.computed) || (p.type === 'MethodDefinition' && key === 'key') || (p.type === 'PropertyDefinition' && key === 'key'));
      if (!isProp && DENY.has(n.name) && (ALWAYS.has(n.name) || !declared.has(n.name))) errors.push(`\`${n.name}\` is not available in visualizations${line(n)}`);
    }
    if (n.type === 'MemberExpression' && n.computed && n.property.type === 'Literal' && DENY.has(String(n.property.value))) errors.push(`\`[${JSON.stringify(n.property.value)}]\` is not allowed${line(n)}`);
    if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && ['constructor', '__proto__', 'prototype'].includes(n.property.name) && n.object.type !== 'ThisExpression') {
      if (n.property.name !== 'prototype') errors.push(`\`.${n.property.name}\` is not allowed${line(n)}`);
    }
    if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && n.callee.name === 'Function') errors.push(`new Function is not allowed${line(n)}`);
    if (n.type === 'Literal' && typeof n.value === 'string' && /<\/script|<!--/i.test(n.value)) errors.push(`string contains "</script" or "<!--"${line(n)}`);
    if (n.type === 'TemplateElement' && /<\/script|<!--/i.test(n.value.raw)) errors.push(`template contains "</script" or "<!--"${line(n)}`);
  });
  if (/<\/script|<!--/i.test(code)) errors.push('code must not contain "</script" or "<!--"');
  return { ok: errors.length === 0, errors: [...new Set(errors)].slice(0, 30) };
}
