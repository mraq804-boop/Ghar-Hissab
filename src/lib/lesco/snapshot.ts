const VIEW_STYLE = `<style>
#loader-container,.bill-qr-modal,.meter-snap-modal,.bill-qr-modal-backdrop,.meter-snap-modal-backdrop{display:none!important}
[class*="subsidy-qr"],[class*="bill-qr"]:not(.bill-qr-modal){font-size:0!important;color:transparent!important;overflow:hidden!important}
html,body{background:#fff!important}
@media (max-width:919px){html{zoom:.95}}
@media (max-width:700px){html{zoom:.74}}
@media (max-width:520px){html{zoom:.56}}
@media (max-width:420px){html{zoom:.44}}
</style>`;

function cleanCss(css: string) {
  return css
    .replace(/@import[^;]*;/gi, "")
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(")
    .replace(/<\/style/gi, "<\\/style");
}

/**
 * Turns a LESCO bill page into a self-contained copy with no scripts, forms, event handlers or
 * outside requests. `styles` maps stylesheet paths to their CSS and `images` maps image paths to
 * data: URLs; anything not supplied is dropped.
 */
export function buildBillSnapshot(html: string, styles: Record<string, string>, images: Record<string, string>): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, "")
    .replace(/<(iframe|object|embed|frame|frameset|applet|template|svg:script)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(iframe|object|embed|frame|base|meta)\b[^>]*>/gi, (tag) => (/charset|viewport/i.test(tag) && /^<meta/i.test(tag) && !/http-equiv/i.test(tag) ? tag : ""))
    .replace(/<\/?(form|button|select|option|textarea)\b[^>]*>/gi, "")
    .replace(/<input\b[^>]*>/gi, "");

  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /href\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
    const path = href.split("?")[0];
    return /stylesheet/i.test(tag) && styles[path] !== undefined ? `<style>${cleanCss(styles[path])}</style>` : "";
  });

  out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css: string) => `<style>${cleanCss(css)}</style>`);

  out = out
    .replace(/\s(on[a-z]+|formaction|srcdoc|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src|action)\s*=\s*(["'])\s*(?:javascript|vbscript|data:text\/html)[^"']*\2/gi, "");

  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /src\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
    if (src.startsWith("data:image/")) return tag;
    const data = images[src.split("?")[0]];
    return data ? tag.replace(/src\s*=\s*"[^"]*"/i, `src="${data}"`) : "";
  });

  out = out.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (_, s: string) => ` style="${s.replace(/url\([^)]*\)/gi, "none").replace(/expression\s*\(/gi, "(")}"`);
  out = out.replace(/<a\b([^>]*)>/gi, (_, attrs: string) => `<a${attrs.replace(/\starget\s*=\s*("[^"]*"|'[^']*')/gi, "")}>`);

  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">${VIEW_STYLE}`;
  return /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${head}</head>`) : `<!doctype html><html><head>${head}</head><body>${out}</body></html>`;
}

/** Stylesheet and image paths a bill page refers to on its own site. */
export function billAssets(html: string) {
  const styles = new Set<string>();
  const images = new Set<string>();
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /href\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? "";
    if (/stylesheet/i.test(m[0]) && href.startsWith("/") && !href.startsWith("//")) styles.add(href.split("?")[0]);
  }
  for (const m of html.matchAll(/<img\b[^>]*src\s*=\s*"(\/[^"/][^"]*)"/gi)) images.add(m[1].split("?")[0]);
  return { styles: [...styles], images: [...images] };
}
