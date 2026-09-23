/* Grupos do Hidrata: grupo por convite, Jarra semanal, cutucar, aplaudir e presentes.
   Modelo de dados no KV (sem transações, então cada pessoa escreve só no próprio registro):
     grp:<gid>          o grupo (nome, meta em %, Jarra, lista de membros). Escrito por quem cria, entra, sai e pelo fechamento da semana.
     gm:<gid>:<uh>      o que UM membro compartilha (apelido, dias, emblemas...). Escrito só por ele.
     ug:<uh>            em quais grupos o usuário está (até 3): { gids: [...] }. Formato antigo { gid } ainda é lido.
     inv:<CODIGO>       código de convite -> grupo.
     ud:<uh> / dv:<id>  aparelhos de push do usuário (para cutucar/aplaudir/presentear).
     gx:<uh>            caixa de entrada: presentes e reações esperando serem vistos.
     rl:...             limites de uso (expiram sozinhos).
   <uh> é o hash do ID do Google (a mesma chave do resto do app): nunca e-mail, nome real ou o ID bruto. */

const MAX_MEMBERS = 15;
const MAX_GROUPS_PER_USER = 3;
const MAX_BODY_BYTES = 8192;
const MEMBER_TTL_SECONDS = 60 * 24 * 3600;
const DEVICE_LINK_TTL_SECONDS = 90 * 24 * 3600;
const MAX_DEVICES_PER_USER = 5;
const SNAPSHOT_REFRESH_MS = 6 * 3600 * 1000;
const DEFAULT_PCT = 80;
const MIN_PCT = 50;
const MAX_PCT = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;
const PHOTO_RE = /^https:\/\/lh[3-6]\.googleusercontent\.com\/[A-Za-z0-9_\-\/=.]{1,300}$/;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LEN = 6;
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
const GID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const MID_RE = /^[0-9a-f]{20}$/;
const GIFT_ID_RE = /^[A-Za-z0-9_-]{16,24}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

// Mesma lista do app (app.js). Serve de lista permitida e para escrever o nome nas notificações.
const EMBLEM_LABELS = {
  gota: "Gota", nuvem: "Nuvem", copo: "Copo", folha: "Folha", bolha: "Bolha", chuva: "Chuva", poca: "Poça",
  torneira: "Torneira", guardachuva: "Guarda-chuva", redemoinho: "Redemoinho", sabonete: "Sabonete", balde: "Balde",
  onda: "Onda", concha: "Concha", peixinho: "Peixinho", arcoiris: "Arco-íris", cacto: "Cacto Hidratado", lua: "Lua",
  praia: "Praia", barco: "Barco a Vela", sol: "Sol", pinguim: "Pinguim", foca: "Foca", caranguejo: "Caranguejo",
  cachoeira: "Cachoeira", golfinho: "Golfinho", tartaruga: "Tartaruga Marinha", estrelamar: "Estrela do Mar",
  iceberg: "Iceberg", polvo: "Polvo", baleiajubarte: "Baleia Jubarte", geleira: "Geleira", tempestade: "Tempestade",
  coral: "Coral", sereia: "Sereia", tridente: "Tridente de Poseidon", baleia: "Baleia Mística", dragao: "Dragão das Águas",
  reidosmares: "Rei dos Mares", kraken: "Kraken", cisne: "Cisne Encantado", presagio: "Presságio das Marés",
};

// Reações: cada uma tem uma regra do que precisa ser verdade para poder mandar (null = ainda não dá).
const REACTIONS = {
  clap: (n, s) => (s.streak >= 3 ? `👏 ${n} aplaudiu seus ${s.streak} dias seguidos!` : s.counted >= 3 ? `👏 ${n} aplaudiu sua semana: ${s.counted} dias contados!` : null),
  fire: (n, s) => (s.streak >= 3 ? `🔥 ${n} mandou fogo pra sua sequência de ${s.streak} dias!` : null),
  muscle: (n) => `💪 ${n} mandou força pra você!`,
  party: (n, s) => (s.counted >= 1 ? `🎉 ${n} comemorou com você!` : null),
};
const INBOX_KINDS = ["poke", "gift", ...Object.keys(REACTIONS)];

const POKE_MESSAGES = [
  (n) => `💧 ${n} te mandou um copo d'água. Bora beber?`,
  (n) => `🥤 ${n} lembrou de você: já bebeu água hoje?`,
  (n) => `🚰 ${n} está torcendo por você. Um golinho agora?`,
];

