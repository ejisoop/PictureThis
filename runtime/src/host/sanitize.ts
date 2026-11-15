// Labels from generated code may contain a little HTML (<i>L</i>, x<sub>0</sub>).
// The host renders them outside the sandbox, so keep only harmless inline tags.
const ALLOWED = new Set(['I', 'B', 'EM', 'STRONG', 'SUB', 'SUP', 'BR', 'SPAN']);

export function sanitizeLabel(html: string): string {
  const s = String(html ?? '').slice(0, 300);
  if (typeof DOMParser === 'undefined') return s.replace(/[<>&]/g, '');
  const doc = new DOMParser().parseFromString(`<div>${s}</div>`, 'text/html');
  const walk = (n: Node): string => {
    if (n.nodeType === 3) return (n.textContent ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    if (n.nodeType !== 1) return '';
    const el = n as Element;
    const inner = [...el.childNodes].map(walk).join('');
    if (!ALLOWED.has(el.tagName)) return inner;
    const t = el.tagName.toLowerCase();
    return t === 'br' ? '<br>' : `<${t}>${inner}</${t}>`;
  };
  return [...doc.body.firstChild!.childNodes].map(walk).join('');
}
