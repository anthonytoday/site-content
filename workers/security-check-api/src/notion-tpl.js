// Fills the Notion TEMPLATE pages (Free Result, Fix List) per the placeholder map:
// reads the template's blocks through the API, applies {{tokens}} and {{#if}} blocks, writes a new page.
// The Notion API cannot duplicate a page or a database, so the page is rebuilt block by block and the
// action database is re-created with the template's schema (views cannot be created through the API: gap).
import { REWRITES } from "./copy.js";
// Approved wording swaps (copy.js), run by run, before tokens are filled.
const rewrite = (rt) => (rt || []).map((x) => { let c = x.plain_text ?? x.text?.content ?? ""; const o = c; for (const [a, b] of REWRITES) if (!c.includes(b)) c = c.split(a).join(b); return c === o ? x : { ...x, plain_text: c, text: { ...(x.text || {}), content: c } }; });
const LIST_NUMBERED = new Set(["priority_risks", "risk_list"]);
const LIST_BULLET = new Set(["plan_features_unused"]);
const RO = ["id", "created_time", "last_edited_time", "created_by", "last_edited_by", "has_children", "archived", "in_trash", "parent", "request_id"];
const plain = (rt) => (rt || []).map((x) => x.plain_text ?? (x.text && x.text.content) ?? "").join("");
const txt = (content, o = {}) => ({ type: "text", text: { content: String(content).slice(0, 1990), link: o.url ? { url: o.url } : null }, annotations: { bold: !!o.bold, italic: false, strikethrough: false, underline: false, code: false, color: o.color || "default" } });
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!(v && v !== "0"));
const itemRt = (it) => [...(it.b ? [txt(it.b, { bold: true })] : []), txt(it.t || ""), ...(it.url ? [txt(it.urlText || "Notion help", { url: it.url })] : [])];