// ---------- utilidades de data (semana de segunda a domingo, no fuso do grupo) ----------
const pad2 = (n) => String(n).padStart(2, "0");
function dateToUtc(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function utcToKey(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function shiftKey(key, days) {
  return utcToKey(dateToUtc(key) + days * 86400000);
}
function isRealDate(key) {
  return DATE_RE.test(key) && utcToKey(dateToUtc(key)) === key;
}
function isMonday(key) {
  return new Date(dateToUtc(key)).getUTCDay() === 1;
}
function localKey(ms, tz) {
  return utcToKey(ms + tz * 60000);
}
function weekStartOfKey(key) {
  const dow = (new Date(dateToUtc(key)).getUTCDay() + 6) % 7;
  return shiftKey(key, -dow);
}
function currentWeekOf(grp, now) {
  return weekStartOfKey(localKey(now, grp.tz));
}
// instante em que a semana seguinte começa (meia-noite local de segunda)
function weekEndMs(weekStart, tz) {
  return dateToUtc(shiftKey(weekStart, 7)) - tz * 60000;
}

// ---------- KV ----------
async function getJson(env, key) {
  const raw = await env.SUBS.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function putJson(env, key, value, ttlSeconds) {
  await env.SUBS.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
}
async function listAll(env, prefix) {
  const names = [];
  let cursor;
  do {
    const r = await env.SUBS.list({ prefix, cursor });
    for (const k of r.keys) names.push(k.name);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  return names;
}
async function deleteAll(env, prefix) {
  for (const name of await listAll(env, prefix)) await env.SUBS.delete(name);
}

function randomToken(bytes) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomCode() {
  const buf = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = "";
  for (const b of buf) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}
function normalizeCode(input) {
  const s = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.startsWith("AGUA") && s.length === 4 + CODE_LEN ? s.slice(4) : s;
}

// ---------- validação ----------
function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const s = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= max && TEXT_RE.test(s) ? s : null;
}
function clampInt(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function cleanDays(v) {
  if (!Array.isArray(v) || v.length !== 7) return null;
  return v.map((x) => (Number(x) === 1 ? 1 : 0));
}

// O que o membro compartilha. Tudo passa por aqui: só formatos esperados são gravados.
function parseMe(me, now) {
  if (!me || typeof me !== "object") return { error: "dados invalidos" };
  const nick = cleanText(me.nick, 20);
  if (!nick) return { error: "apelido invalido (use letras, numeros e espacos, ate 20)" };
  const tz = clampInt(Math.round(Number(me.tz)), -720, 840);
  if (tz === null) return { error: "fuso invalido" };
  const rec = { nick, tz, visible: me.visible !== false, pushOk: me.pushOk !== false, photo: null };
  if (!rec.visible) return { rec };

  if (me.photo != null) {
    if (typeof me.photo !== "string" || !PHOTO_RE.test(me.photo)) return { error: "foto invalida" };
    rec.photo = me.photo;
  }
  const level = clampInt(me.level, 1, 50);
  const streak = clampInt(me.streak, 0, 5000);
  if (level === null || streak === null) return { error: "nivel ou sequencia invalidos" };
  const today = localKey(now, tz);
  if (typeof me.weekStart !== "string" || !isRealDate(me.weekStart) || !isMonday(me.weekStart)) return { error: "semana invalida" };
  if (Math.abs(dateToUtc(me.weekStart) - dateToUtc(weekStartOfKey(today))) > 8 * 86400000) return { error: "semana fora do intervalo" };
  const days = cleanDays(me.days);
  const prevDays = cleanDays(me.prevDays);
  if (!days || !prevDays) return { error: "dias invalidos" };
  if (typeof me.todayKey !== "string" || !isRealDate(me.todayKey) || Math.abs(dateToUtc(me.todayKey) - dateToUtc(today)) > 2 * 86400000) return { error: "dia invalido" };
  if (!Array.isArray(me.emblems) || me.emblems.length > 60) return { error: "emblemas invalidos" };
  const emblems = [...new Set(me.emblems.filter((e) => typeof e === "string" && EMBLEM_LABELS[e]))].sort();
  const dups = {};
  if (me.dups && typeof me.dups === "object" && !Array.isArray(me.dups)) {
    for (const k of Object.keys(me.dups)) {
      const n = clampInt(me.dups[k], 1, 99);
      if (EMBLEM_LABELS[k] && n !== null && emblems.includes(k)) dups[k] = n;
    }
  }
  Object.assign(rec, {
    level, streak, weekStart: me.weekStart, days, prevWeekStart: shiftKey(me.weekStart, -7), prevDays,
    todayKey: me.todayKey, todayCounted: me.todayCounted === true, emblems, dups,
  });
  return { rec };
}

function sameShared(a, b) {
  const strip = (r) => JSON.stringify({ ...r, updatedAt: 0, joinedAt: 0, mid: 0 });
  return strip(a) === strip(b);
}

// ---------- Jarra ----------
function levelForStreak(n) {
  return n >= 12 ? "ouro" : n >= 4 ? "prata" : n >= 1 ? "bronze" : null;
}
function pctForWeek(grp, week) {
  return grp.pending && grp.pending.from <= week ? grp.pending.value : grp.pct;
}
function goalFor(cap, pct) {
  return Math.max(1, Math.round((cap * pct) / 100));
}
function countedDays(rec, week) {
  if (rec.weekStart === week) return rec.days;
  if (rec.prevWeekStart === week) return rec.prevDays;
  return [0, 0, 0, 0, 0, 0, 0];
}
function jarNumbers(grp, members, week) {
  const active = members.filter((m) => m.rec.visible);
  const cap = active.length * 7;
  const pct = pctForWeek(grp, week);
  const goal = goalFor(cap, pct);
  const drops = active.reduce((s, m) => s + countedDays(m.rec, week).reduce((a, b) => a + b, 0), 0);
  return { active: active.length, cap, pct, goal, drops, full: active.length >= 2 && drops >= goal };
}

// Fecha a semana passada uma única vez, quando alguém abre o grupo (sem depender de cron).
async function closePastWeek(env, grp, members, now) {
  const week = currentWeekOf(grp, now);
  const past = shiftKey(week, -7);
  if (grp.closedWeek && grp.closedWeek >= past) return grp;
  if (grp.createdAt >= weekEndMs(past, grp.tz)) return grp; // o grupo nasceu depois dessa semana
  const eligible = members.filter((m) => (m.rec.joinedAt || 0) < weekEndMs(past, grp.tz));
  const j = jarNumbers(grp, eligible, past);
  const continuous = grp.closedWeek === shiftKey(past, -7);
  grp.jarStreak = j.full ? (continuous ? grp.jarStreak || 0 : 0) + 1 : 0;
  grp.jarBest = Math.max(grp.jarBest || 0, grp.jarStreak);
  grp.jarWeeks = (grp.jarWeeks || 0) + (j.full ? 1 : 0);
  grp.closedWeek = past;
  grp.lastResult = { week: past, drops: j.drops, goal: j.goal, cap: j.cap, pct: j.pct, members: j.active, full: j.full, streak: grp.jarStreak };
  if (grp.pending && grp.pending.from <= past) {
    grp.pct = grp.pending.value;
    grp.pending = null;
  }
  await putJson(env, `grp:${grp.id}`, grp);
  return grp;
}

// ---------- vínculos e limpeza ----------
async function memberId(gid, uh, deps) {
  return (await deps.sha256Hex(`${gid}:${uh}`)).slice(0, 20);
}

// A lista de membros fica dentro do grupo (`grp.members`): assim ler o grupo não gasta "listagens"
// do KV (o plano grátis só tem 1.000 por dia). Entrar e sair mexem nela; quem some por engano se cura sozinho.
async function membersOf(env, grp) {
  if (Array.isArray(grp.members)) return grp.members;
  // grupo criado antes dessa lista: uma única listagem para migrar
  const prefix = `gm:${grp.id}:`;
  grp.members = (await listAll(env, prefix)).map((n) => n.slice(prefix.length));
  await putJson(env, `grp:${grp.id}`, grp);
  return grp.members;
}

// Em quais grupos a pessoa está. Lê o formato antigo ({ gid }) e o novo ({ gids }).
async function userGroups(env, uh) {
  const ug = await getJson(env, `ug:${uh}`);
  if (!ug) return [];
  const list = Array.isArray(ug.gids) ? ug.gids : GID_RE.test(ug.gid || "") ? [ug.gid] : [];
  return [...new Set(list.filter((g) => typeof g === "string" && GID_RE.test(g)))].slice(0, MAX_GROUPS_PER_USER);
}
async function saveUserGroups(env, uh, gids) {
  if (gids.length) await putJson(env, `ug:${uh}`, { gids });
  else await env.SUBS.delete(`ug:${uh}`);
}
async function groupSummaries(env, gids, known) {
  return (await Promise.all(gids.map(async (id) => {
    const g = known && known.id === id ? known : await getJson(env, `grp:${id}`);
    return g ? { id, name: g.name } : null;
  }))).filter(Boolean);
}

// O grupo pedido (ou o primeiro, se nenhum foi pedido). Devolve também todos os ids da pessoa.
async function getMyGroup(env, uh, wanted) {
  const gids = await userGroups(env, uh);
  if (!gids.length) return null;
  const gid = wanted ? (gids.includes(wanted) ? wanted : null) : gids[0];
  if (!gid) return null;
  const [grp, me] = await Promise.all([getJson(env, `grp:${gid}`), getJson(env, `gm:${gid}:${uh}`)]);
  if (!grp || !me) {
    await saveUserGroups(env, uh, gids.filter((g) => g !== gid)); // vínculo velho (grupo apagado ou registro expirado)
    return wanted ? null : getMyGroup(env, uh);
  }
  const list = await membersOf(env, grp);
  if (!list.includes(uh)) {
    // duas entradas ao mesmo tempo podem sobrescrever uma à outra: quem sumiu da lista volta a ela
    grp.members = [...list, uh];
    await putJson(env, `grp:${grp.id}`, grp);
  }
  return { grp, me, gids };
}
async function loadMembers(env, grp, myUh, myRec) {
  const uhs = await membersOf(env, grp);
  const out = await Promise.all(uhs.map(async (uh) => ({ uh, rec: uh === myUh && myRec ? myRec : await getJson(env, `gm:${grp.id}:${uh}`) })));
  const list = out.filter((x) => x.rec);
  if (myRec && !list.some((x) => x.uh === myUh)) list.push({ uh: myUh, rec: myRec });
  return list;
}

// ---------- caixa de entrada: presentes e reações (uma chave por pessoa) ----------
const INBOX_MAX = 30;
const INBOX_TTL_SECONDS = 3 * 24 * 3600;
const INBOX_KEEP_MS = 48 * 3600 * 1000;
async function readInbox(env, uh) {
  const box = await getJson(env, `gx:${uh}`);
  return box && Array.isArray(box.items) ? box.items : [];
}
async function addToInbox(env, uh, item) {
  const now = Date.now();
  const items = (await readInbox(env, uh)).filter((x) => now - (x.at || 0) < INBOX_KEEP_MS).slice(-(INBOX_MAX - 1));
  items.push(item);
  await putJson(env, `gx:${uh}`, { items }, INBOX_TTL_SECONDS);
}
async function removeFromInbox(env, uh, ids) {
  const items = await readInbox(env, uh);
  const keep = items.filter((x) => !ids.includes(x.id));
  if (keep.length === items.length) return;
  if (keep.length) await putJson(env, `gx:${uh}`, { items: keep }, INBOX_TTL_SECONDS);
  else await env.SUBS.delete(`gx:${uh}`);
}

// Sai de UM grupo (ou de todos, se nenhum for indicado) apagando o que a pessoa compartilhava.
// Quando não sobra nenhum grupo, apaga também o vínculo de push e a caixa de entrada.
async function removeUserFromGroup(env, uh, only) {
  const gids = await userGroups(env, uh);
  const leaving = only ? gids.filter((g) => g === only) : gids;
  for (const gid of leaving) {
    await env.SUBS.delete(`gm:${gid}:${uh}`);
    const grp = await getJson(env, `grp:${gid}`);
    if (!grp) continue;
    grp.members = (await membersOf(env, grp)).filter((x) => x !== uh);
    const rest = await loadMembers(env, grp);
    if (!rest.length) {
      await env.SUBS.delete(`grp:${gid}`);
      await env.SUBS.delete(`inv:${grp.code}`);
      continue;
    }
    if (grp.creator === uh) {
      rest.sort((a, b) => (a.rec.joinedAt || 0) - (b.rec.joinedAt || 0));
      grp.creator = rest[0].uh;
    }
    await putJson(env, `grp:${gid}`, grp);
  }
  const remaining = gids.filter((g) => !leaving.includes(g));
  await saveUserGroups(env, uh, remaining);
  if (!remaining.length) {
    const ud = await getJson(env, `ud:${uh}`);
    if (ud && Array.isArray(ud.ids)) for (const id of ud.ids) if (DEVICE_ID_RE.test(id)) await env.SUBS.delete(`dv:${id}`);
    await env.SUBS.delete(`ud:${uh}`);
    await env.SUBS.delete(`gx:${uh}`);
  }
}

// Quem está em mais de um grupo recebe o nome do grupo nos avisos (para saber de qual veio).
async function groupSuffix(env, uh, grp) {
  return (await userGroups(env, uh)).length > 1 ? ` · ${grp.name}` : "";
}
// ---------- push para os aparelhos de um usuário ----------
async function pushToUser(env, deps, uh, body) {
  if (!env.VAPID_PRIVATE_KEY) return 0;
  const ud = await getJson(env, `ud:${uh}`);
  const ids = ud && Array.isArray(ud.ids) ? ud.ids : [];
  let delivered = 0;
  deps.ensureVapid(env);
  for (const id of ids) {
    if (!DEVICE_ID_RE.test(id)) continue;
    const sub = await getJson(env, `sub:${id}`);
    if (!sub) continue;
    try {
      await deps.sendPush({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify({ title: "Hidrata", body }));
      delivered++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await env.SUBS.delete(`sub:${id}`);
    }
  }
  return delivered;
}

// ---------- respostas ----------
function publicMember(m, myUh, creatorUh) {
  const base = { mid: m.rec.mid, nick: m.rec.nick, visible: m.rec.visible, isMe: m.uh === myUh, isCreator: m.uh === creatorUh };
  if (!m.rec.visible) return base;
  return {
    ...base, photo: m.rec.photo, level: m.rec.level, streak: m.rec.streak, weekStart: m.rec.weekStart, days: m.rec.days,
    prevWeekStart: m.rec.prevWeekStart, prevDays: m.rec.prevDays, emblems: m.rec.emblems, ...(m.uh === myUh ? { dups: m.rec.dups } : {}),
  };
}

async function buildState(env, deps, uh, mine, now) {
  let grp = mine.grp;
  const gids = mine.gids || (await userGroups(env, uh));
  let members = await loadMembers(env, grp, uh, mine.me);
  grp = await closePastWeek(env, grp, members, now);
  const week = currentWeekOf(grp, now);
  const j = jarNumbers(grp, members, week);
  const inbox = (await readInbox(env, uh))
    .filter((x) => x && GIFT_ID_RE.test(x.id || "") && INBOX_KINDS.includes(x.k) && (x.k !== "gift" || EMBLEM_LABELS[x.e]))
    .map((x) => ({ id: x.id, k: x.k, from: x.from, e: x.e, at: x.at, gn: typeof x.gn === "string" ? x.gn : undefined }));
  members.sort((a, b) => (a.rec.joinedAt || 0) - (b.rec.joinedAt || 0));
  return {
    group: {
      id: grp.id, name: grp.name, code: grp.code, isCreator: grp.creator === uh, maxMembers: MAX_MEMBERS,
      pct: j.pct, defaultPct: DEFAULT_PCT, pending: grp.pending && grp.pending.from > week ? grp.pending : null, currentWeek: week,
      cap: j.cap, goal: j.goal, activeMembers: j.active,
      jarStreak: grp.jarStreak || 0, jarBest: grp.jarBest || 0, jarWeeks: grp.jarWeeks || 0, jarLevel: levelForStreak(grp.jarStreak || 0),
      lastResult: grp.lastResult || null,
    },
    groups: await groupSummaries(env, gids, grp),
    members: members.map((m) => publicMember(m, uh, grp.creator)),
    inbox,
    serverNow: now,
  };
}

// ---------- rotas ----------
export async function handleGroup(request, env, origin, url, deps) {
  const path = url.pathname;
  if (path !== "/group" && !path.startsWith("/group/")) return null;
  const { json, readJsonBody, authenticate } = deps;

  const userKey = await authenticate(request, env);
  if (!userKey) return json({ error: "sessao invalida" }, 401, origin);
  const uh = userKey.startsWith("user:") ? userKey.slice(5) : userKey;
  const now = Date.now();
  const method = request.method;
  const wantedG = url.searchParams.get("g") || "";

  async function body() {
    const parsed = await readJsonBody(request, MAX_BODY_BYTES);
    return parsed.error ? { res: json({ error: parsed.error }, parsed.status, origin) } : { b: parsed.body && typeof parsed.body === "object" ? parsed.body : {} };
  }
  const bad = (msg, status = 400) => json({ error: msg }, status, origin);

  if (wantedG && !GID_RE.test(wantedG)) return bad("grupo invalido");

  // --- estado do meu grupo (o pedido em ?g=, ou o primeiro) ---
  if (path === "/group" && method === "GET") {
    const mine = await getMyGroup(env, uh, wantedG);
    if (!mine) return json({ group: null, groups: await groupSummaries(env, await userGroups(env, uh)) }, 200, origin);
    return json(await buildState(env, deps, uh, mine, now), 200, origin);
  }

  // --- criar grupo ---
  if (path === "/group" && method === "POST") {
    const { b, res } = await body();
    if (res) return res;
    const myGids = await userGroups(env, uh);
    if (myGids.length >= MAX_GROUPS_PER_USER) return bad("limite de grupos por pessoa atingido", 409);
    const name = cleanText(b.name, 30);
    if (!name) return bad("nome do grupo invalido (use letras, numeros e espacos, ate 30)");
    const me = parseMe(b.me, now);
    if (me.error) return bad(me.error);

    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const c = randomCode();
      if (!(await env.SUBS.get(`inv:${c}`))) code = c;
    }
    if (!code) return bad("nao foi possivel gerar o convite agora", 503);
    const gid = randomToken(12);
    const grp = {
      id: gid, name, code, creator: uh, tz: me.rec.tz, pct: DEFAULT_PCT, pending: null, createdAt: now,
      jarStreak: 0, jarBest: 0, jarWeeks: 0, closedWeek: null, lastResult: null, summaryWeek: null, members: [uh],
    };
    const rec = { ...me.rec, mid: await memberId(gid, uh, deps), joinedAt: now, updatedAt: now };
    await putJson(env, `grp:${gid}`, grp);
    await putJson(env, `gm:${gid}:${uh}`, rec, MEMBER_TTL_SECONDS);
    await env.SUBS.put(`inv:${code}`, gid);
    await saveUserGroups(env, uh, [...myGids, gid]);
    return json(await buildState(env, deps, uh, { grp, me: rec, gids: [...myGids, gid] }, now), 200, origin);
  }

  // --- entrar por convite ---
  if (path === "/group/join" && method === "POST") {
    const { b, res } = await body();
    if (res) return res;
    const myGids = await userGroups(env, uh);
    if (myGids.length >= MAX_GROUPS_PER_USER) return bad("limite de grupos por pessoa atingido", 409);
    const failKey = `rl:jf:${uh}`;
    const fails = Number((await env.SUBS.get(failKey)) || 0);
    if (fails >= 10) return bad("muitas tentativas; tente de novo daqui a pouco", 429);
    const code = normalizeCode(b.code);
    const gid = CODE_RE.test(code) ? await env.SUBS.get(`inv:${code}`) : null;
    const grp = gid ? await getJson(env, `grp:${gid}`) : null;
    if (!grp) {
      await env.SUBS.put(failKey, String(fails + 1), { expirationTtl: 3600 });
      return bad("codigo de convite nao encontrado", 404);
    }
    if (myGids.includes(gid)) return bad("voce ja esta nesse grupo", 409);
    const me = parseMe(b.me, now);
    if (me.error) return bad(me.error);
    const members = await loadMembers(env, grp);
    if (members.length >= MAX_MEMBERS) return bad("este grupo esta cheio", 409);
    const rec = { ...me.rec, mid: await memberId(gid, uh, deps), joinedAt: now, updatedAt: now };
    await putJson(env, `gm:${gid}:${uh}`, rec, MEMBER_TTL_SECONDS);
    await saveUserGroups(env, uh, [...myGids, gid]);
    const fresh = (await getJson(env, `grp:${gid}`)) || grp;
    if (!(await membersOf(env, fresh)).includes(uh)) {
      fresh.members = [...fresh.members, uh];
      await putJson(env, `grp:${gid}`, fresh);
    }
    grp.members = fresh.members;
    return json(await buildState(env, deps, uh, { grp, me: rec, gids: [...myGids, gid] }, now), 200, origin);
  }

  // --- vínculo de aparelho para push (não exige estar em grupo) ---
  if (path === "/group/devices" && method === "POST") {
    const { b, res } = await body();
    if (res) return res;
    if (!DEVICE_ID_RE.test(b.deviceId || "") || typeof b.deviceSecret !== "string") return bad("corpo invalido");
    const sub = await getJson(env, `sub:${b.deviceId}`);
    if (!sub) return bad("aparelho nao registrado para notificacoes", 404);
    if (!deps.timingSafeEqual(sub.secretHash, await deps.sha256Hex(b.deviceSecret))) return bad("nao autorizado", 403);
    const previousOwner = await env.SUBS.get(`dv:${b.deviceId}`);
    if (previousOwner && previousOwner !== uh) {
      const other = await getJson(env, `ud:${previousOwner}`);
      if (other && Array.isArray(other.ids)) await putJson(env, `ud:${previousOwner}`, { ids: other.ids.filter((x) => x !== b.deviceId) }, DEVICE_LINK_TTL_SECONDS);
    }
    const ud = await getJson(env, `ud:${uh}`);
    const ids = [...(ud && Array.isArray(ud.ids) ? ud.ids.filter((x) => x !== b.deviceId) : []), b.deviceId].slice(-MAX_DEVICES_PER_USER);
    await putJson(env, `ud:${uh}`, { ids }, DEVICE_LINK_TTL_SECONDS);
    await env.SUBS.put(`dv:${b.deviceId}`, uh, { expirationTtl: DEVICE_LINK_TTL_SECONDS });
    return json({ ok: true }, 200, origin);
  }

  // --- receber presentes e reações (marca como vistos; vale para a pessoa, não para um grupo) ---
  if (path === "/group/inbox/ack" && method === "POST") {
    const { b, res } = await body();
    if (res) return res;
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === "string" && GIFT_ID_RE.test(x)).slice(0, 20) : [];
    if (ids.length) await removeFromInbox(env, uh, ids);
    return json({ ok: true }, 200, origin);
  }

  // daqui para baixo, só quem está no grupo indicado em ?g=
  const mine = await getMyGroup(env, uh, wantedG);
  if (!mine) return bad("voce nao esta nesse grupo", 404);
  // quem está em mais de um grupo precisa dizer qual (evita cutucar ou remover no grupo errado)
  if (!wantedG && mine.gids.length > 1) return bad("informe o grupo (?g=)", 400);
  const { grp } = mine;

  // --- atualizar o que eu compartilho ---
  if (path === "/group/me" && method === "PUT") {
    const { b, res } = await body();
    if (res) return res;
    const me = parseMe(b, now);
    if (me.error) return bad(me.error);
    const prev = mine.me;
    const next = { ...me.rec, mid: prev.mid, joinedAt: prev.joinedAt, updatedAt: now };
    // sem mudança e recente: não gasta escrita (o KV tem limite diário de gravações)
    if (!sameShared(prev, next) || now - (prev.updatedAt || 0) > SNAPSHOT_REFRESH_MS) {
      await putJson(env, `gm:${grp.id}:${uh}`, next, MEMBER_TTL_SECONDS);
    }
    if (grp.creator === uh && grp.tz !== next.tz) {
      grp.tz = next.tz;
      await putJson(env, `grp:${grp.id}`, grp);
    }
    return json({ ok: true }, 200, origin);
  }

  // --- sair ---
  if (path === "/group/leave" && method === "POST") {
    await removeUserFromGroup(env, uh, grp.id);
    return json({ ok: true }, 200, origin);
  }

  // --- ajustes do grupo (só o criador) ---
  if (path === "/group/settings" && method === "PUT") {
    if (grp.creator !== uh) return bad("so quem criou o grupo pode mudar isso", 403);
    const { b, res } = await body();
    if (res) return res;
    if (b.name !== undefined) {
      const name = cleanText(b.name, 30);
      if (!name) return bad("nome do grupo invalido");
      grp.name = name;
    }
    if (b.pct !== undefined) {
      const pct = clampInt(b.pct, MIN_PCT, MAX_PCT);
      if (pct === null) return bad("meta invalida");
      // vale a partir da próxima semana, para ninguém baixar a meta no meio dela
      await closePastWeek(env, grp, await loadMembers(env, grp, uh, mine.me), now);
      const cur = currentWeekOf(grp, now);
      if (grp.pending && grp.pending.from <= cur) {
        grp.pct = grp.pending.value;
        grp.pending = null;
      }
      grp.pending = pct === grp.pct ? null : { value: pct, from: shiftKey(cur, 7) };
    }
    await putJson(env, `grp:${grp.id}`, grp);
    return json(await buildState(env, deps, uh, mine, now), 200, origin);
  }

  // --- novo código de convite (só o criador) ---
  if (path === "/group/invite" && method === "POST") {
    if (grp.creator !== uh) return bad("so quem criou o grupo pode mudar isso", 403);
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const c = randomCode();
      if (!(await env.SUBS.get(`inv:${c}`))) code = c;
    }
    if (!code) return bad("nao foi possivel gerar o convite agora", 503);
    await env.SUBS.delete(`inv:${grp.code}`);
    await env.SUBS.put(`inv:${code}`, grp.id);
    grp.code = code;
    await putJson(env, `grp:${grp.id}`, grp);
    return json(await buildState(env, deps, uh, mine, now), 200, origin);
  }

  // --- remover alguém (só o criador) ---
  if (path === "/group/kick" && method === "POST") {
    if (grp.creator !== uh) return bad("so quem criou o grupo pode remover alguem", 403);
    const { b, res } = await body();
    if (res) return res;
    if (!MID_RE.test(b.mid || "")) return bad("membro invalido");
    const target = (await loadMembers(env, grp, uh, mine.me)).find((m) => m.rec.mid === b.mid);
    if (!target || target.uh === uh) return bad("membro nao encontrado", 404);
    await removeUserFromGroup(env, target.uh, grp.id);
    return json({ ok: true }, 200, origin);
  }

  // --- cutucar / aplaudir / presentear ---
  if ((path === "/group/poke" || path === "/group/cheer" || path === "/group/gift") && method === "POST") {
    const { b, res } = await body();
    if (res) return res;
    if (!MID_RE.test(b.mid || "")) return bad("membro invalido");
    const members = await loadMembers(env, grp, uh, mine.me);
    const target = members.find((m) => m.rec.mid === b.mid);
    if (!target || target.uh === uh) return bad("membro nao encontrado", 404);
    const from = mine.me.nick;
    if (!mine.me.visible || !target.rec.visible) return bad("essa pessoa esta oculta", 409);

    if (path === "/group/poke") {
      const stale = now - (target.rec.updatedAt || 0) > 20 * 3600000;
      if (target.rec.todayCounted && !stale) return bad("essa pessoa ja contou o dia de hoje", 409);
      const pairKey = `rl:poke:${uh}:${target.uh}`;
      if (await env.SUBS.get(pairKey)) return bad("voce ja cutucou essa pessoa hoje", 429);
      await env.SUBS.put(pairKey, "1", { expirationTtl: 20 * 3600 });
      await addToInbox(env, target.uh, { id: randomToken(12), k: "poke", from, at: now, gn: grp.name });
      if (target.rec.pushOk) await pushToUser(env, deps, target.uh, POKE_MESSAGES[Math.floor(Math.random() * POKE_MESSAGES.length)](from) + (await groupSuffix(env, target.uh, grp)));
      return json({ ok: true }, 200, origin);
    }

    if (path === "/group/cheer") {
      const kind = b.kind === undefined ? "clap" : b.kind;
      if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(REACTIONS, kind)) return bad("reacao invalida");
      const counted = countedDays(target.rec, currentWeekOf(grp, now)).reduce((a, c) => a + c, 0);
      const text = REACTIONS[kind](from, { streak: target.rec.streak, counted });
      if (!text) return bad("ainda nao ha motivo para essa reacao", 409);
      // uma reação de cada tipo por pessoa por dia (uma única chave guarda quais já foram)
      const pairKey = `rl:cheer:${uh}:${target.uh}`;
      const used = ((await env.SUBS.get(pairKey)) || "").split(",").filter(Boolean);
      if (used.includes(kind)) return bad("voce ja mandou essa reacao hoje", 429);
      await env.SUBS.put(pairKey, [...used, kind].join(","), { expirationTtl: 20 * 3600 });
      await addToInbox(env, target.uh, { id: randomToken(12), k: kind, from, at: now, gn: grp.name });
      if (target.rec.pushOk) await pushToUser(env, deps, target.uh, text + (await groupSuffix(env, target.uh, grp)));
      return json({ ok: true }, 200, origin);
    }

    // presente: precisa de um repetido que a outra pessoa ainda não tem
    const emblem = typeof b.emblem === "string" ? b.emblem : "";
    if (!EMBLEM_LABELS[emblem]) return bad("emblema invalido");
    if (!(mine.me.dups && mine.me.dups[emblem] >= 1)) return bad("voce nao tem esse emblema repetido", 409);
    if ((target.rec.emblems || []).includes(emblem)) return bad("essa pessoa ja tem esse emblema", 409);
    if ((await readInbox(env, target.uh)).some((x) => x.k === "gift" && x.e === emblem)) return bad("esse presente ja esta a caminho", 409);
    const giftId = randomToken(12);
    await addToInbox(env, target.uh, { id: giftId, k: "gift", e: emblem, from, at: now, gn: grp.name });
    // desconta já do repetido registrado, para não presentear duas vezes antes do próximo envio do app
    const dups = { ...mine.me.dups };
    if (dups[emblem] > 1) dups[emblem]--;
    else delete dups[emblem];
    await putJson(env, `gm:${grp.id}:${uh}`, { ...mine.me, dups, updatedAt: now }, MEMBER_TTL_SECONDS);
    if (target.rec.pushOk) await pushToUser(env, deps, target.uh, `🎁 ${from} te deu o emblema ${EMBLEM_LABELS[emblem]}! Abra o app para receber.` + (await groupSuffix(env, target.uh, grp)));
    return json({ ok: true, giftId }, 200, origin);
  }
  return null;
}

export { removeUserFromGroup };

// ---------- cron: resumo de domingo à noite e limpeza ----------
// Só lê os membros quando precisa (resumo de domingo ou limpeza diária): o resto do tempo é uma leitura por grupo.
export async function processGroups(env, deps, now = Date.now()) {
  const utc = new Date(now);
  const dailyCleanup = utc.getUTCHours() === 6 && utc.getUTCMinutes() < 15;
  for (const name of await listAll(env, "grp:")) {
    try {
      const grp = await getJson(env, name);
      if (!grp) continue;
      const local = new Date(now + grp.tz * 60000);
      const week = currentWeekOf(grp, now);
      const summaryDue = local.getUTCDay() === 0 && local.getUTCHours() >= 19 && grp.summaryWeek !== week;
      if (!summaryDue && !dailyCleanup) continue;

      const members = await loadMembers(env, grp);
      if (!members.length) {
        await env.SUBS.delete(name); // ninguém ativo há mais de 60 dias
        await env.SUBS.delete(`inv:${grp.code}`);
        continue;
      }
      if (members.length !== (grp.members || []).length) {
        grp.members = members.map((m) => m.uh); // tira quem expirou
        await putJson(env, name, grp);
      }
      if (!summaryDue) continue;

      const j = jarNumbers(grp, members, week);
      grp.summaryWeek = week;
      await putJson(env, name, grp);
      if (j.active < 2) continue;
      const left = j.goal - j.drops;
      const possible = members.filter((m) => m.rec.visible && countedDays(m.rec, week)[6] !== 1).length;
      let text;
      if (left <= 0) text = `🎉 A Jarra do grupo ${grp.name} encheu esta semana! Vocês foram demais.`;
      else if (left <= possible) text = `⏳ Faltam ${left} ${left === 1 ? "gota" : "gotas"} para encher a Jarra do grupo ${grp.name}. Ainda dá tempo hoje!`;
      else text = `💧 A Jarra do grupo ${grp.name} não encheu dessa vez (${j.drops} de ${j.goal}). Semana que vem tem mais!`;
      for (const m of members) if (m.rec.visible && m.rec.pushOk) await pushToUser(env, deps, m.uh, text);
    } catch (e) {
      console.error(`${name}: erro ao processar grupo (${e && e.message})`);
    }
  }
}
// exportado para testes
export const _internal = { closePastWeek, jarNumbers, weekStartOfKey, shiftKey, currentWeekOf, parseMe, normalizeCode, cleanText };
