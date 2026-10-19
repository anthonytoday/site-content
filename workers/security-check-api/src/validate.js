// Strict input controls (tech spec, Input Controls). Every non-typed field must be an exact option value.
// Typed fields: name (60), company (80), work email (format). Stored as data only; no LLM anywhere in this Worker.
import { DISPOSABLE } from "./disposable.js";
export const isDisposable = (email) => { const d = String(email).split("@")[1] || ""; const parts = d.toLowerCase().split("."); for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join("."))) return true; return false; };
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Academic and school domains: get the result, flagged edu, never marketed to.
const EDU_RE = /(\.edu$|\.edu\.[a-z]{2,3}$|\.ac\.[a-z]{2,3}$|\.k12\.[a-z]{2}\.us$|\.sch\.[a-z]{2,3}$|\.school$|\.ac$|\.edu\.[a-z]{2}\.[a-z]{2}$)/i;
const CTRL_RE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

export function cleanText(v, max) {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFKC").replace(CTRL_RE, " ").replace(/\s+/g, " ").trim();
  if (!s || s.length > max) return null;
  return s;
}

export function isEdu(email) {
  const domain = email.split("@")[1].toLowerCase();
  return EDU_RE.test(domain);
}

export function mapSource(data, raw) {
  if (typeof raw !== "string") return "Website";
  const k = raw.toLowerCase().replace(/[^a-z_]/g, "").slice(0, 30);
  return data.sources[k] || (k ? "Other" : "Website");
}

export function validateSubmission(data, body) {
  const errors = [];
  const pick = (field, list) => {
    const v = body[field];
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !list.some((o) => (o.value ?? o) === v)) { errors.push(field); return undefined; }
    return v;
  };
  const p = data.profile;
  const out = {
    team_size: pick("team_size", p.team_size),
    role: pick("role", p.role),
    plan: pick("plan", p.plan) || "not_sure",
    country: pick("country", p.country),
    industry: pick("industry", p.industry) || null,
  };
  if (!out.team_size) errors.push("team_size");
  if (!out.role) errors.push("role");
  if (!out.country) errors.push("country");
  out.name = cleanText(body.name, 60); if (!out.name) errors.push("name");
  out.company = cleanText(body.company, 80); if (!out.company) errors.push("company");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) errors.push("email"); else if (isDisposable(email)) errors.push("email_disposable"); else out.email = email;
  if (body.consent !== true) errors.push("consent");
  out.consent = body.consent === true;
  out.source = mapSource(data, body.source);
  // Answers: exactly 12, each A-D; NA only on Q7/Q8 and only for solo owners.
  const answers = {};
  const a = body.answers && typeof body.answers === "object" ? body.answers : {};
  const allowedKeys = new Set(data.questions.map((q) => q.id));
  for (const k of Object.keys(a)) if (!allowedKeys.has(k)) errors.push("answers." + k.slice(0, 10));
  for (const q of data.questions) {
    const v = a[q.id];
    const ok = ["A", "B", "C", "D"].includes(v) || (v === "NA" && q.solo_na && out.team_size === "solo");
    // Solo owners do not see "I don't know" on Q7/Q8 (replaced by NA).
    if (!ok || (v === "D" && q.solo_na && out.team_size === "solo")) errors.push("answers." + q.id);
    else answers[q.id] = v;
  }
  out.answers = answers;
  if (out.email) out.edu = isEdu(out.email);
  return { ok: errors.length === 0, errors: [...new Set(errors)], value: out };
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