export async function readTree(api, id, depth = 0) {
  const out = [];
  let cursor;
  do {
    const j = await api.call("GET", "/blocks/" + id + "/children?page_size=100" + (cursor ? "&start_cursor=" + cursor : ""));
    for (const b of j.results) {
      if (b.has_children && depth < 3 && b.type !== "child_database" && b.type !== "child_page") b.children = await readTree(api, b.id, depth + 1);
      out.push(b);
    }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out;
}

const WA = "https://wa.me/33695845150", MAILTO = "mailto:admin@anthonytoday.com";
// Link URLs can carry tokens too ({{result_id}}, {{stripe_link}}); every Stripe Payment Link gets client_reference_id = result id.
export function fillUrl(url, T) {
  if (!url) return url;
  if (/\{\{stripe_link\}\}|%7B%7Bstripe_link%7D%7D/.test(url)) return T.stripe_link;
  url = url.replace(/(?:\{\{|%7B%7B)(\w+)(?:\}\}|%7D%7D)/g, (m, k) => (k in T && typeof T[k] !== "object" ? encodeURIComponent(String(T[k])) : ""));
  if (/^https:\/\/buy\.stripe\.com\//.test(url) && T.result_id && !/[?&]client_reference_id=/.test(url)) url += (url.includes("?") ? "&" : "?") + "client_reference_id=" + encodeURIComponent(T.result_id);
  return url;
}
function fillRt(rt, T) {
  const out = [];
  for (const x of rt || []) {
    const content = x.plain_text ?? x.text?.content ?? "";
    const url = fillUrl(x.href || x.text?.link?.url || null, T);
    const parts = content.split(/(\{\{\w+\}\})/);
    for (const part of parts) {
      if (!part) continue;
      const m = part.match(/^\{\{(\w+)\}\}$/);
      if (m && m[1] in T) {
        const v = T[m[1]];
        if (v && typeof v === "object" && !Array.isArray(v)) { if (v.link) out.push(txt(v.text, { url: v.link })); continue; }
        if (Array.isArray(v)) { out.push(txt(v.map((i) => (i.b || "") + (i.t || "")).join("; "), { color: x.annotations?.color })); continue; }
        if (String(v) === "") continue;
        out.push({ type: "text", text: { content: String(v), link: url ? { url } : null }, annotations: x.annotations });
      } else out.push({ type: "text", text: { content: part, link: url ? { url } : null }, annotations: x.annotations });
    }
  }
  return out;
}

// Inline {{#if x}}a{{else}}b{{/if}} inside one block, keeping each run's formatting and links.
function inlineIf(rt, T) {
  const segs = (rt || []).map((x) => ({ x, s: x.plain_text ?? x.text?.content ?? "" }));
  const all = segs.map((g) => g.s).join("");
  if (!/\{\{#if /.test(all)) return rt;
  const keep = new Array(all.length).fill(true);
  const re = /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
  let m;
  while ((m = re.exec(all))) {
    const yes = truthy(T[m[1]]);
    const openLen = m[0].indexOf("}}") + 2, aStart = m.index + openLen, aEnd = aStart + m[2].length;
    const elseLen = m[3] !== undefined ? 8 : 0, bStart = aEnd + elseLen, bEnd = bStart + (m[3] || "").length;
    for (let i = m.index; i < m.index + m[0].length; i++) {
      const inA = i >= aStart && i < aEnd, inB = m[3] !== undefined && i >= bStart && i < bEnd;
      keep[i] = (inA && yes) || (inB && !yes);
    }
  }
  const out = [];
  let pos = 0;
  for (const g of segs) {
    let t = "";
    for (let i = 0; i < g.s.length; i++) if (keep[pos + i]) t += g.s[i];
    pos += g.s.length;
    if (t) out.push({ ...g.x, plain_text: t, text: { ...(g.x.text || {}), content: t } });
  }
  return out;
}
const linkRun = (t, url) => txt(t, { url });
const bookBar = () => [txt("\n"), linkRun("Book on WhatsApp", WA), txt(" · "), linkRun("Email", MAILTO)];

export function transform(blocks, T, ctx = {}) {
  const out = [];
  const skip = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const k = b.type, v = b[k] || {};
    const text = plain(v.rich_text).trim();
    const mIf = text.match(/^\{\{#if (\w+)\}\}$/);
    if (mIf) { skip.push(!truthy(T[mIf[1]])); continue; }
    if (text === "{{/if}}") { skip.pop(); continue; }
    if (text === "{{else}}") { skip.push(!skip.pop()); continue; }
    if (skip.some(Boolean)) continue;
    if (/^EXAMPLE DATA/.test(text)) continue;
    // Plain levels legend -> maturity staircase image (external) plus the footnote line.
    if (k === "paragraph" && /^Legend:\s*$/.test(text) && T.maturity_img_url) {
      while (blocks[i + 1] && blocks[i + 1].type === "bulleted_list_item" && /^Level \d/.test(plain(blocks[i + 1].bulleted_list_item.rich_text).trim())) i++;
      out.push({ type: "image", image: { type: "external", external: { url: T.maturity_img_url }, caption: [{ type: "text", text: { content: T.maturity_alt } }] } });
      out.push({ type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: T.maturity_footnote }, annotations: { color: "gray" } }] } });
      continue;
    }
    // Template staircase image: swap in the PNG for this result's level and its alt text.
    if (k === "image" && v.type === "external" && /maturity-level-\d\.png/.test(v.external.url) && T.maturity_img_url) {
      out.push({ type: "image", image: { type: "external", external: { url: T.maturity_img_url }, caption: [{ type: "text", text: { content: T.maturity_alt } }] } });
      continue;
    }
    if (k === "paragraph" && /^➡️\s*Book on WhatsApp/.test(text)) { ctx.droppedBar = true; continue; }
    if (k === "divider" && ctx.droppedBar && out.length && out[out.length - 1].type === "divider") { ctx.droppedBar = false; continue; }
    const mList = text.match(/^\{\{(\w+)\}\}$/);
    if (mList && Array.isArray(T[mList[1]])) {
      const name = mList[1], items = T[name];
      if (name === "flags") { out.push({ type: "paragraph", paragraph: { rich_text: items.flatMap((it, n) => [...(n ? [txt("\n")] : []), ...itemRt(it)]) } }); continue; }
      const type = LIST_NUMBERED.has(name) ? "numbered_list_item" : LIST_BULLET.has(name) || k === "bulleted_list_item" ? "bulleted_list_item" : "numbered_list_item";
      if (name === "plan_features_unused" && items.length > 3) {
        // Top 3 most relevant as bullets, the rest in a collapsed toggle.
        for (const it of items.slice(0, 3)) out.push({ type, [type]: { rich_text: itemRt(it) } });
        out.push({ type: "toggle", toggle: { rich_text: [txt("More features in your plan")] }, children: items.slice(3).map((it) => ({ type, [type]: { rich_text: itemRt(it) } })) });
        continue;
      }
      for (const it of items) out.push({ type, [type]: { rich_text: itemRt(it) } });
      continue;
    }
    // Conditional headings per the map.
    if (/^Other Risks to Watch/.test(text) && !truthy(T.risk_list)) continue;
    if (/^Already in Your/.test(text) && !truthy(T.plan_features_unused)) continue;
    if (/^Two Quick Wins/.test(text)) { ctx.quickWins = true; }
    else if (ctx.quickWins && k === "numbered_list_item") { if (!ctx.qwDone) { ctx.qwDone = true; for (const it of T.quick_wins) out.push({ type: k, [k]: { rich_text: itemRt(it) } }); } continue; }
    else if (k !== "numbered_list_item") ctx.quickWins = false;
    if (k === "child_database") { out.push({ type: "__action_db__", source: b }); continue; }
    if (k === "child_page" || k === "unsupported" || k === "link_preview") continue;
    const nb = { type: k, [k]: JSON.parse(JSON.stringify(v)) };
    for (const f of Object.keys(nb[k])) if (nb[k][f] === null) delete nb[k][f]; // read API returns e.g. paragraph.icon: null, which the write API rejects
    for (const f of RO) delete nb[f];
    if (nb[k].rich_text) nb[k].rich_text = fillRt(inlineIf(rewrite(nb[k].rich_text), T), T);
    // Nothing dangling: a sentence token that came out empty leaves no trailing space.
    if (nb[k].rich_text && nb[k].rich_text.length) { const last = nb[k].rich_text[nb[k].rich_text.length - 1]; if (last.text && / +$/.test(last.text.content)) { last.text.content = last.text.content.replace(/ +$/, ""); if (!last.text.content) nb[k].rich_text.pop(); } }
    if (k === "table_row") {
      nb[k].cells = v.cells.map((c) => fillRt(c, T));
      // WhatsApp / Email under the two paid offers, as in Anthony's approved sample.
      if (ctx.offerRow === b) nb[k].cells = nb[k].cells.map((c, j) => (j >= 2 && plain(c).trim() ? [...c, ...bookBar()] : c));
    }
    if (k === "table" && b.children) {
      const rows = b.children.filter((r) => r.type === "table_row");
      const first = (r) => plain(r.table_row.cells[0] || []).trim();
      if (rows.some((r) => /Option A/.test(plain(r.table_row.cells[2] || [])))) ctx.offerTable = rows.find((r) => first(r) === "Book") || rows.find((r) => first(r) === "Price");
    }
    if (b.children) nb.children = transform(b.children, T, { offerRow: ctx.offerTable || null });
    // Overall Level callout: only the small label stays bold.
    if (k === "callout" && /^Overall Level/.test(text) && nb.children) nb.children.forEach((c) => { const ct = c[c.type] && c[c.type].rich_text; if (ct && /^Level /.test(plain(ct))) ct.forEach((x) => { x.annotations = { ...(x.annotations || {}), bold: false }; }); });
    // Domain Profile: add the Overall row in the same layout.
    if (k === "table" && nb.children && plain(nb.children[0].table_row.cells[0] || []).trim() === "Area" && T.overall_bar) {
      ctx.levelNoteAfter = true;
      nb.children.push({ type: "table_row", table_row: { cells: [[{ type: "text", text: { content: "Overall" }, annotations: { bold: true } }], [txt(T.overall_bar)], [txt(T.overall_score + "/100")], [txt("Level " + T.overall_level_number + ", " + T.overall_level)]] } });
      nb[k].table_width = nb[k].table_width || 4;
    }
    if (k === "table") ctx.offerTable = null;
    out.push(nb);
    // Item 6: the level note as a small gray line directly under the Domain Profile table.
    if (ctx.levelNoteAfter && T.level_note) { ctx.levelNoteAfter = false; out.push({ type: "paragraph", paragraph: { rich_text: [txt(T.level_note, { color: "gray" })] } }); }
  }
  return out;
}

// Writes blocks under parentId. Notion accepts two nesting levels per request, so shallow subtrees are sent inline
// (fewer subrequests on the free plan); deeper ones are appended level by level.
const depth = (b) => 1 + Math.max(0, ...(b.children || []).map(depth));
const inline = ({ children, ...b }) => (children && children.length ? { ...b, [b.type]: { ...b[b.type], children: children.map(inline) } } : b);
export async function writeTree(api, parentId, blocks, hooks = {}) {
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const send = batch.map((b) => (depth(b) <= 2 ? inline(b) : (({ children, ...x }) => x)(b)));
    const res = await api.call("PATCH", "/blocks/" + parentId + "/children", { children: send });
    for (let i = 0; i < batch.length; i++) if (batch[i].children && batch[i].children.length && depth(batch[i]) > 2) await writeTree(api, res.results[i].id, batch[i].children, hooks);
    batch = [];
  };
  for (const b of blocks) {
    if (b.type === "__action_db__") { await flush(); if (hooks.actionDb) await hooks.actionDb(parentId, b.source); continue; }
    batch.push(b);
    if (batch.length === 100) await flush();
  }
  await flush();
}

export { actionRows } from "./tokens.js";

// Standard footer for the Notion pages and the Worker-rendered /r/ and /f/ (emails keep their own footer).
// No Terms link: https://www.anthonytoday.com/terms/ returns 404 (checked 19 Oct 2026).
export function withFooter(blocks, web = false) {
  const link = (t, u) => ({ type: "text", text: { content: t, link: { url: u } } });
  const foot = [
    { type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "© 2026 Anthony Today. All rights reserved." }, annotations: { color: "gray" } }] } },
    { type: "paragraph", paragraph: { rich_text: [link("Privacy policy", "https://www.anthonytoday.com/privacy/"), txt(" · "), link("Contact", "https://www.anthonytoday.com/contact/"), txt(" · "), link("www.anthonytoday.com", "https://www.anthonytoday.com/")] } }];
  // Web (/r/, /f/): wrapped in a <footer> element by the renderer. Notion: plain blocks after a divider.
  return web ? [...blocks, { type: "__footer__", children: foot }] : [...blocks, { type: "divider", divider: {} }, ...foot];
}
