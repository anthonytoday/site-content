// Thin Notion API client and the "Security Check Leads" mapping (the ONLY database this Worker writes).
// It never reads or writes CRM Contacts.
export class Notion {
  constructor(token, version = "2025-09-03") { this.token = token; this.version = version; this.calls = 0; }
  async call(method, path, body) {
    this.calls++;
    const res = await fetch("https://api.notion.com/v1" + path, { method, headers: { Authorization: "Bearer " + this.token, "Notion-Version": this.version, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("notion " + method + " " + path.split("?")[0] + " " + res.status + " " + (j.code || "") + " " + (j.message || "").slice(0, 200));
    return j;
  }
  // Leads DB is addressed by its data source id (API 2025-09-03); resolved once from the database id.
  async leadsDataSource(dbId) {
    if (this._ds) return this._ds;
    const db = await this.call("GET", "/databases/" + dbId);
    this._ds = (db.data_sources && db.data_sources[0] && db.data_sources[0].id) || dbId;
    return this._ds;
  }
  async findLead(dbId, email) {
    const ds = await this.leadsDataSource(dbId);
    const j = await this.call("POST", "/data_sources/" + ds + "/query", { filter: { property: "Email", email: { equals: email } }, page_size: 1 });
    return j.results[0] || null;
  }
  async upsertLead(dbId, email, props) {
    const ex = await this.findLead(dbId, email);
    if (ex) {
      // Never clear Do Not Email once set (unsubscribes are sticky).
      if (ex.properties["Do Not Email"] && ex.properties["Do Not Email"].checkbox) props["Do Not Email"] = { checkbox: true };
      if (ex.properties["Fix List Paid"] && ex.properties["Fix List Paid"].checkbox) { delete props["Fix List Paid"]; delete props.Stage; }
      await this.call("PATCH", "/pages/" + ex.id, { properties: props });
      return { id: ex.id, created: false };
    }
    const ds = await this.leadsDataSource(dbId);
    const p = await this.call("POST", "/pages", { parent: { type: "data_source_id", data_source_id: ds }, properties: props });
    return { id: p.id, created: true };
  }
}
const rtext = (s) => ({ rich_text: [{ type: "text", text: { content: String(s).slice(0, 1990) } }] });
const sel = (v) => ({ select: v ? { name: v } : null });
export function leadProperties(data, sub, r, resultUrl) {
  const label = (list, v) => (list.find((o) => o.value === v) || {}).label || null;
  return {
    Name: { title: [{ type: "text", text: { content: sub.name } }] },
    Email: { email: sub.email },
    Company: rtext(sub.company),
    "Team Size": sel(label(data.profile.team_size, sub.team_size)),
    "Notion Plan": sel(label(data.profile.plan, sub.plan)),
    Score: { number: r.total },
    Level: sel(r.level + " " + r.levelName),
    "Critical Flags": { multi_select: r.flags.map((f) => ({ name: f.label })) },
    "Result Page": { url: resultUrl || null },
    Stage: { status: { name: sub.held ? "Held" : "Result sent" } },
    "Education Address": { checkbox: !!sub.edu },
    "Do Not Email": { checkbox: !!sub.edu || !!sub.unsubscribed },
    Consent: { checkbox: !!sub.consent },
    Source: sel(sub.source),
    "Fix List Paid": { checkbox: false },
  };
}
export function paidProperties(sessionId) {
  return { "Fix List Paid": { checkbox: true }, "Stripe Session": rtext(sessionId), Stage: { status: { name: "Fix List paid" } } };
}
