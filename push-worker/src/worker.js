import webpush from "web-push";

const ALLOWED_ORIGINS = new Set([
  "https://onive4.github.io",
  "http://localhost:8080",
]);

const VAPID_PUBLIC_KEY =
  "BGaHpocQhW4uet-gc5UtHdy_VW1n6w50y8_F0IesufoxraQph2kpGkzo82suXas4Mj9cPh9p7DOXIqu38iFW77o";
const VAPID_SUBJECT = "https://onive4.github.io/hidrata-app/";

const MAX_BODY_BYTES = 4096;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_INTERVAL = 15;
const MAX_INTERVAL = 360;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const MESSAGES = {
  morning: [
    "☀️ Bom dia! Comece com um copo d'água antes do café.",
    "🌅 Seu corpo passou a noite sem beber nada — hora de repor!",
    "💧 Primeiro gole do dia. Bora começar bem hidratado?",
  ],
  evening: [
    "🌙 Última chance hoje de chegar perto da sua meta!",
    "🕯️ O dia está acabando — um golinho antes de dormir?",
    "⏳ Faltam poucas horas pro dia virar. Bora beber água?",
  ],
  general: [
    "💧 Hora de beber água!",
    "🚰 Seu corpo está pedindo uma pausa pra água.",
    "🌊 Bora hidratar! Um golinho agora cai bem.",
    "🥤 Que tal um copo d'água agora?",
    "💦 Psst... já bebeu água na última hora?",
    "🧊 Refresca a mente (e o corpo) com um pouco de água.",
    "🐠 Até os peixes tomariam um gole agora.",
    "🌵 Não vire um cacto — beba água!",
  ],
  safety: [
    "⏰ Faz tempo que você não bebe água? Abra o app e registre quanto já bebeu hoje.",
    "💧 Já faz umas horas sem lembrete. Beba um copo agora e atualize seu progresso no app!",
    "🔔 Passando pra lembrar: hidrate-se e registre no app quanto você já tomou.",
  ],
};

