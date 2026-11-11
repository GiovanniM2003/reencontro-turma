import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const slug = (n) =>
  n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

async function hashPin(pin, key) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}:${pin}:reencontro`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\//, "");
  const store = getStore({ name: "reencontro", consistency: "strong" });

  if (route === "results" && req.method === "GET") {
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    const rows = all
      .filter(Boolean)
      .map(({ name, agree, altDate, note, updatedAt }) => ({ name, agree, altDate, note, updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return json(rows);
  }

  if (req.method !== "POST") return json({ error: "Rota não encontrada" }, 404);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Dados inválidos" }, 400); }

  const name = String(body.name || "").replace(/\s+/g, " ").trim();
  const pin = String(body.pin || "");
  if (name.length < 3 || name.length > 80) return json({ error: "Digite seu nome completo." }, 400);
  if (!/^\d{4,6}$/.test(pin)) return json({ error: "A senha deve ter de 4 a 6 números." }, 400);

  const key = slug(name);
  const existing = await store.get(key, { type: "json" });
  const pinHash = await hashPin(pin, key);
  if (existing && existing.pinHash !== pinHash) return json({ error: "Senha incorreta para esse nome." }, 403);

  if (route === "login") {
    if (!existing) return json({ error: "Nome ainda não cadastrado." }, 404);
    const { agree, altDate, note } = existing;
    return json({ name: existing.name, agree, altDate, note });
  }

  if (route === "vote") {
    const agree = body.agree === "yes" ? "yes" : body.agree === "no" ? "no" : null;
    if (!agree) return json({ error: "Escolha uma opção de data." }, 400);
    const altDate = agree === "no" ? String(body.altDate || "") : "";
    if (agree === "no" && !/^\d{4}-\d{2}-\d{2}$/.test(altDate)) return json({ error: "Informe a data que prefere." }, 400);
    const note = String(body.note || "").slice(0, 500);
    await store.setJSON(key, { name, pinHash, agree, altDate, note, updatedAt: new Date().toISOString() });
    return json({ ok: true });
  }

  return json({ error: "Rota não encontrada" }, 404);
};

export const config = { path: "/api/*" };
