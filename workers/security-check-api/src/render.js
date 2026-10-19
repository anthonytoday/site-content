// Renders Notion block arrays (after template fill) as a standalone HTML page: dry-run preview and fallback link.
import { esc } from "./validate.js";
const COL = { gray: "#6b7280", green: "#0F7A32", orange: "#C2410C", red: "#B91C1C" };
const rt = (arr) => (arr || []).map((x) => {
  let s = esc(x.text ? x.text.content : x.plain_text || "").replace(/\n/g, "<br>");
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
export function renderPage(title, list, banner, extra) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>" + esc(title) + "</title><style>" +
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#051C2C;max-width:820px;margin:0 auto;padding:32px 20px 64px;line-height:1.6}" +
    "h1{font-size:30px;margin:0 0 8px}h2{font-size:30px;margin:32px 0 10px}h3{font-size:22px;margin:28px 0 10px}h4{font-size:17px;margin:14px 0 6px;display:inline}summary{cursor:pointer;margin:12px 0 6px}" +
    "table{border-collapse:collapse;width:100%;font-size:14.5px;margin:8px 0}th,td{border:1px solid #E5E7EB;padding:7px 9px;text-align:left;vertical-align:top}th{background:#F5F5F5}" +
    ".co{display:flex;gap:10px;padding:14px 16px;border-radius:8px;margin:10px 0}.co p{margin:0}a{color:#2251FF}.dry{background:#FFF3C4;border:1px solid #E8C95A;padding:10px 14px;border-radius:8px;font-size:14px}</style></head><body>" +
    (banner ? '<p class="dry">' + esc(banner) + "</p>" : "") + renderBlocks(list, extra || {}) + "</body></html>";
}
