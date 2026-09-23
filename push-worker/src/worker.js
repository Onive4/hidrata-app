import webpush from "web-push";
import { verifyGoogleIdToken } from "./auth.js";

const ALLOWED_ORIGINS = new Set([
  "https://onive4.github.io",
  "http://localhost:8080",
]);

const GOOGLE_CLIENT_ID = "757207136611-ov9q5vcsj35cbrpii3uj4ckcdghhju6b.apps.googleusercontent.com";
const SESSION_TTL_SECONDS = 60 * 24 * 3600;
const MAX_AUTH_BODY_BYTES = 8192;
const MAX_SYNC_BODY_BYTES = 262144;

const VAPID_PUBLIC_KEY =
  "BGaHpocQhW4uet-gc5UtHdy_VW1n6w50y8_F0IesufoxraQph2kpGkzo82suXas4Mj9cPh9p7DOXIqu38iFW77o";
const VAPID_SUBJECT = "https://onive4.github.io/hidrata-app/";

// Registros de push de aparelhos que nao voltam ao app somem sozinhos (retencao minima de dados).
const PUSH_RECORD_TTL_MS = 90 * 24 * 3600 * 1000;
// So enviamos push para os servicos oficiais dos navegadores; qualquer outro destino e recusado.
const PUSH_HOST_SUFFIXES = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

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
  if (!isAllowedPushEndpoint(subscription.endpoint)) throw new Error("endpoint de push nao permitido");
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

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function isAllowedPushEndpoint(endpoint) {
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
}

function corsHeaders(origin) {
  // origem nao permitida: nenhum cabecalho CORS (o navegador bloqueia a leitura da resposta)
  const headers = { ...SECURITY_HEADERS, Vary: "Origin" };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  }
  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

// grava o registro de push com validade absoluta (renovada a cada sincronizacao do aparelho)
async function putSub(env, key, rec) {
  if (!rec.expiresAt) rec.expiresAt = Date.now() + PUSH_RECORD_TTL_MS;
  const exp = Math.floor(rec.expiresAt / 1000);
  const opts = exp - Math.floor(Date.now() / 1000) > 120 ? { expiration: exp } : undefined;
  await env.SUBS.put(key, JSON.stringify(rec), opts);
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
  if (!body.subscription || typeof body.subscription.endpoint !== "string" || body.subscription.endpoint.length > 1024 || !isAllowedPushEndpoint(body.subscription.endpoint))
    return "endpoint de push nao permitido";
  const keys = body.subscription.keys || {};
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || keys.p256dh.length > 200 || keys.auth.length > 100) return "subscription.keys invalido";
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
  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, origin);
  const body = parsed.body;
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
    expiresAt: Date.now() + PUSH_RECORD_TTL_MS,
    updatedAt: Date.now(),
  };
  await putSub(env, key, record);
  return json({ ok: true }, 200, origin);
}

async function handleTest(request, env, origin) {
  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, origin);
  const body = parsed.body;
  if (!body || typeof body !== "object" || !ID_RE.test(body.deviceId || "") || typeof body.deviceSecret !== "string") {
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
  await putSub(env, key, rec);
  return json({ ok: true }, 200, origin);
}

async function handleUnsubscribe(request, env, origin) {
  const parsed = await readJsonBody(request, MAX_BODY_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, origin);
  const body = parsed.body;
  if (!body || typeof body !== "object" || !ID_RE.test(body.deviceId || "") || typeof body.deviceSecret !== "string") {
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

function toB64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function readJsonBody(request, maxBytes) {
  // recusa antes de ler quando o tamanho declarado ja passa do limite
  if (Number(request.headers.get("Content-Length")) > maxBytes) return { error: "payload grande demais", status: 413 };
  const raw = await request.text();
  if (raw.length > maxBytes) return { error: "payload grande demais", status: 413 };
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { error: "json invalido", status: 400 };
  }
}

// Sessao opaca: o servidor guarda so o hash do token, com validade.
async function authenticate(request, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,64})$/.exec(request.headers.get("Authorization") || "");
  if (!m) return null;
  const raw = await env.SUBS.get("sess:" + (await sha256Hex(m[1])));
  if (!raw) return null;
  try {
    return JSON.parse(raw).u || null;
  } catch {
    return null;
  }
}

