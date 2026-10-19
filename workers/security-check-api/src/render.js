// Renders Notion block arrays (after template fill) as a standalone HTML page: dry-run preview and fallback link.
import { esc } from "./validate.js";
const COL = { gray: "#6b7280", green: "#0F7A32", orange: "#C2410C", red: "#B91C1C" };
const rt = (arr) => (arr || []).map((x) => {
  let s = esc(x.text ? x.text.content : x.plain_text || "").replace(/\n/g, "<br>").replace(/✅|✓/g, '<span class="tick">✓</span>');
  const a = x.annotations || {};
  if (a.bold) s = "<b>" + s + "</b>";
  if (COL[a.color]) s = '<span style="color:' + COL[a.color] + '">' + s + "</span>";
  const url = x.text && x.text.link && x.text.link.url;
  if (url) s = '<a href="' + esc(url) + '" rel="noopener">' + s + "</a>";
  return s;
}).join("");
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
    if (k === "paragraph") out += "<p>" + rt(v.rich_text) + "</p>" + kids;
    else if (/^heading_[123]$/.test(k)) { const h = "h" + (Number(k.slice(-1)) + 1); out += v.is_toggleable ? "<details open><summary><" + h + ">" + rt(v.rich_text) + "</" + h + "></summary>" + kids + "</details>" : "<" + h + ">" + rt(v.rich_text) + "</" + h + ">"; }
    else if (k === "divider") out += "<hr>";
    else if (k === "callout") out += '<div class="co" style="background:' + (BG[v.color] || "#f5f5f5") + '"><span>' + esc(v.icon ? v.icon.emoji : "") + "</span><div>" + rt(v.rich_text) + kids + "</div></div>";
    else if (k === "table") out += "<table>" + (b.children || v.children || []).map((r, i) => "<tr>" + r.table_row.cells.map((c, j) => (i === 0 || (v.has_row_header && j === 0) ? "<th>" : "<td>") + rt(c) + (i === 0 ? "</th>" : "</td>")).join("") + "</tr>").join("") + "</table>";
    else if (k === "__action_db__") out += extra.actionDbHtml || "<p><i>[Action plan database]</i></p>";
  }
  close();
  return out;
}
// Action plan grouped by phase (the Notion page has the same rows in the inline database, with By Phase and Timeline views).
export function renderActionPlan(rows, fmt) {
  const phases = [...new Set(rows.map((r) => r.phase))];
  return phases.map((ph) => {
    const rs = rows.filter((r) => r.phase === ph);
    const when = rs[0].start ? fmt(rs[0].start) + " to " + fmt(rs[rs.length - 1].end) : "When your team has capacity";
    return '<div class="ph"><div class="phh"><b>' + esc(ph) + "</b><span>" + esc(when) + "</span></div>" +
      rs.map((r) => '<details class="ai"><summary><span class="pri p-' + esc(r.priority.toLowerCase()) + '">' + esc(r.priority) + "</span> " + esc(r.action) +
        '</summary><div class="aim"><span>' + esc(r.domain) + "</span>" + (r.owner ? "<span>Owner: " + esc(r.owner) + "</span>" : "") + "<span>Status: Not started</span></div><p><b>How:</b> " + esc(r.how) + "</p>" + (r.impact ? "<p><b>Impact:</b> " + esc(r.impact) + "</p>" : "") +
        (r.planNote ? "<p><b>Plan note:</b> " + esc(r.planNote) + "</p>" : "") + (r.source ? '<p><a href="' + esc(r.source) + '" rel="noopener">Notion help</a></p>' : "") + "</details>").join("") + "</div>";
  }).join("");
}
export function renderPage(title, list, banner, extra) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>" + esc(title) + "</title><style>" +
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#051C2C;max-width:820px;margin:0 auto;padding:32px 20px 64px;line-height:1.6}" +
    "h1{font-size:30px;margin:0 0 8px}h2{font-size:30px;margin:32px 0 10px}h3{font-size:22px;margin:28px 0 10px}h4{font-size:17px;margin:14px 0 6px;display:inline}summary{cursor:pointer;margin:12px 0 6px}" +
    "table{border-collapse:collapse;width:100%;font-size:14.5px;margin:8px 0}th,td{border:1px solid #E5E7EB;padding:7px 9px;text-align:left;vertical-align:top}th{background:#F5F5F5}" +
    ".co{display:flex;gap:10px;padding:14px 16px;border-radius:8px;margin:10px 0}.co p{margin:0}a{color:#2251FF}.tick{color:#0F7A32;font-weight:700}" +
    "h1.pt{font-size:34px;margin:4px 0 14px}.ph{border:1px solid #E5E7EB;border-radius:10px;margin:12px 0;overflow:hidden}.phh{display:flex;justify-content:space-between;gap:10px;background:#F5F5F5;padding:10px 14px;font-size:15px}.phh span{color:#5B6672}" +
    ".ai{border-top:1px solid #E5E7EB;padding:10px 14px}.ai summary{margin:0;font-weight:600}.ai p{margin:8px 0 0;font-size:14.5px}.aim{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.aim span{font-size:12.5px;background:#EEF2FF;border-radius:4px;padding:2px 8px}" +
    ".pri{font-size:12px;border-radius:4px;padding:1px 7px;margin-right:4px}.p-high{background:#FDECEC;color:#B91C1C}.p-medium{background:#FFF1E6;color:#C2410C}.p-low{background:#E7F7EC;color:#0F7A32}td a,th a{white-space:nowrap}.dry{background:#FFF3C4;border:1px solid #E8C95A;padding:10px 14px;border-radius:8px;font-size:14px}</style></head><body>" +
    (banner ? '<p class="dry">' + esc(banner) + "</p>" : "") + '<h1 class="pt">🛡️ ' + esc(title) + "</h1>" + renderBlocks(list, extra || {}) + "</body></html>";
}
