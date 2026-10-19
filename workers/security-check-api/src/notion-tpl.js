// Fills the Notion TEMPLATE pages (Free Result, Fix List) per the placeholder map:
// reads the template's blocks through the API, applies {{tokens}} and {{#if}} blocks, writes a new page.
// The Notion API cannot duplicate a page or a database, so the page is rebuilt block by block and the
// action database is re-created with the template's schema (views cannot be created through the API: gap).
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

function fillRt(rt, T) {
  const out = [];
  for (const x of rt || []) {
    const content = x.plain_text ?? x.text?.content ?? "";
    let url = x.href || x.text?.link?.url || null;
    if (url && /\{\{stripe_link\}\}|%7B%7Bstripe_link%7D%7D/.test(url)) url = T.stripe_link;
    const parts = content.split(/(\{\{\w+\}\})/);
    for (const part of parts) {
      if (!part) continue;
      const m = part.match(/^\{\{(\w+)\}\}$/);
      if (m && m[1] in T) {
        const v = T[m[1]];
        if (v && typeof v === "object" && !Array.isArray(v)) { if (v.link) out.push(txt(v.text, { url: v.link })); continue; }
        if (Array.isArray(v)) { out.push(txt(v.map((i) => (i.b || "") + (i.t || "")).join("; "), { color: x.annotations?.color })); continue; }
        out.push({ type: "text", text: { content: String(v), link: url ? { url } : null }, annotations: x.annotations });
      } else out.push({ type: "text", text: { content: part, link: url ? { url } : null }, annotations: x.annotations });
    }
  }
  return out;
}

// Inline {{#if x}}a{{else}}b{{/if}} inside one block: evaluated on the joined text (formatting of that block is simplified).
function inlineIf(rt, T) {
  const s = plain(rt);
  if (!/\{\{#if /.test(s)) return rt;
  const r = s.replace(/\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (m, k, a, b) => (truthy(T[k]) ? a : b || ""));
  return [txt(r, { color: "gray" })];
}

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
    const mList = text.match(/^\{\{(\w+)\}\}$/);
    if (mList && Array.isArray(T[mList[1]])) {
      const name = mList[1], items = T[name];
      if (name === "flags") { out.push({ type: "paragraph", paragraph: { rich_text: items.flatMap((it, n) => [...(n ? [txt("\n")] : []), ...itemRt(it)]) } }); continue; }
      const type = LIST_NUMBERED.has(name) ? "numbered_list_item" : LIST_BULLET.has(name) || k === "bulleted_list_item" ? "bulleted_list_item" : "numbered_list_item";
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
    for (const f of RO) delete nb[f];
    if (nb[k].rich_text) nb[k].rich_text = fillRt(inlineIf(nb[k].rich_text, T), T);
    if (k === "table_row") nb[k].cells = v.cells.map((c) => fillRt(c, T));
    if (b.children) nb.children = transform(b.children, T, {});
    out.push(nb);
  }
  return out;
}

// Writes blocks under parentId, handling Notion's 100-per-request and 2-level nesting limits.
export async function writeTree(api, parentId, blocks, hooks = {}) {
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const send = batch.map(({ children, ...b }) => (b.type === "table" ? { ...b, table: { ...b.table, children } } : b));
    const res = await api.call("PATCH", "/blocks/" + parentId + "/children", { children: send });
    for (let i = 0; i < batch.length; i++) if (batch[i].children && batch[i].type !== "table" && batch[i].children.length) await writeTree(api, res.results[i].id, batch[i].children, hooks);
    batch = [];
  };
  for (const b of blocks) {
    if (b.type === "__action_db__") { await flush(); if (hooks.actionDb) await hooks.actionDb(parentId, b.source); continue; }
    batch.push(b);
    if (batch.length === 100) await flush();
  }
  await flush();
}

// Action plan rows (gap: no per-question action library yet). Built from the Fix steps of the top 3 risks,
// 5 to 7 rows, Phase 1 = risk 1, Phase 2 = risk 2, Phase 3 = risk 3; dates for Phase 1 and 2 only.
export function actionRows(data, r, reportDate) {
  const q = Object.fromEntries(data.questions.map((x) => [x.id, x]));
  const dom = Object.fromEntries(data.domains.map((d) => [d.id, d.name]));
  const rows = [];
  const per = [3, 2, 2];
  const day = (n) => new Date(new Date(reportDate).getTime() + n * 86400000).toISOString().slice(0, 10);
  r.topRisks.forEach((x, i) => {
    const qq = q[x.id];
    for (const f of qq.fixes.slice(0, per[i])) {
      const first = f.text.split(/(?<=\.)\s/)[0];
      rows.push({ action: first.length > 140 ? first.slice(0, 137) + "..." : first, impact: "Closes risk: " + qq.title, domain: dom[qq.domain], phase: "Phase " + (i + 1),
        priority: ["High", "Medium", "Low"][i], owner: "Workspace Owner", start: i < 2 ? day(i * 7) : null, end: i < 2 ? day(i * 7 + 4) : null, how: f.text, source: f.source,
        planNote: (qq.plan_notes || [])[0]?.text || "" });
    }
  });
  return rows.slice(0, 7);
}