async function handleAuthGoogle(request, env, origin) {
  const parsed = await readJsonBody(request, MAX_AUTH_BODY_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, origin);

  let payload;
  try {
    payload = await verifyGoogleIdToken(parsed.body && parsed.body.idToken, { clientId: GOOGLE_CLIENT_ID });
  } catch (e) {
    console.log(`auth recusada: ${e.message}`);
    return json({ error: "login do Google nao validado" }, 401, origin);
  }

  // a chave do usuario e um hash do ID do Google: nem o e-mail nem o ID bruto ficam gravados
  const userKey = "user:" + (await sha256Hex("google:" + payload.sub));
  const token = toB64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.SUBS.put("sess:" + (await sha256Hex(token)), JSON.stringify({ u: userKey, c: Date.now() }), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return json({ token, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 }, 200, origin);
}

async function handleSyncGet(request, env, origin) {
  const userKey = await authenticate(request, env);
  if (!userKey) return json({ error: "sessao invalida" }, 401, origin);
  const raw = await env.SUBS.get(userKey);
  if (!raw) return json({ version: 0, blob: null }, 200, origin);
  const rec = JSON.parse(raw);
  return json({ version: rec.version, updatedAt: rec.updatedAt, blob: rec.blob }, 200, origin);
}

async function handleSyncPut(request, env, origin) {
  const userKey = await authenticate(request, env);
  if (!userKey) return json({ error: "sessao invalida" }, 401, origin);
  const parsed = await readJsonBody(request, MAX_SYNC_BODY_BYTES);
  if (parsed.error) return json({ error: parsed.error }, parsed.status, origin);
  const { baseVersion, blob } = parsed.body || {};
  if (!Number.isInteger(baseVersion) || baseVersion < 0) return json({ error: "baseVersion invalido" }, 400, origin);
  if (!blob || typeof blob !== "object" || Array.isArray(blob) || blob.v !== 1) return json({ error: "blob invalido" }, 400, origin);
  if (!blob.settings || typeof blob.settings !== "object" || !blob.data || typeof blob.data !== "object") {
    return json({ error: "blob invalido" }, 400, origin);
  }

  const curRaw = await env.SUBS.get(userKey);
  const currentVersion = curRaw ? JSON.parse(curRaw).version : 0;
  if (baseVersion !== currentVersion) return json({ error: "conflito de versao", version: currentVersion }, 409, origin);

  const rec = { version: currentVersion + 1, updatedAt: Date.now(), blob };
  await env.SUBS.put(userKey, JSON.stringify(rec));
  return json({ version: rec.version, updatedAt: rec.updatedAt }, 200, origin);
}

async function handleSyncDelete(request, env, origin) {
  const userKey = await authenticate(request, env);
  if (!userKey) return json({ error: "sessao invalida" }, 401, origin);
  await env.SUBS.delete(userKey);
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
    if (url.pathname === "/auth/google" && request.method === "POST") {
      return handleAuthGoogle(request, env, origin);
    }
    if (url.pathname === "/sync" && request.method === "GET") {
      return handleSyncGet(request, env, origin);
    }
    if (url.pathname === "/sync" && request.method === "PUT") {
      return handleSyncPut(request, env, origin);
    }
    if (url.pathname === "/sync" && request.method === "DELETE") {
      return handleSyncDelete(request, env, origin);
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
  if (!isAllowedPushEndpoint(rec.endpoint)) {
    await env.SUBS.delete(name); // destino fora dos servicos oficiais de push: nunca enviamos
    console.log(`${name}: endpoint nao permitido, registro removido`);
    return;
  }
  const { dateKey, minutes } = localNow(rec.tzOffsetMinutes);
  const times = computeReminderTimes(rec.wake, rec.sleep, rec.interval);

  if (rec.lastSlotDate !== dateKey) {
    // primeira checagem do dia para este dispositivo: so marca os horarios
    // ja passados como vistos, sem disparar rajada de notificacoes atrasadas.
    const past = times.filter((t) => hmToMinutes(t) <= minutes);
    rec.lastSlotDate = dateKey;
    rec.lastSlot = past.length ? past[past.length - 1] : null;
    await putSub(env, name, rec);
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
    await putSub(env, name, rec);
    console.log(`${name}: notificacao enviada (${due ? "horario " + due : "rede de seguranca de " + safetyHours + "h"})`);
  } catch (e) {
    console.error(`${name}: falha ao enviar (status=${e.statusCode}, msg=${e.message})`);
    if (e.statusCode === 404 || e.statusCode === 410) {
      await env.SUBS.delete(name); // inscricao expirada: some com o dado
      console.log(`${name}: inscricao expirada, removida`);
    }
  }
}