function pickMessage(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

// web-push envia via https.request do Node, que nao existe no Cloudflare Workers.
// Usamos a lib so para criptografar/assinar (VAPID) e enviamos com fetch.
async function sendPush(subscription, payload) {
  const details = webpush.generateRequestDetails(subscription, payload);
  const headers = { ...details.headers };
  delete headers["Content-Length"];
  delete headers["content-length"];
  const resp = await fetch(details.endpoint, { method: details.method, headers, body: details.body });
  if (resp.status < 200 || resp.status > 299) {
    const err = new Error(`servico de push respondeu ${resp.status}`);
    err.statusCode = resp.status;
    throw err;
  }
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validateSubscriptionShape(body) {
  if (!body || typeof body !== "object") return "corpo invalido";
  if (!ID_RE.test(body.deviceId || "")) return "deviceId invalido";
  if (typeof body.deviceSecret !== "string" || body.deviceSecret.length < 16 || body.deviceSecret.length > 128)
    return "deviceSecret invalido";
  if (!body.subscription || typeof body.subscription.endpoint !== "string" || !body.subscription.endpoint.startsWith("https://"))
    return "subscription invalida";
  const keys = body.subscription.keys || {};
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return "subscription.keys invalido";
  if (!TIME_RE.test(body.wake || "")) return "wake invalido";
  if (!TIME_RE.test(body.sleep || "")) return "sleep invalido";
  const interval = Number(body.interval);
  if (!Number.isFinite(interval) || interval < MIN_INTERVAL || interval > MAX_INTERVAL) return "interval invalido";
  const tz = Number(body.tzOffsetMinutes);
  if (!Number.isFinite(tz) || tz < -720 || tz > 840) return "tzOffsetMinutes invalido";
  if (body.safetyHours !== undefined) {
    const s = Number(body.safetyHours);
    if (!Number.isInteger(s) || (s !== 0 && (s < 2 || s > 24))) return "safetyHours invalido";
  }
  return null;
}

function inAwakeWindow(minutes, wake, sleep) {
  const start = hmToMinutes(wake);
  let end = hmToMinutes(sleep);
  let m = minutes;
  if (end <= start) {
    end += 1440;
    if (m < start) m += 1440;
  }
  return m >= start && m <= end;
}

function hmToMinutes(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHM(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
function computeReminderTimes(wake, sleep, interval) {
  const start = hmToMinutes(wake);
  let end = hmToMinutes(sleep);
  if (end <= start) end += 1440;
  const times = [];
  for (let t = start; t <= end; t += interval) times.push(minutesToHM(t));
  return times;
}
function localNow(tzOffsetMinutes) {
  const shifted = new Date(Date.now() + tzOffsetMinutes * 60000);
  const dateKey = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  const hm = `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
  return { dateKey, minutes: hmToMinutes(hm) };
}

async function handleSubscribe(request, env, origin) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload grande demais" }, 413, origin);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "json invalido" }, 400, origin);
  }
  const err = validateSubscriptionShape(body);
  if (err) return json({ error: err }, 400, origin);

  const key = `sub:${body.deviceId}`;
  const existingRaw = await env.SUBS.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  const secretHash = await sha256Hex(body.deviceSecret);

  if (existing && !timingSafeEqual(existing.secretHash, secretHash)) {
    return json({ error: "nao autorizado" }, 403, origin);
  }

  const record = {
    secretHash,
    endpoint: body.subscription.endpoint,
    keys: { p256dh: body.subscription.keys.p256dh, auth: body.subscription.keys.auth },
    wake: body.wake,
    sleep: body.sleep,
    interval: Number(body.interval),
    tzOffsetMinutes: Math.round(Number(body.tzOffsetMinutes)),
    safetyHours: body.safetyHours === undefined ? (existing && existing.safetyHours !== undefined ? existing.safetyHours : 6) : Number(body.safetyHours),
    lastSlotDate: existing ? existing.lastSlotDate || null : null,
    lastSlot: existing ? existing.lastSlot || null : null,
    lastSentAt: existing && existing.lastSentAt ? existing.lastSentAt : Date.now(),
    lastTestAt: existing ? existing.lastTestAt || 0 : 0,
    updatedAt: Date.now(),
  };
  await env.SUBS.put(key, JSON.stringify(record));
  return json({ ok: true }, 200, origin);
}

async function handleTest(request, env, origin) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload grande demais" }, 413, origin);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "json invalido" }, 400, origin);
  }
  if (!ID_RE.test(body.deviceId || "") || typeof body.deviceSecret !== "string") {
    return json({ error: "corpo invalido" }, 400, origin);
  }
  const key = `sub:${body.deviceId}`;
  const existingRaw = await env.SUBS.get(key);
  if (!existingRaw) return json({ error: "aparelho nao registrado no servidor" }, 404, origin);
  const rec = JSON.parse(existingRaw);
  const secretHash = await sha256Hex(body.deviceSecret);
  if (!timingSafeEqual(rec.secretHash, secretHash)) return json({ error: "nao autorizado" }, 403, origin);
  if (Date.now() - (rec.lastTestAt || 0) < 15000) return json({ error: "aguarde alguns segundos entre testes" }, 429, origin);
  if (!env.VAPID_PRIVATE_KEY) {
    return json({ error: "servidor sem a chave VAPID_PRIVATE_KEY configurada como segredo do Worker" }, 500, origin);
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    await sendPush(
      { endpoint: rec.endpoint, keys: rec.keys },
      JSON.stringify({ title: "Hidrata", body: "✅ Teste: as notificações reais estão funcionando!" })
    );
  } catch (e) {
    console.log(`${key}: teste falhou (status=${e.statusCode}, msg=${e.message})`);
    if (e.statusCode === 404 || e.statusCode === 410) await env.SUBS.delete(key);
    return json({ error: "falha ao enviar push", status: e.statusCode || null, detail: String(e.message || e).slice(0, 200) }, 502, origin);
  }
  rec.lastTestAt = Date.now();
  await env.SUBS.put(key, JSON.stringify(rec));
  return json({ ok: true }, 200, origin);
}

async function handleUnsubscribe(request, env, origin) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload grande demais" }, 413, origin);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "json invalido" }, 400, origin);
  }
  if (!ID_RE.test(body.deviceId || "") || typeof body.deviceSecret !== "string") {
    return json({ error: "corpo invalido" }, 400, origin);
  }
  const key = `sub:${body.deviceId}`;
  const existingRaw = await env.SUBS.get(key);
  if (existingRaw) {
    const existing = JSON.parse(existingRaw);
    const secretHash = await sha256Hex(body.deviceSecret);
    if (!timingSafeEqual(existing.secretHash, secretHash)) {
      return json({ error: "nao autorizado" }, 403, origin);
    }
    await env.SUBS.delete(key);
  }
  return json({ ok: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (!ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "origem nao autorizada" }, 403, origin);
    }
    if (url.pathname === "/subscribe" && request.method === "POST") {
      return handleSubscribe(request, env, origin);
    }
    if (url.pathname === "/subscribe" && request.method === "DELETE") {
      return handleUnsubscribe(request, env, origin);
    }
    if (url.pathname === "/test" && request.method === "POST") {
      return handleTest(request, env, origin);
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, hasVapidKey: !!env.VAPID_PRIVATE_KEY }, 200, origin);
    }
    return json({ error: "nao encontrado" }, 404, origin);
  },

  async scheduled(event, env, ctx) {
    if (!env.VAPID_PRIVATE_KEY) {
      console.error("ERRO: VAPID_PRIVATE_KEY nao esta configurada como segredo do Worker (Settings > Variables and Secrets). Nenhum push sera enviado.");
      return;
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

    let cursor;
    let total = 0;
    do {
      const list = await env.SUBS.list({ prefix: "sub:", cursor });
      cursor = list.cursor;
      for (const entry of list.keys) {
        total++;
        try {
          await processSubscription(entry.name, env);
        } catch (e) {
          console.error(`${entry.name}: erro inesperado (${e && e.message})`);
        }
      }
    } while (cursor);
    console.log(`cron finalizado: ${total} inscricao(oes) verificada(s)`);
  },
};

async function processSubscription(name, env) {
  const raw = await env.SUBS.get(name);
  if (!raw) return;
  const rec = JSON.parse(raw);
  const { dateKey, minutes } = localNow(rec.tzOffsetMinutes);
  const times = computeReminderTimes(rec.wake, rec.sleep, rec.interval);

  if (rec.lastSlotDate !== dateKey) {
    // primeira checagem do dia para este dispositivo: so marca os horarios
    // ja passados como vistos, sem disparar rajada de notificacoes atrasadas.
    const past = times.filter((t) => hmToMinutes(t) <= minutes);
    rec.lastSlotDate = dateKey;
    rec.lastSlot = past.length ? past[past.length - 1] : null;
    await env.SUBS.put(name, JSON.stringify(rec));
    console.log(`${name}: baseline do dia definido (lastSlot=${rec.lastSlot}, agora=${minutes}min)`);
    return;
  }

  const pending = times.filter((t) => hmToMinutes(t) <= minutes && (rec.lastSlot === null || hmToMinutes(t) > hmToMinutes(rec.lastSlot)));
  const due = pending.length ? pending[pending.length - 1] : null;
  const nowMs = Date.now();
  const safetyHours = rec.safetyHours === undefined ? 6 : rec.safetyHours;
  const safetyDue =
    !due &&
    safetyHours > 0 &&
    inAwakeWindow(minutes, rec.wake, rec.sleep) &&
    nowMs - (rec.lastSentAt || 0) >= safetyHours * 3600000;

  if (!due && !safetyDue) {
    console.log(`${name}: nada a enviar (lastSlot=${rec.lastSlot}, agora=${minutes}min, ultimoEnvio=${Math.round((nowMs - (rec.lastSentAt || 0)) / 60000)}min atras)`);
    return;
  }

  let pool = MESSAGES.safety;
  if (due) {
    pool = MESSAGES.general;
    if (due === times[0]) pool = MESSAGES.morning;
    else if (due === times[times.length - 1]) pool = MESSAGES.evening;
  }

  try {
    await sendPush(
      { endpoint: rec.endpoint, keys: rec.keys },
      JSON.stringify({ title: "Hidrata", body: pickMessage(pool) })
    );
    if (due) rec.lastSlot = due;
    rec.lastSentAt = nowMs;
    await env.SUBS.put(name, JSON.stringify(rec));
    console.log(`${name}: notificacao enviada (${due ? "horario " + due : "rede de seguranca de " + safetyHours + "h"})`);
  } catch (e) {
    console.error(`${name}: falha ao enviar (status=${e.statusCode}, msg=${e.message})`);
    if (e.statusCode === 404 || e.statusCode === 410) {
      await env.SUBS.delete(name); // inscricao expirada: some com o dado
      console.log(`${name}: inscricao expirada, removida`);
    }
  }
}
