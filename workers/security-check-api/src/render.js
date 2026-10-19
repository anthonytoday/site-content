// Renders Notion block arrays (after template fill) as a standalone HTML page: dry-run preview and fallback link.
import { esc } from "./validate.js";
const COL = { gray: "#6b7280", green: "#0F7A32", orange: "#C2410C", red: "#B91C1C" };
const rt = (arr) => (arr || []).map((x) => {
  let s = esc(x.text ? x.text.content : x.plain_text || "").replace(/\n/g, "<br>").replace(/✓/g, '<span class="tick">✓</span>').replace(/✅/g, '<span role="img" aria-label="Included" style="color:#0F7A32">✅</span>');
  const a = x.annotations || {};
  if (a.bold) s = "<b>" + s + "</b>";
  if (COL[a.color]) s = '<span style="color:' + COL[a.color] + '">' + s + "</span>";
  const url = x.text && x.text.link && x.text.link.url;
  if (url) s = /^https:\/\/wa\.me\//.test(url) ? '<a class="bk bk-wa" href="' + esc(url) + '" rel="noopener">' + s + "</a>" : /^mailto:/.test(url) && /email/i.test(s) ? '<a class="bk bk-em" href="' + esc(url) + '">' + s + "</a>" : '<a' + linkClass(x.text.content) + ' href="' + esc(url) + '" rel="noopener">' + s + "</a>";
  return s;
}).join("");
// Tap targets (44px at 390): CTAs as navy buttons, contact/footer links as 44px inline-flex targets, other links get vertical padding.
const CTA = /^\s*(Get the Fix List|Book Fix Session)\s*$/, TAPLINK = /^\s*(Website|www\.anthonytoday\.com|WhatsApp|Email|LinkedIn|Privacy policy|Contact)\s*$/;
const linkClass = (t) => (CTA.test(t) ? ' class="cta"' : TAPLINK.test(t) ? ' class="tl"' : "");
const SR = '<span class="sr">Not included</span>';
// Text with " · " separators (report meta line, "Talk to Anthony" bar): each part wraps as a unit and its separator
// sits before it, clipped at the start of every line, so no line starts or ends with "·".
const SEP = " · ";
function rtq(runs) {
  const segs = [[]];
  for (const x of runs || []) {
    const c = x.text ? x.text.content : x.plain_text || "";
    if (!c.includes(SEP) || (x.text && x.text.link)) { segs[segs.length - 1].push(x); continue; }
    c.split(SEP).forEach((part, i) => { if (i) segs.push([]); if (part) segs[segs.length - 1].push({ ...x, plain_text: part, text: { ...(x.text || {}), content: part } }); });
  }
  const parts = segs.filter((g) => g.length);
  if (parts.length < 2) return rt(runs);
  return '<span class="sqw"><span class="sq">' + parts.map((g) => '<span class="sg"><span class="sgc">' + rt(g) + "</span></span>").join("") + "</span></span>";
}
const BG = { gray_background: "#f5f5f5", red_background: "#fdecec", blue_background: "#eaf0ff", orange_background: "#fff1e6", green_background: "#e7f7ec", yellow_background: "#fff8db" };
export function renderBlocks(list, extra = {}) {
  let out = "", listTag = null;
  const close = () => { if (listTag) { out += "</" + listTag + ">"; listTag = null; } };
  for (const b of list) {
    const k = b.type, v = b[k] || {};
    const tag = k === "bulleted_list_item" ? "ul" : k === "numbered_list_item" ? "ol" : null;
    if (tag !== listTag) { close(); if (tag) { out += "<" + tag + ">"; listTag = tag; } }
    const kids = b.children ? renderBlocks(b.children, extra) : "";
    if (tag) { out += "<li>" + rt(v.rich_text) + kids + "</li>"; continue; }
    if (k === "paragraph") out += "<p>" + rtq(v.rich_text) + "</p>" + kids;
    else if (/^heading_[1-4]$/.test(k)) { const h = Number(k.slice(-1)) <= 2 ? "h2" : "h3"; out += v.is_toggleable ? "<details open><summary><" + h + ">" + rt(v.rich_text) + "</" + h + "></summary>" + kids + "</details>" : "<" + h + ">" + rt(v.rich_text) + "</" + h + ">"; }
    else if (k === "divider") out += "<hr>";
    else if (k === "toggle") out += "<details><summary>" + rt(v.rich_text) + "</summary>" + kids + "</details>";
    else if (k === "image" && v.external) { const alt = (v.caption || []).map((x) => (x.text ? x.text.content : "")).join(""); out += '<img class="stair" src="' + esc(v.external.url) + '" width="600" alt="' + esc(alt) + '">'; }
    else if (k === "callout") out += '<div class="co" style="background:' + (BG[v.color] || "#f5f5f5") + '"><span>' + esc(v.icon ? v.icon.emoji : "") + "</span><div>" + rtq(v.rich_text) + kids + "</div></div>";
    else if (k === "table") {
      const rows = b.children || v.children || [];
      const head = v.has_column_header !== false && rows[0] ? rows[0].table_row.cells.map((c) => (c || []).map((x) => (x.text ? x.text.content : x.plain_text || "")).join("").replace(/\s+/g, " ").trim()) : [];
      // A table with ✅ cells is a comparison: empty cells get a screen-reader "Not included".
      const cmp = rows.some((r) => r.table_row.cells.some((c) => (c || []).some((x) => /✅/.test(x.text ? x.text.content : x.plain_text || ""))));
      out += '<table class="st' + (head.length ? " hh" : "") + '">' + rows.map((r, i) => "<tr>" + r.table_row.cells.map((c, j) => {
        const colHead = i === 0 && head.length, isHead = colHead || (v.has_row_header && j === 0);
        const cell = rt(c).replace(/(<\/a>) · (<a class="bk)/g, "$1$2"); // the WhatsApp / Email bars stack, so no dot between them
        if (isHead) return "<th" + (colHead ? ' scope="col"' : ' scope="row"') + ">" + cell + "</th>";
        return cmp && !cell.trim() ? '<td class="ni" data-label="' + esc(head[j] || "") + '">' + SR + "</td>" : '<td data-label="' + esc(head[j] || "") + '">' + cell + "</td>";
      }).join("") + "</tr>").join("") + "</table>";
    }
    else if (k === "__footer__") {
      const [copy, ...rest] = b.children || [];
      const items = rest.flatMap((c) => (c.paragraph.rich_text || []).filter((x) => x.text && x.text.link));
      out += "<footer><hr>" + (copy ? renderBlocks([copy], extra) : "") + '<div class="fw"><ul class="fl">' + items.map((x) => "<li>" + rt([x]) + "</li>").join("") + "</ul></div></footer>";
    }
    else if (k === "__action_db__") out += extra.actionDbHtml || "<p><i>[Action plan database]</i></p>";
  }
  close();
  return out;
}
// Action plan grouped by phase (the Notion page has the same rows in the inline database, with By Phase and Timeline views).
export function renderActionPlan(rows, fmtRange) {
  const phases = [...new Set(rows.map((r) => r.phase))];
  // Item numbers follow the order shown; a repeated step block is shown once, under its first item.
  const shown = phases.flatMap((ph) => rows.filter((r) => r.phase === ph));
  const firstHow = new Map();
  shown.forEach((r, i) => { if (!firstHow.has(r.how)) firstHow.set(r.how, i + 1); else r.sameAs = firstHow.get(r.how); });
  return phases.map((ph) => {
    const rs = rows.filter((r) => r.phase === ph);
    const when = rs[0].start ? fmtRange(rs[0].start, rs[rs.length - 1].end) : "When your team has capacity";
    return '<section class="ph"><h3>' + esc(ph) + ': <span class="when">' + esc(when) + "</span></h3><ul class=\"acts\">" +
      rs.map((r) => '<li><span class="tick">✓</span><div><b>' + esc(r.action) + '</b><div class="aim"><span>Priority: ' + esc(r.priority) + "</span><span>" + esc(r.domain) + "</span>" + (r.owner ? "<span>Owner: " + esc(r.owner) + "</span>" : "") + "</div>" +
        (r.sameAs ? '<p class="how"><b>Steps:</b> Same steps as item ' + r.sameAs + ".</p>" : '<p class="how"><b>Steps:</b> ' + esc(r.how) + "</p>") + (r.impact ? "<p><b>Impact:</b> " + esc(r.impact) + "</p>" : "") +
        (r.planNote ? "<p><b>Plan note:</b> " + esc(r.planNote) + "</p>" : "") + (r.source ? '<p><a href="' + esc(r.source) + '" rel="noopener">Notion help</a></p>' : "") + "</div></li>").join("") + "</ul></section>";
  }).join("");
}
// Page CSS, shared by /r/, /f/ and (scoped under .scres) the quiz page's on-screen result.
export const PAGE_CSS =
    "img.stair{display:block;width:600px;max-width:100%;height:auto;margin:12px 0 4px}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#051C2C;max-width:820px;margin:0 auto;padding:32px 20px 64px;line-height:1.6;overflow-wrap:anywhere}" +
    "h1{font-size:30px;margin:0 0 8px}h2{font-size:26px;margin:32px 0 10px}h3{font-size:19px;margin:20px 0 8px}summary h3{display:inline}summary{cursor:pointer;margin:12px 0 6px;min-height:44px;padding:10px 0;box-sizing:border-box}" +
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}a{padding:14px 0}a.tl{display:inline-flex;align-items:center;min-height:44px;padding:0 10px}" +
    "a.cta{display:inline-flex;align-items:center;min-height:44px;padding:12px 20px;background:#051C2C;color:#fff;border-radius:8px;font-weight:600;text-decoration:none;margin:4px 0}" +
    "footer{margin-top:32px;font-size:14px;color:#5B6672}footer p{margin:6px 0}footer a.tl:first-child{padding-left:0}td.ni::before{display:none}" +
    "td .bk{display:flex;align-items:center;justify-content:center;min-height:44px;text-align:center;text-decoration:none;font-weight:600;border-radius:8px;padding:8px 10px;margin:8px 0 0;font-size:14px}td .bk-wa{background:#25D366;color:#fff}td .bk-em{background:#051C2C;color:#fff}" +
    ".ph{border:1px solid #E5E7EB;border-radius:10px;margin:14px 0;padding:4px 16px 8px}.ph h3{margin:12px 0 6px}.when{font-weight:400;font-size:14px;color:#5B6672}.acts{list-style:none;padding:0;margin:0}.acts li{display:flex;gap:10px;border-top:1px solid #E5E7EB;padding:12px 0}.acts li:first-child{border-top:0}.acts p{margin:6px 0 0;font-size:14.5px}" +
    "@media (max-width:640px){body{padding:20px 14px 48px}h1.pt{font-size:26px}table.st,table.st tbody,table.st tr,table.st td,table.st th{display:block;width:100%}table.st.hh tr:first-child{display:none}table.st tr{border:1px solid #E5E7EB;border-radius:8px;margin:0 0 10px;padding:6px 10px}table.st th,table.st td{border:0;padding:4px 0}table.st td::before{content:attr(data-label);display:block;font-size:12.5px;color:#5B6672}table.st td:empty,table.st td[data-label=\"\"]::before{display:none}}" +
    "table{border-collapse:collapse;width:100%;font-size:14.5px;margin:8px 0}th,td{border:1px solid #E5E7EB;padding:7px 9px;text-align:left;vertical-align:top}th{background:#F5F5F5}" +
    ".co{display:flex;gap:10px;padding:14px 16px;border-radius:8px;margin:10px 0}.co p{margin:0}a{color:#2251FF}.tick{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px;background:#16A34A;color:#fff;font-weight:700;font-size:13px;line-height:1;vertical-align:-3px}" +
    "h1.pt{font-size:34px;margin:4px 0 14px}.ph{border:1px solid #E5E7EB;border-radius:10px;margin:12px 0;overflow:hidden}.phh{display:flex;justify-content:space-between;gap:10px;background:#F5F5F5;padding:10px 14px;font-size:15px}.phh span{color:#5B6672}" +
    ".ai{border-top:1px solid #E5E7EB;padding:10px 14px}.ai summary{margin:0;font-weight:600}.ai p{margin:8px 0 0;font-size:14.5px}.aim{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.aim span{font-size:12.5px;background:#EEF2FF;border-radius:4px;padding:2px 8px}" +
    ".pri{font-size:12px;border-radius:4px;padding:1px 7px;margin-right:4px}.p-high{background:#FDECEC;color:#B91C1C}.p-medium{background:#FFF1E6;color:#C2410C}.p-low{background:#E7F7EC;color:#0F7A32}.dry{background:#FFF3C4;border:1px solid #E8C95A;padding:10px 14px;border-radius:8px;font-size:14px}" +
    // Footer links wrap as units; each separator sits before its item and is clipped at the start of every line.
    "footer .fw{overflow:hidden}footer ul.fl{display:flex;flex-wrap:wrap;list-style:none;margin:0 0 0 -1.2em;padding:0}footer ul.fl li{display:flex;align-items:center;white-space:nowrap}footer ul.fl li::before{content:'·';display:inline-block;width:1.2em;text-align:center}footer ul.fl a.tl{padding:0}" +
    // Header cells never break mid-word.
    "th{overflow-wrap:normal;word-break:normal;hyphens:none}" +
    ".sqw{display:block;overflow:hidden}.sq{display:flex;flex-wrap:wrap;align-items:center;margin-left:-1.2em}.sg{display:flex;align-items:center;min-width:0;max-width:100%}.sg::before{content:'·';flex:none;width:1.2em;text-align:center}.sgc{min-width:0}.sgc a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0 12px}";
// Prefix every selector with .scres so the result can sit inside another page (the quiz) without touching its styles.
export function scopedCss(css = PAGE_CSS, scope = ".scres") {
  const pre = (sel) => sel.split(",").map((x) => { x = x.trim(); return x === "body" ? scope : x === "*" ? scope + " *" : scope + " " + x; }).join(",");
  let out = "", i = 0;
  while (i < css.length) {
    const ob = css.indexOf("{", i); if (ob < 0) break;
    const sel = css.slice(i, ob).trim();
    if (sel.startsWith("@media")) { let depth = 1, j = ob + 1; while (depth && j < css.length) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; } out += sel + "{" + scopedCss(css.slice(ob + 1, j - 1), scope) + "}"; i = j; continue; }
    const cb = css.indexOf("}", ob); out += pre(sel) + css.slice(ob, cb + 1); i = cb + 1;
  }
  return out;
}
// Body of /r/ or /f/ without the page shell, for the quiz page's on-screen result.
export function renderFragment(title, list, extra) {
  return '<div class="scres"><h1 class="pt">🛡️ ' + esc(title) + "</h1>" + renderBlocks(list, extra || {}) + "</div>";
}
export function renderPage(title, list, banner, extra) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><link rel=\"icon\" href=\"https://www.anthonytoday.com/assets/brand/favicon.png\"><link rel=\"apple-touch-icon\" href=\"https://www.anthonytoday.com/assets/brand/apple-touch-icon.png\"><title>" + esc(title) + "</title><style>" + PAGE_CSS + "</style></head><body>" +
    (banner ? '<p class="dry">' + esc(banner) + "</p>" : "") + '<h1 class="pt">🛡️ ' + esc(title) + "</h1>" + renderBlocks(list, extra || {}) + "</body></html>";
}
