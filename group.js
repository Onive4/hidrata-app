/* Grupos do Hidrata (aba Grupo). Depende de app.js, sync.js, privacy.js e fx.js.
   Compartilha com o grupo só: apelido, dias da semana que chegaram à meta, sequência, nível, emblemas
   e (se a pessoa ligar) o endereço da foto do Google. Nunca litros, peso, horários, e-mail ou nome.
   Tudo o que vem do servidor é tratado como não confiável: só vira texto (textContent), nunca HTML. */

const GROUP_REFRESH_MS = 60000;
const GROUP_SNAPSHOT_DEBOUNCE_MS = 5000;
const GROUP_SNAPSHOT_MAX_AGE_MS = 5 * 3600 * 1000;
const GROUP_DEVICE_LINK_MS = 24 * 3600 * 1000;
const GROUP_PHOTO_RE = /^https:\/\/lh[3-6]\.googleusercontent\.com\/[A-Za-z0-9_\-\/=.]{1,300}$/;
const GROUP_TEXT_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;
const GROUP_GIFT_ID_RE = /^[A-Za-z0-9_-]{16,24}$/;
const GROUP_ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const ownKey = (obj, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(obj, k);
const GROUP_DAY_LETTERS = ["S", "T", "Q", "Q", "S", "S", "D"];
const GROUP_TROPHIES = {
  bronze: { name: "Bronze", color: "#cd7f32", next: "Prata com 4 semanas seguidas" },
  prata: { name: "Prata", color: "#cbd5e1", next: "Ouro com 12 semanas seguidas" },
  ouro: { name: "Ouro", color: "#fbbf24", next: null },
};
const GROUP_JAR = { top: 44, height: 108 };
// Reações: o servidor confere as mesmas regras (precisa ser verdade para poder mandar).
const GROUP_REACTIONS = [
  { k: "clap", e: "👏", label: "Aplaudir", need: "precisa de 3 dias seguidos ou 3 dias contados na semana" },
  { k: "fire", e: "🔥", label: "Fogo", need: "precisa de 3 dias seguidos" },
  { k: "muscle", e: "💪", label: "Força", need: "" },
  { k: "party", e: "🎉", label: "Festa", need: "precisa de 1 dia contado na semana" },
];
const GROUP_INCOMING_TEXT = {
  poke: (n) => `💧 ${n} te cutucou`,
  clap: (n) => `👏 ${n} aplaudiu você`,
  fire: (n) => `🔥 ${n} mandou fogo`,
  muscle: (n) => `💪 ${n} mandou força`,
  party: (n) => `🎉 ${n} comemorou com você`,
};

let groupState = null; // resposta do servidor: { group, members, inbox }
let groupBusy = false;
let groupError = null;
let groupPollTimer = null;
let groupSnapTimer = null;
let groupGoalTimer = null;
let groupLastSnap = {}; // por grupo: { hash, at }
let groupCache = {}; // último estado visto de cada grupo (troca de grupo instantânea)
let groupUi = freshGroupUi();
const GROUP_MAX_PER_USER = 3;

function freshGroupUi() {
  return {
    other: null, filter: "all", sel: "", kickArm: "", leaveArm: false, dirty: false, msg: "", msgOk: false, albumEl: null,
    needFeed: false, feed: [], enter: false, adding: false, prevDays: {}, lastDrops: null, lastFill: null, animSel: "", animGrid: false, sig: "", hold: 0, pendingRender: false,
  };
}

// ---------- utilidades ----------
function gEl(id) {
  return document.getElementById(id);
}
function h(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}
function plural(n, one, many) {
  return n === 1 ? one : many;
}
function groupPrefs() {
  if (!currentProfile.groupPrefs) currentProfile.groupPrefs = {};
  return currentProfile.groupPrefs;
}
// Cada grupo tem as próprias preferências (apelido, foto, aparecer, avisos, novidades...).
function gpFor(gid) {
  const p = groupPrefs();
  if (!p.groups) p.groups = {};
  const id = gid || "_";
  if (!p.groups[id]) p.groups[id] = {};
  return p.groups[id];
}
function activeGid() {
  return groupPrefs().active || "";
}
function gp() {
  return gpFor(activeGid());
}
function knownGids() {
  const g = groupPrefs().gids;
  return Array.isArray(g) ? g : [];
}
function knowsGroups() {
  return knownGids().length > 0 || groupPrefs().inGroup === true;
}
// quem já usava um grupo só: as preferências soltas passam para o grupo
function migrateLegacyPrefs(gid) {
  const p = groupPrefs();
  if (p.groups && p.groups[gid]) return;
  const g = gpFor(gid);
  for (const k of ["nick", "visible", "showPhoto", "pushOk", "seen", "recapSeen", "fullShown"]) if (p[k] !== undefined) g[k] = p[k];
}
function dropGroup(id) {
  const p = groupPrefs();
  p.gids = knownGids().filter((g) => g !== id);
  delete p.inGroup;
  if (p.groups) delete p.groups[id];
  delete groupCache[id];
  delete groupLastSnap[id];
  if (p.active === id || !p.gids.includes(p.active)) {
    p.active = p.gids[0] || "";
    groupState = groupCache[p.active] || null;
  }
  saveProfiles();
}
function keyDiffDays(a, b) {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function mondayOf(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return shiftDay(dateKey, -((new Date(y, m - 1, d).getDay() + 6) % 7));
}
function weekLabel(weekStart) {
  const fmt = (key, withMonth) => {
    const [y, m, d] = key.split("-").map(Number);
    return withMonth ? new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "numeric", month: "long" }) : String(d);
  };
  const end = shiftDay(weekStart, 6);
  const sameMonth = weekStart.slice(5, 7) === end.slice(5, 7);
  return sameMonth ? `${fmt(weekStart, false)} a ${fmt(end, true)}` : `${fmt(weekStart, true)} a ${fmt(end, true)}`;
}
function safeGroupPhoto(url) {
  return typeof url === "string" && GROUP_PHOTO_RE.test(url) ? url : null;
}
function cleanGroupText(value, max) {
  const s = String(value || "").normalize("NFC").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= max && GROUP_TEXT_RE.test(s) ? s : null;
}
function defaultNick() {
  const first = String((currentProfile && currentProfile.name) || "").split(" ")[0];
  return cleanGroupText(first.replace(/[^\p{L}\p{N} ._'’-]/gu, "").slice(0, 20), 20) || "Jogador";
}
function memberHue(mid) {
  return parseInt(String(mid).slice(0, 4), 16) % 360 || 200;
}
function knownEmblem(id) {
  return EMBLEMS.find((e) => e.id === id) || null;
}

function avatarNode(m, cls) {
  const box = h("span", cls);
  const initial = String(m.nick || "?").charAt(0).toUpperCase();
  box.style.background = `hsl(${memberHue(m.mid)} 40% 26%)`;
  const photo = safeGroupPhoto(m.photo);
  if (photo) {
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      img.remove();
      box.textContent = initial;
    });
    img.src = photo;
    box.appendChild(img);
  } else {
    box.textContent = initial;
  }
  return box;
}

// ---------- estado e regras de uso ----------
function groupUsable() {
  return !!currentProfile && currentProfile.authProvider === "google" && syncAvailable() && groupPrefs().consent === true && !!getSession(currentEmail);
}
function inGroup() {
  return !!(groupState && groupState.group);
}
function groupTabActive() {
  const t = gEl("tab-group");
  return !!t && t.classList.contains("active");
}
function setGroupMsg(text, ok) {
  groupUi.msg = text || "";
  groupUi.msgOk = !!ok;
  const el = gEl("g-msg");
  if (el) {
    el.textContent = groupUi.msg;
    el.classList.toggle("ok", groupUi.msgOk);
  }
}

// ---------- rede ----------
// Quase toda rota diz de qual grupo fala (?g=); criar, entrar, aparelhos e caixa de entrada não.
function groupPath(method, path, gid) {
  if (gid === null || path === "/group/devices" || path === "/group/join" || path === "/group/inbox/ack" || (method === "POST" && path === "/group")) return path;
  const g = gid === undefined ? activeGid() : gid;
  return g ? path + "?g=" + encodeURIComponent(g) : path;
}
async function groupApi(method, path, body, gid) {
  const session = getSession(currentEmail);
  if (!session) throw Object.assign(new Error("sem sessao"), { code: "unauthorized" });
  const resp = await fetch(syncBase() + groupPath(method, path, gid), {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (resp.status === 401) {
    clearSession(currentEmail);
    throw Object.assign(new Error("sessao expirada"), { code: "unauthorized" });
  }
  let data = null;
  try {
    data = await resp.json();
  } catch {}
  return { ok: resp.ok, status: resp.status, data };
}

// ---------- o que eu compartilho ----------
function buildGroupMe(gid) {
  const prefs = gid ? gpFor(gid) : {};
  const me = {
    nick: cleanGroupText(prefs.nick, 20) || cleanGroupText(groupPrefs().nick, 20) || defaultNick(),
    tz: -new Date().getTimezoneOffset(),
    visible: prefs.visible !== false,
    pushOk: prefs.pushOk !== false,
  };
  if (!me.visible) return me;
  const p = currentProfile;
  const d = currentData;
  const s = recomputeStreak();
  const goal = calcGoal(p);
  const pct = streakMinPct(p);
  const today = todayStr();
  const weekStart = mondayOf(today);
  const counted = (start) => Array.from({ length: 7 }, (_, i) => {
    const k = shiftDay(start, i);
    return k <= today && dayCountsForStreak(d, k, goal, pct) ? 1 : 0;
  });
  const dups = {};
  for (const id of d.emblems) {
    const extra = emblemCopies(d, id) - 1;
    if (extra > 0) dups[id] = Math.min(99, extra);
  }
  return Object.assign(me, {
    photo: prefs.showPhoto === true ? safeGroupPhoto(p.picture) : null,
    level: levelInfo(d.xp || 0).num,
    streak: Math.min(5000, s.current),
    weekStart,
    days: counted(weekStart),
    prevDays: counted(shiftDay(weekStart, -7)),
    todayKey: today,
    todayCounted: s.todayCounted,
    emblems: d.emblems.filter((id) => knownEmblem(id)),
    dups,
  });
}

async function pushGroupSnapshot(force, gid) {
  const id = gid === undefined ? activeGid() : gid;
  const me = buildGroupMe(id);
  const hash = stableStringify(me);
  const last = groupLastSnap[id];
  if (!force && last && hash === last.hash && Date.now() - last.at < GROUP_SNAPSHOT_MAX_AGE_MS) return true;
  const r = await groupApi("PUT", "/group/me", me, id);
  if (r.status === 404) {
    if (id) dropGroup(id);
    else {
      delete groupPrefs().inGroup;
      groupState = null;
      saveProfiles();
    }
    return false;
  }
  if (!r.ok) throw new Error("PUT " + r.status);
  groupLastSnap[id] = { hash, at: Date.now() };
  if (r.data && r.data.nickTaken && typeof r.data.nick === "string" && id) {
    gpFor(id).nick = cleanGroupText(r.data.nick, 20) || gpFor(id).nick;
    saveProfiles();
    showToast("Esse apelido já é de outra pessoa neste grupo. Escolha outro.");
  }
  return true;
}

// Mantém o que eu compartilho em dia em TODOS os meus grupos (não só no que está na tela).
async function pushAllSnapshots(force) {
  const ids = knownGids().length ? knownGids().slice() : [""];
  let activeOk = true;
  for (const id of ids) {
    try {
      const ok = await pushGroupSnapshot(force, id);
      if (id === activeGid() && !ok) activeOk = false;
    } catch (e) {
      if (id === activeGid() || ids.length === 1) throw e;
    }
  }
  return activeOk;
}

// chamado depois de registrar água, sincronizar, mudar emblemas etc.
function scheduleGroupSnapshot(delay) {
  if (!currentProfile || !groupUsable() || !knowsGroups()) return;
  clearTimeout(groupSnapTimer);
  groupSnapTimer = setTimeout(async () => {
    const email = currentEmail;
    try {
      const ok = await pushAllSnapshots(false);
      if (ok && email === currentEmail && groupTabActive()) refreshGroup();
    } catch {}
  }, delay === undefined ? GROUP_SNAPSHOT_DEBOUNCE_MS : delay);
}
async function linkPushDevice() {
  const prefs = groupPrefs();
  if (!window.Notification || Notification.permission !== "granted") return;
  if (Date.now() - (prefs.deviceLinkedAt || 0) < GROUP_DEVICE_LINK_MS) return;
  let creds;
  try {
    creds = JSON.parse(localStorage.getItem("hidrata_push_device") || "null");
  } catch {
    creds = null;
  }
  if (!creds || !creds.id || !creds.secret) return;
  const r = await groupApi("POST", "/group/devices", { deviceId: creds.id, deviceSecret: creds.secret });
  if (r.ok) {
    prefs.deviceLinkedAt = Date.now();
    saveProfiles();
  }
}

// ---------- caixa de entrada: presentes e reações ----------
async function receiveInbox(inbox) {
  if (!Array.isArray(inbox) || !inbox.length) return;
  const prefs = groupPrefs();
  const seen = new Set(prefs.seenEv || []);
  const d = currentData;
  const gifts = [];
  const reacts = [];
  const ackIds = [];
  for (const it of inbox) {
    if (!it || typeof it.id !== "string" || !GROUP_GIFT_ID_RE.test(it.id)) continue;
    ackIds.push(it.id);
    const from = cleanGroupText(it.from, 20) || "Alguém do grupo";
    if (it.k === "gift") {
      const emblem = knownEmblem(it.e);
      const key = emblem ? it.e + ":" + it.id : "";
      if (!emblem || d.giftIn.includes(key)) continue;
      d.giftIn.push(key);
      if (!d.emblems.includes(it.e)) d.emblems.push(it.e);
      gifts.push({ from, emblem });
    } else if (ownKey(GROUP_INCOMING_TEXT, it.k) && !seen.has(it.id)) {
      const gn = knownGids().length > 1 ? cleanGroupText(it.gn, 30) : null; // com vários grupos, diz de qual veio
      reacts.push({ k: it.k, text: GROUP_INCOMING_TEXT[it.k](from) + (gn ? " · " + gn : "") });
    }
    seen.add(it.id);
  }
  prefs.seenEv = [...seen].slice(-40);
  saveProfiles();
  if (gifts.length) {
    saveData();
    scheduleSync();
    renderAlbum();
    scheduleGroupSnapshot(1500);
    showGiftOverlays(gifts);
  }
  if (reacts.length) showIncomingReactions(reacts);
  if (ackIds.length) {
    try {
      await groupApi("POST", "/group/inbox/ack", { ids: ackIds });
    } catch {}
  }
}

function showIncomingReactions(list) {
  const shown = list.slice(0, 3);
  shown.forEach((r, i) => FX.bubble(r.text, i * 700));
  if (list.length > shown.length) FX.bubble(`+${list.length - shown.length} do grupo`, shown.length * 700);
  FX.buzz([20, 50, 20]);
  const mine = document.querySelector("#group-root .g-row.me .gavatar");
  if (mine && groupTabActive()) {
    if (list.some((r) => r.k === "poke")) FX.nudge(mine);
    const first = list.find((r) => r.k !== "poke");
    if (first) {
      const c = FX.center(mine);
      FX.ring(mine, "#5eead4");
      FX.burst(c.x, c.y, first.text.slice(0, 2), 7, { spread: 70 });
    }
  }
}

function showGiftOverlay(g) {
  return new Promise((resolve) => {
    const ok = h("button", "btn-primary", "Legal!");
    ok.type = "button";
    const card = h("div", "g-gift-card", h("div", "g-rays"), h("div", "g-gift-emb", glyphNode(g.emblem)), h("h3", null, `🎁 ${g.from} te deu um emblema!`), h("p", null, `${g.emblem.label} · ${RARITY_LABELS[g.emblem.rarity]}`), ok);
    const ov = h("div", "g-overlay", card);
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", `${g.from} te deu o emblema ${g.emblem.label}`);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      ov.classList.add("out");
      setTimeout(() => {
        ov.remove();
        resolve();
      }, 220);
    };
    ok.addEventListener("click", close);
    ov.addEventListener("click", (e) => {
      if (e.target === ov) close();
    });
    document.body.appendChild(ov);
    ok.focus({ preventScroll: true });
    FX.confetti(30);
    FX.buzz([30, 50, 80]);
    setTimeout(close, 7000);
  });
}
async function showGiftOverlays(list) {
  for (const g of list) await showGiftOverlay(g);
}

// ---------- novidades desde a última visita ----------
function summarizeForFeed(state) {
  const members = {};
  for (const m of state.members) if (m.visible && !m.isMe) members[m.mid] = { nick: m.nick, level: m.level, streak: m.streak, emblems: (m.emblems || []).length };
  return { members, jar: state.group.jarLevel || "" };
}
function computeFeed(state) {
  const prefs = gp();
  const now = summarizeForFeed(state);
  const before = prefs.seen;
  const items = [];
  if (before && before.members) {
    for (const mid of Object.keys(now.members)) {
      const n = now.members[mid];
      const b = before.members[mid];
      if (!b) {
        items.push(`👋 ${n.nick} entrou no grupo`);
        continue;
      }
      if (n.level > b.level) items.push(`⭐ ${n.nick} subiu para o nível ${n.level}`);
      const hit = STREAK_MILESTONES.map((x) => x.n).filter((x) => n.streak >= x && b.streak < x).pop();
      if (hit) items.push(`🔥 ${n.nick} chegou a ${hit} dias seguidos`);
      if (n.emblems > b.emblems) items.push(`🎖️ ${n.nick} ganhou ${n.emblems - b.emblems} ${plural(n.emblems - b.emblems, "emblema novo", "emblemas novos")}`);
    }
    for (const mid of Object.keys(before.members)) if (!now.members[mid]) items.push(`👋 ${before.members[mid].nick} saiu do grupo`);
    const rank = { "": 0, bronze: 1, prata: 2, ouro: 3 };
    if ((rank[now.jar] || 0) > (rank[before.jar] || 0)) items.push(`🏆 A Jarra do grupo evoluiu para ${(ownKey(GROUP_TROPHIES, now.jar) ? GROUP_TROPHIES[now.jar].name : "")}`);
  }
  prefs.seen = now;
  saveProfiles();
  return items.slice(0, 6);
}

// ---------- atualizar tudo ----------
async function refreshGroup() {
  if (!currentProfile) return;
  if (!groupUsable()) {
    renderGroup();
    return;
  }
  if (groupBusy) return;
  groupBusy = true;
  const email = currentEmail;
  const prefs = groupPrefs();
  try {
    if (knowsGroups()) await pushAllSnapshots(false);
    let r = null;
    // se o grupo ativo não existe mais, tenta o primeiro que sobrou
    for (let attempt = 0; attempt < 2; attempt++) {
      r = await groupApi("GET", "/group");
      if (currentEmail !== email) return;
      if (!r.ok || !r.data) throw new Error("GET " + r.status);
      const groups = Array.isArray(r.data.groups) ? r.data.groups.filter((g) => g && typeof g.id === "string" && GROUP_ID_RE.test(g.id)) : [];
      const before = knownGids();
      prefs.gids = groups.map((g) => g.id);
      delete prefs.inGroup;
      if (r.data.group && GROUP_ID_RE.test(String(r.data.group.id))) {
        const id = r.data.group.id;
        prefs.active = id;
        migrateLegacyPrefs(id);
        groupState = r.data;
        groupCache[id] = r.data;
        if (groupUi.needFeed) {
          groupUi.feed = computeFeed(r.data);
          groupUi.needFeed = false;
        }
        if (!before.includes(id)) scheduleGroupSnapshot(500);
        await receiveInbox(r.data.inbox);
        linkPushDevice().catch(() => {});
        break;
      }
      groupState = null;
      prefs.active = groups[0] ? groups[0].id : "";
      if (!groups.length) break;
    }
    saveProfiles();
    groupError = null;
  } catch (e) {
    groupError = e.code === "unauthorized" ? "Sua sessão expirou. Toque em ⇄ (Trocar de perfil) e entre de novo com o Google." : "Não foi possível falar com o servidor agora.";
  } finally {
    groupBusy = false;
    if (currentEmail === email) renderGroup(false);
  }
}

// troca o grupo que está na tela (usa o último estado visto enquanto busca o novo)
function switchGroup(id) {
  const p = groupPrefs();
  if (p.active === id && !groupUi.adding) return;
  p.active = id;
  saveProfiles();
  groupState = groupCache[id] || null;
  groupUi = freshGroupUi();
  groupUi.enter = true;
  groupUi.needFeed = true;
  renderGroup();
  refreshGroup();
}
function startAddGroup() {
  groupUi.adding = true;
  groupUi.enter = true;
  groupUi.msg = "";
  renderGroup();
}
function startGroupPoll() {
  stopGroupPoll();
  groupPollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && groupTabActive()) refreshGroup();
  }, GROUP_REFRESH_MS);
}
function stopGroupPoll() {
  clearInterval(groupPollTimer);
  groupPollTimer = null;
}

// ---------- ganchos chamados por app.js ----------
function groupOnLogin() {
  groupState = null;
  groupError = null;
  groupLastSnap = {};
  groupCache = {};
  groupUi = freshGroupUi();
  renderGroup();
  if (groupUsable()) refreshGroup();
}
function groupOnLogout() {
  stopGroupPoll();
  clearTimeout(groupSnapTimer);
  clearTimeout(groupGoalTimer);
  groupState = null;
  const root = gEl("group-root");
  if (root) root.textContent = "";
}
function groupOnSession() {
  refreshGroup();
}
function groupOnTab(tab) {
  if (tab === "group") {
    groupUi.needFeed = true;
    groupUi.enter = true;
    groupUi.kickArm = "";
    groupUi.leaveArm = false;
    renderGroup();
    refreshGroup();
    startGroupPoll();
  } else {
    stopGroupPoll();
  }
}
function groupAfterCloudDelete() {
  const prefs = groupPrefs();
  delete prefs.inGroup;
  prefs.gids = [];
  prefs.active = "";
  prefs.groups = {};
  prefs.deviceLinkedAt = 0;
  saveProfiles();
  groupState = null;
  groupCache = {};
  groupLastSnap = {};
  groupUi = freshGroupUi();
  renderGroup();
}

// ---------- consentimento ----------
function askGroupConsent() {
  if (!currentProfile || currentProfile.authProvider !== "google") {
    showToast("Grupos só estão disponíveis para contas Google.");
    return;
  }
  openModal("group-consent-modal");
}
async function acceptGroupConsent() {
  closeModal("group-consent-modal");
  const prefs = groupPrefs();
  prefs.consent = true;
  prefs.consentAt = Date.now();
  if (!cleanGroupText(prefs.nick, 20)) prefs.nick = defaultNick();
  saveProfiles();
  let has = !!getSession(currentEmail);
  if (!has && pendingGoogleCredential && Date.now() - pendingGoogleCredential.at < CREDENTIAL_MAX_AGE_MS) {
    has = await establishSession(currentEmail, pendingGoogleCredential.token);
  }
  renderGroup();
  if (has) refreshGroup();
}
function declineGroupConsent() {
  closeModal("group-consent-modal");
  showToast("Tudo bem: você pode entrar em um grupo quando quiser.");
}

// ---------- ações ----------
function friendlyGroupError(action, r) {
  const s = r && r.status;
  const detail = String((r && r.data && r.data.error) || "");
  if (action === "join" && s === 403) return "Você foi removido desse grupo e não pode entrar de novo com este convite.";
  if (s === 409 && /apelido/.test(detail)) return "Esse apelido já é de outra pessoa neste grupo. Escolha outro.";
  if (s === 429 && /hoje/.test(detail)) return "Você chegou ao limite de hoje para essa ação. Tente amanhã.";
  const table = {
    create: { 409: "Você já está em 3 grupos, o limite. Saia de um para criar outro.", 400: "Confira o nome do grupo e o seu apelido (letras, números e espaços)." },
    join: { 404: "Não encontrei esse convite. Confira o código.", 409: "Não deu para entrar: o grupo está cheio, você já está nele ou já está em 3 grupos.", 429: "Muitas tentativas. Tente de novo daqui a pouco.", 400: "Confira o código e o seu apelido." },
    poke: { 409: "Essa pessoa já contou o dia de hoje.", 429: "Você já cutucou essa pessoa hoje." },
    cheer: { 409: "Ainda não dá para mandar essa reação.", 429: "Você já mandou essa reação hoje." },
    gift: { 409: "Esse presente não dá agora: a pessoa já tem o emblema ou já há um a caminho." },
    settings: { 403: "Só quem criou o grupo pode mudar isso." },
  };
  return (table[action] && table[action][s]) || "Não foi possível agora. Tente de novo em instantes.";
}

async function runGroupAction(fn) {
  try {
    return await fn();
  } catch (e) {
    const msg = e && e.code === "unauthorized" ? "Sua sessão expirou. Toque em ⇄ e entre de novo com o Google." : "Sem conexão com o servidor agora.";
    setGroupMsg(msg);
    showToast("⚠️ " + msg);
    return null;
  }
}

async function createGroup(name, nick) {
  const prefs = groupPrefs();
  prefs.nick = nick;
  saveProfiles();
  const r = await runGroupAction(() => groupApi("POST", "/group", { name, me: buildGroupMe() }));
  if (!r) return;
  if (!r.ok) return setGroupMsg(friendlyGroupError("create", r));
  onJoinedGroup(r.data);
  showToast("👥 Grupo criado! Compartilhe o convite.");
}
async function joinGroup(code, nick) {
  const prefs = groupPrefs();
  prefs.nick = nick;
  saveProfiles();
  const r = await runGroupAction(() => groupApi("POST", "/group/join", { code, me: buildGroupMe() }));
  if (!r) return;
  if (!r.ok) return setGroupMsg(friendlyGroupError("join", r));
  onJoinedGroup(r.data);
  showToast("👥 Você entrou no grupo!");
}
function onJoinedGroup(data) {
  const prefs = groupPrefs();
  const id = data.group.id;
  prefs.gids = [...new Set([...knownGids(), id])];
  prefs.active = id;
  delete prefs.inGroup;
  prefs.deviceLinkedAt = 0;
  const mine = gpFor(id);
  mine.nick = prefs.nick;
  mine.seen = summarizeForFeed(data);
  saveProfiles();
  groupState = data;
  groupCache[id] = data;
  groupUi = freshGroupUi();
  groupUi.enter = true;
  groupLastSnap[id] = { hash: stableStringify(buildGroupMe(id)), at: Date.now() };
  linkPushDevice().catch(() => {});
  renderGroup();
  FX.confetti(24);
  FX.buzz([20, 40, 60]);
}

async function leaveGroup() {
  const id = activeGid();
  const r = await runGroupAction(() => groupApi("POST", "/group/leave"));
  if (!r || !r.ok) return;
  if (id) dropGroup(id);
  else {
    delete groupPrefs().inGroup;
    groupState = null;
  }
  if (!knownGids().length) groupPrefs().deviceLinkedAt = 0;
  saveProfiles();
  groupUi = freshGroupUi();
  groupUi.enter = true;
  renderGroup();
  if (knownGids().length) refreshGroup();
  showToast("Você saiu do grupo e o que você compartilhava lá foi apagado.");
}

function actKey(kind, mid) {
  return kind + ":" + mid;
}
function actDoneToday(kind, mid) {
  const acts = groupPrefs().acts;
  return !!acts && acts[actKey(kind, mid)] === todayStr();
}
function markActDone(kind, mid) {
  const prefs = groupPrefs();
  const today = todayStr();
  const acts = {};
  for (const k of Object.keys(prefs.acts || {})) if (prefs.acts[k] === today) acts[k] = today;
  acts[actKey(kind, mid)] = today;
  prefs.acts = acts;
  saveProfiles();
}

// Enquanto uma animação voa, a tela não pode ser remontada (cortaria o efeito); o que chegou espera.
function holdRender(ms) {
  groupUi.hold++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    setTimeout(() => {
      groupUi.hold = Math.max(0, groupUi.hold - 1);
      if (groupUi.hold === 0 && groupUi.pendingRender) renderGroup(false);
    }, ms || 1300);
  };
}

// cutucada: uma gota voa do botão até o avatar, que balança e respinga
async function sendPoke(m, btn, row) {
  const release = holdRender();
  btn.disabled = true;
  FX.buzz(12);
  const avatar = row.querySelector(".gavatar");
  const request = runGroupAction(() => groupApi("POST", "/group/poke", { mid: m.mid }));
  FX.fly(btn, avatar, "💧", {
    ms: 620,
    size: 26,
    onArrive: () => {
      if (!avatar.isConnected) return;
      const c = FX.center(avatar);
      FX.nudge(avatar);
      FX.ring(avatar, "#5eead4");
      FX.burst(c.x, c.y, ["💦", "💧"], 7, { spread: 62, size: 16 });
    },
  });
  const r = await request;
  if (r && r.ok) {
    markActDone("poke", m.mid);
    btn.textContent = "Enviado ✓";
    btn.classList.add("sent");
    FX.pulse(btn);
    showToast(`💧 ${m.nick} recebeu um copo d'água`);
  } else {
    if (r && r.status === 429) {
      markActDone("poke", m.mid);
      btn.textContent = "Enviado ✓";
    } else btn.disabled = false;
    FX.shake(btn);
    if (r) showToast("⚠️ " + friendlyGroupError("poke", r));
  }
  release();
}

function reactionAllowed(k, m, days) {
  const counted = sumDays(days);
  if (k === "clap") return m.streak >= 3 || counted >= 3;
  if (k === "fire") return m.streak >= 3;
  if (k === "party") return counted >= 1;
  return true;
}

// reação: o emoji voa até o avatar e estoura em confete de emojis
async function sendReaction(rx, m, btn, row) {
  const release = holdRender();
  btn.disabled = true;
  FX.buzz(14);
  const avatar = row.querySelector(".gavatar");
  const request = runGroupAction(() => groupApi("POST", "/group/cheer", { mid: m.mid, kind: rx.k }));
  FX.fly(btn, avatar, rx.e, {
    ms: 600,
    size: 28,
    onArrive: () => {
      if (!avatar.isConnected) return;
      const c = FX.center(avatar);
      FX.bounce(avatar);
      FX.ring(avatar, "#fbbf24");
      FX.burst(c.x, c.y, rx.e, 9, { spread: 76, size: 20 });
      if (rx.k === "party") FX.confetti(16);
    },
  });
  const r = await request;
  const key = "cheer:" + rx.k;
  if (r && r.ok) {
    markActDone(key, m.mid);
    btn.classList.add("used");
    showToast(`${rx.e} ${rx.label} enviado para ${m.nick}`);
  } else {
    if (r && r.status === 429) {
      markActDone(key, m.mid);
      btn.classList.add("used");
    } else btn.disabled = false;
    FX.shake(btn);
    if (r) showToast("⚠️ " + friendlyGroupError("cheer", r));
  }
  release();
}

function closeTray(row) {
  const tray = row.querySelector(".g-tray");
  if (!tray) return;
  const finish = () => {
    tray.remove();
    if (groupUi.pendingRender && groupUi.hold === 0 && !document.querySelector("#group-root .g-tray")) renderGroup(false);
  };
  if (!FX.on()) return finish();
  tray.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.92)" }], { duration: 160, easing: "ease-in" }).onfinish = finish;
}
function toggleTray(m, row, days) {
  const open = row.querySelector(".g-tray");
  document.querySelectorAll("#group-root .g-row").forEach((r) => r !== row && closeTray(r));
  if (open) return closeTray(row);
  const tray = h("div", "g-tray");
  GROUP_REACTIONS.forEach((rx, i) => {
    const allowed = reactionAllowed(rx.k, m, days);
    const used = actDoneToday("cheer:" + rx.k, m.mid);
    const b = h("button", "g-react" + (used ? " used" : ""), h("span", "g-react-e", rx.e), h("span", "g-react-l", rx.label));
    b.type = "button";
    b.style.setProperty("--i", i);
    b.disabled = !allowed || used;
    b.setAttribute("aria-label", allowed ? `${rx.label} para ${m.nick}` : `${rx.label} (${rx.need})`);
    if (!allowed) b.title = rx.need;
    b.addEventListener("click", async () => {
      await sendReaction(rx, m, b, row);
      setTimeout(() => closeTray(row), 700);
    });
    tray.appendChild(b);
  });
  row.appendChild(tray);
}

async function sendGift(m, emblem, fromEl) {
  const release = holdRender();
  const chip = document.querySelector('#group-root .g-chip[aria-pressed="true"]');
  FX.buzz(16);
  FX.fly(fromEl, chip, "🎁", { ms: 700, size: 30, arc: 90, onArrive: () => {
    if (!chip || !chip.isConnected) return;
    const c = FX.center(chip);
    FX.ring(chip, "#a78bfa");
    FX.burst(c.x, c.y, ["✨", "🎁", "⭐"], 9, { spread: 80, size: 18 });
  } });
  const r = await runGroupAction(() => groupApi("POST", "/group/gift", { mid: m.mid, emblem: emblem.id }));
  if (!r) return release();
  if (!r.ok || !r.data || !GROUP_GIFT_ID_RE.test(String(r.data.giftId || ""))) {
    showToast("⚠️ " + friendlyGroupError("gift", r));
    return release();
  }
  currentData.giftOut.push(emblem.id + ":" + r.data.giftId);
  saveData();
  scheduleSync();
  renderAlbum();
  showToast(`🎁 ${m.nick} recebeu ${emblem.label} de presente`);
  FX.confetti(14);
  release();
  await runGroupAction(() => pushGroupSnapshot(true));
  refreshGroup();
}

// interruptores mudam no lugar (a animação do botão não some com uma nova montagem da tela)
async function saveGroupPref(key, value, keepScreen) {
  const prefs = gp();
  prefs[key] = value;
  saveProfiles();
  if (!keepScreen) renderGroup();
  await runGroupAction(() => pushGroupSnapshot(true));
  refreshGroup();
}

function changeGoal(delta) {
  const g = groupState.group;
  const base = g.pending ? g.pending.value : g.pct;
  const value = Math.max(50, Math.min(100, base + delta));
  if (value === base) return;
  g.pending = value === g.pct ? null : { value, from: "" };
  renderGroup();
  const label = document.querySelector("#group-root .g-stepper span");
  if (label) FX.pulse(label);
  FX.buzz(8);
  clearTimeout(groupGoalTimer);
  groupGoalTimer = setTimeout(async () => {
    const r = await runGroupAction(() => groupApi("PUT", "/group/settings", { pct: value }));
    if (r && r.ok) groupState = r.data;
    else if (r) showToast("⚠️ " + friendlyGroupError("settings", r));
    renderGroup();
  }, 700);
}

async function rotateInvite() {
  const r = await runGroupAction(() => groupApi("POST", "/group/invite"));
  if (r && r.ok) {
    groupState = r.data;
    renderGroup();
    showToast("🔑 Novo código criado. O antigo deixou de funcionar.");
  }
}
async function kickMember(m) {
  const r = await runGroupAction(() => groupApi("POST", "/group/kick", { mid: m.mid }));
  groupUi.kickArm = "";
  if (r && r.ok) showToast(`${m.nick} foi removido(a) do grupo.`);
  refreshGroup();
}

// ---------- telas ----------
// Só remonta a tela quando algo mudou de verdade (a atualização a cada minuto não mexe na tela à toa).
function groupSig() {
  const prefs = (currentProfile && currentProfile.groupPrefs) || {};
  return [groupError, groupBusy, JSON.stringify(groupState, (k, v) => (k === "serverNow" ? undefined : v)), JSON.stringify(prefs), todayStr(), currentData ? currentData.emblems.length + ":" + currentData.giftIn.length + ":" + currentData.giftOut.length : "", groupUi.feed.length, groupUi.msg, groupUi.adding].join("|");
}

function renderGroup(force) {
  const root = gEl("group-root");
  if (!root || !currentProfile) return;
  const sig = groupSig();
  if (force === false && sig === groupUi.sig) return;
  // uma animação ou a bandeja de reações está aberta: a tela só é remontada quando ela terminar
  if (force === false && (groupUi.hold > 0 || root.querySelector(".g-tray"))) {
    groupUi.pendingRender = true;
    return;
  }
  groupUi.pendingRender = false;
  // não apaga o que a pessoa está digitando
  const active = document.activeElement;
  if (active && root.contains(active) && active.tagName === "INPUT") {
    groupUi.dirty = true;
    return;
  }
  groupUi.dirty = false;
  groupUi.sig = sig;
  const y = window.scrollY;
  root.textContent = "";
  groupUi.albumEl = null;
  const prefs = groupPrefs();
  let dashboard = false;
  if (currentProfile.authProvider !== "google") root.appendChild(gateCard("Grupos precisam de login com Google", "Entre com o Google (toque em ⇄ no topo) para criar ou entrar em um grupo. Contas locais continuam funcionando normalmente, só sem grupos."));
  else if (!syncAvailable()) root.appendChild(gateCard("Grupos indisponíveis", "O servidor não está configurado neste aparelho."));
  else if (prefs.consent !== true) root.appendChild(consentGate());
  else if (!getSession(currentEmail)) root.appendChild(gateCard("Falta entrar de novo com o Google", "Para abrir seu grupo, toque em ⇄ (Trocar de perfil) e entre com o Google outra vez. É rápido."));
  else if (groupUi.adding) {
    if (knowsGroups()) root.appendChild(groupTabsNode());
    renderForms(root);
  } else if (inGroup()) {
    renderDashboard(root);
    dashboard = true;
  } else if (knowsGroups() && !groupError) {
    if (groupState || knownGids().length > 1) root.appendChild(groupTabsNode());
    renderSkeleton(root);
  } else if (knowsGroups() && groupError) root.appendChild(retryCard());
  else if (groupBusy && !groupError) renderSkeleton(root);
  else renderForms(root);
  if (groupError && !inGroup() && !knowsGroups()) root.appendChild(h("p", "g-msg", groupError));
  if (groupUi.enter && (dashboard || root.children.length)) {
    groupUi.enter = false;
    [...root.children].forEach((c, i) => c.style.setProperty("--i", Math.min(i, 8)));
    root.classList.add("g-enter");
    setTimeout(() => root.classList.remove("g-enter"), 1200);
  }
  window.scrollTo(0, y);
}

// seletor no topo: um botão por grupo (até 3) e o "+" para criar ou entrar em outro
function groupTabsNode() {
  const list = ((groupState && groupState.groups) || knownGids().map((id) => ({ id, name: (groupCache[id] && groupCache[id].group.name) || "Grupo" }))).slice(0, GROUP_MAX_PER_USER);
  const wrap = h("div", "g-tabs");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Seus grupos");
  for (const g of list) {
    const c = h("button", "g-chip g-tabchip", h("span", "g-tabname", String(g.name || "Grupo")));
    c.type = "button";
    c.setAttribute("aria-pressed", String(g.id === activeGid() && !groupUi.adding));
    c.addEventListener("click", () => switchGroup(g.id));
    wrap.appendChild(c);
  }
  if (list.length < GROUP_MAX_PER_USER) {
    const add = h("button", "g-chip g-tabchip add", "＋ Grupo");
    add.type = "button";
    add.setAttribute("aria-pressed", String(groupUi.adding));
    add.setAttribute("aria-label", "Criar ou entrar em outro grupo");
    add.addEventListener("click", startAddGroup);
    wrap.appendChild(add);
  }
  return wrap;
}

function gateCard(title, text) {
  return h("div", "g-card", h("h3", null, title), text ? h("p", null, text) : null);
}
function retryCard() {
  const retry = h("button", "btn-primary", "Tentar de novo");
  retry.type = "button";
  retry.addEventListener("click", refreshGroup);
  return h("div", "g-card", h("h3", null, "Não consegui abrir seu grupo"), h("p", null, groupError), retry);
}
function renderSkeleton(root) {
  root.append(h("div", "g-skel g-skel-head"), h("div", "g-skel g-skel-jar"), h("div", "g-skel g-skel-row"), h("div", "g-skel g-skel-row"));
}
function consentGate() {
  const btn = h("button", "btn-primary", "Criar ou entrar em um grupo");
  btn.type = "button";
  btn.addEventListener("click", askGroupConsent);
  return h(
    "div",
    "g-card",
    h("h3", null, "👥 Beba água em grupo"),
    h("p", null, "Junte a família ou os amigos com um código de convite. Cada pessoa tem a própria meta: o grupo enche uma Jarra juntos durante a semana, se cutucam, reagem, se presenteiam e comparam os álbuns de emblemas."),
    h("p", null, "Dá para participar de até 3 grupos (ex.: família e trabalho), cada um com seu apelido. Ninguém vê quanto você bebeu. Você escolhe o que aparece e pode sair quando quiser."),
    btn
  );
}

function inputField(label, id, value, opts) {
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  input.value = value || "";
  input.maxLength = (opts && opts.max) || 30;
  input.autocomplete = "off";
  if (opts && opts.placeholder) input.placeholder = opts.placeholder;
  if (opts && opts.caps) input.autocapitalize = "characters";
  return { wrap: h("label", null, label, input), input };
}

function renderForms(root) {
  const prefs = groupPrefs();
  const nick = inputField("Seu apelido neste grupo", "g-nick", prefs.nick || defaultNick(), { max: 20 });
  const name = inputField("Nome do grupo", "g-name", "", { max: 30, placeholder: "Ex.: Família Silva" });
  const code = inputField("Código de convite", "g-code", "", { max: 16, placeholder: "AGUA-XXXXXX", caps: true });
  const create = h("button", "btn-primary", "Criar grupo");
  const join = h("button", "btn-primary", "Entrar no grupo");
  create.type = join.type = "button";

  const readNick = () => {
    const n = cleanGroupText(nick.input.value, 20);
    if (!n) setGroupMsg("Use só letras, números e espaços no apelido (até 20).");
    return n;
  };
  create.addEventListener("click", async () => {
    const n = readNick();
    const g = cleanGroupText(name.input.value, 30);
    if (n && !g) return setGroupMsg("Dê um nome ao grupo (letras, números e espaços, até 30).");
    if (!n || !g) return;
    setGroupMsg("");
    create.disabled = true;
    await createGroup(g, n);
    create.disabled = false;
  });
  join.addEventListener("click", async () => {
    const n = readNick();
    const c = code.input.value.trim();
    if (n && !c) return setGroupMsg("Digite o código de convite que você recebeu.");
    if (!n || !c) return;
    setGroupMsg("");
    join.disabled = true;
    await joinGroup(c, n);
    join.disabled = false;
  });

  const msg = h("p", "g-msg", groupUi.msg);
  msg.id = "g-msg";
  msg.setAttribute("aria-live", "polite");
  root.append(
    h("div", "g-card", h("h3", null, "👥 Grupos"), h("p", null, "Só entra quem tem o convite. Cada pessoa tem a própria meta e ninguém vê quanto você bebeu."), h("div", "g-form", nick.wrap)),
    h("div", "g-card", h("h3", null, "Criar um grupo"), h("div", "g-form", name.wrap, create)),
    h("div", "g-card", h("h3", null, "Entrar com um convite"), h("div", "g-form", code.wrap, join)),
    msg
  );
}

function memberDays(m, week) {
  if (m.weekStart === week) return m.days;
  if (m.prevWeekStart === week) return m.prevDays;
  return [0, 0, 0, 0, 0, 0, 0];
}
function sumDays(days) {
  return days.reduce((a, b) => a + b, 0);
}

function renderDashboard(root) {
  const st = groupState;
  const g = st.group;
  const week = g.currentWeek;
  const todayIdx = Math.max(0, Math.min(6, keyDiffDays(week, todayStr())));
  const visible = st.members.filter((m) => m.visible);
  const drops = visible.reduce((s, m) => s + sumDays(memberDays(m, week)), 0);

  // cabeçalho
  const code = "AGUA-" + g.code;
  const codeSpan = h("span", null, code);
  const invite = h("button", "g-invite", h("small", null, "Convite"), codeSpan);
  invite.type = "button";
  invite.setAttribute("aria-label", "Copiar código de convite " + code);
  invite.addEventListener("click", () => {
    const done = () => {
      codeSpan.textContent = "Copiado ✓";
      FX.pulse(codeSpan);
      FX.buzz(10);
      setTimeout(() => {
        if (codeSpan.isConnected) codeSpan.textContent = code;
      }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => showToast("Selecione e copie: " + code));
    else showToast("Selecione e copie: " + code);
  });
  root.appendChild(groupTabsNode());
  root.appendChild(h("header", "g-head", h("div", null, h("h2", "g-title", g.name), h("p", "g-meta", `${st.members.length} ${plural(st.members.length, "pessoa", "pessoas")} · cada uma com a própria meta`)), invite));

  // resumo da semana passada
  const lr = g.lastResult;
  if (lr && lr.members >= 2 && gp().recapSeen !== lr.week) {
    const close = h("button", "btn-link", "Fechar");
    close.type = "button";
    close.addEventListener("click", () => {
      gp().recapSeen = lr.week;
      saveProfiles();
      renderGroup();
    });
    root.appendChild(
      h(
        "div",
        "g-card g-recap",
        h("h3", null, lr.full ? "🎉 Jarra cheia na semana passada!" : "Resumo da semana passada"),
        h("p", null, `Semana de ${weekLabel(lr.week)}: `, h("b", null, `${lr.drops} de ${lr.goal} gotas`), lr.full ? `. Sequência da Jarra: ${lr.streak} ${plural(lr.streak, "semana", "semanas")}.` : ". Não encheu dessa vez. Semana nova, Jarra vazia: bora!"),
        close
      )
    );
  }

  // novidades
  if (groupUi.feed.length) {
    root.appendChild(h("div", "g-card", h("h3", null, "Desde a sua última visita"), h("ul", "g-feed", ...groupUi.feed.map((t, i) => { const li = h("li", null, t); li.style.setProperty("--i", i); return li; }))));
  }

  root.appendChild(renderJarSection(g, week, todayIdx, drops));
  root.appendChild(renderRowsSection(st, week, todayIdx));
  const album = renderAlbumSection();
  if (album) {
    groupUi.albumEl = album;
    root.appendChild(album);
  }
  root.appendChild(renderPrivacySection(st));
  const msg = h("p", "g-msg", groupUi.msg);
  msg.id = "g-msg";
  msg.setAttribute("aria-live", "polite");
  root.appendChild(msg);
}

function jarBadgeSvg(color) {
  const w = document.createElement("span");
  w.innerHTML = `<svg viewBox="0 0 40 44" width="34" height="38" aria-hidden="true"><rect x="11" y="2" width="18" height="7" rx="3" fill="${color}"/><path d="M9 11h22v4c4 2 6 6 6 10v11a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V25c0-4 2-8 6-10z" fill="#1c2c47" stroke="${color}" stroke-width="2"/><path d="M4 27q4-3 8 0t8 0 8 0 8 0v9a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" fill="#14b8a6"/><path d="M20 15l1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" fill="${color}"/></svg>`;
  return w.firstChild;
}

function renderJarSection(g, week, todayIdx, drops) {
  const sec = h("section", "g-sec");
  const bar = h("div", "g-week-bar");
  bar.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 7; i++) bar.appendChild(h("i", i < todayIdx ? "past" : i === todayIdx ? "today" : ""));
  const daysLeft = 7 - todayIdx;
  sec.appendChild(h("div", "g-week", h("div", "g-week-top", h("b", null, `Semana de ${weekLabel(week)}`), h("span", null, daysLeft === 1 ? "último dia" : `faltam ${daysLeft - 1} dias`)), bar));

  const cap = Math.max(g.cap, 1);
  const goal = g.goal;
  const fill = Math.min(1, drops / cap);
  const goalY = GROUP_JAR.top + GROUP_JAR.height * (1 - Math.min(1, goal / cap));
  const svgBox = h("div");
  svgBox.innerHTML = `<svg class="g-jar" viewBox="0 0 120 160" role="img"><defs><clipPath id="g-inside"><rect x="12" y="44" width="96" height="108" rx="24"/></clipPath></defs><rect x="12" y="44" width="96" height="108" rx="24" fill="#0e1729" stroke="#2c3f63" stroke-width="2"/><g clip-path="url(#g-inside)"><g id="g-water" style="transform: translateY(152px); transition: transform 1.2s cubic-bezier(.3,.8,.3,1)"><g class="wave"><path d="M-60 0 q15 -7 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 V140 H-60 z" fill="#14b8a6" opacity=".85"/></g></g></g><line id="g-goal-line" x1="12" x2="108" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="4 4"/><text id="g-goal-text" x="108" text-anchor="end" font-size="9" font-weight="700" fill="#fbbf24"></text><rect x="30" y="26" width="60" height="20" rx="7" fill="#17233a" stroke="#2c3f63" stroke-width="2"/></svg>`;
  const svg = svgBox.firstChild;
  svg.setAttribute("aria-label", `Jarra do grupo com ${drops} gotas de ${g.cap} possíveis; a meta é ${goal}`);
  const line = svg.querySelector("#g-goal-line");
  line.setAttribute("y1", goalY);
  line.setAttribute("y2", goalY);
  const label = svg.querySelector("#g-goal-text");
  label.setAttribute("y", goalY - 6);
  label.textContent = "meta " + goal;
  // a água sobe do nível anterior até o novo (e enche do zero na primeira vez)
  const water = svg.querySelector("#g-water");
  const levelY = (f) => GROUP_JAR.top + GROUP_JAR.height * (1 - f);
  water.style.transform = `translateY(${levelY(groupUi.lastFill === null ? 0 : groupUi.lastFill)}px)`;
  requestAnimationFrame(() => requestAnimationFrame(() => { water.style.transform = `translateY(${levelY(fill)}px)`; }));

  const left = Math.max(0, goal - drops);
  const isFull = g.activeMembers >= 2 && left === 0;
  let msg;
  if (g.activeMembers < 2) msg = h("p", null, "A Jarra só enche com duas ou mais pessoas visíveis. Convide alguém com o código acima.");
  else if (left === 0) msg = h("p", null, h("b", null, "Jarra cheia!"), " Mantendo até domingo, o grupo ganha mais uma semana na sequência.");
  else msg = h("p", null, "Faltam ", h("b", null, `${left} ${plural(left, "gota", "gotas")}`), daysLeft === 1 ? ". Último dia, hoje conta!" : ` em ${daysLeft} ${plural(daysLeft, "dia", "dias")}. `, daysLeft === 1 ? null : h("b", null, "Hoje conta."));

  const trophy = ownKey(GROUP_TROPHIES, g.jarLevel) ? GROUP_TROPHIES[g.jarLevel] : null;
  const trophyBox = h("div", "g-trophy" + (trophy ? " on" : ""));
  if (trophy) trophyBox.style.setProperty("--g-trophy", trophy.color);
  trophyBox.appendChild(jarBadgeSvg(trophy ? trophy.color : "#5b6b86"));
  trophyBox.appendChild(
    trophy
      ? h("span", null, h("b", null, `Jarra ${trophy.name}`), `${g.jarStreak} ${plural(g.jarStreak, "semana seguida", "semanas seguidas")}.`, trophy.next ? ` Próxima: ${trophy.next}.` : " O topo!")
      : h("span", null, h("b", null, "Emblema do grupo"), `Encha a Jarra até domingo para ganhar a Jarra Bronze.${g.jarBest ? ` Melhor sequência: ${g.jarBest}.` : ""}`)
  );

  const prevDrops = groupUi.lastDrops;
  const numEl = h("span", null, String(prevDrops === null ? 0 : prevDrops));
  const wrap = h("div", "g-jar-wrap" + (isFull ? " full" : ""), svgBox, h("div", "g-jar-txt", h("div", "g-jar-num", numEl, " ", h("small", null, `/ ${goal} gotas`)), msg, trophyBox));
  sec.appendChild(wrap);
  sec.appendChild(h("p", "g-note", "Cada gota é um dia em que alguém chegou ao mínimo ", h("u", null, "da própria meta"), ". Ninguém precisa fechar todos os dias."));
  sec.appendChild(renderGoalBox(g));

  // depois de montada: número contando, gotas caindo na Jarra e confete quando ela enche
  const gained = prevDrops !== null && drops > prevDrops;
  const prefs = gp();
  const celebrate = isFull && prefs.fullShown !== week;
  if (celebrate) {
    prefs.fullShown = week;
    saveProfiles();
  }
  groupUi.lastDrops = drops;
  groupUi.lastFill = fill;
  requestAnimationFrame(() => {
    FX.count(numEl, prevDrops === null ? 0 : prevDrops, drops, 800);
    if (!svg.isConnected) return;
    if (gained) {
      const r = svg.getBoundingClientRect();
      const x = r.left + r.width / 2;
      for (let i = 0; i < Math.min(3, drops - prevDrops); i++) FX.drop(x + (i - 1) * 14, r.top - 10, r.top + r.height * 0.5, i * 170);
      FX.buzz(10);
    }
    if (celebrate) {
      setTimeout(() => {
        FX.confetti(30);
        FX.buzz([30, 40, 30, 40, 80]);
      }, 700);
    }
  });
  return sec;
}

function renderGoalBox(g) {
  const pctNow = g.pending ? g.pending.value : g.pct;
  const goalNext = Math.max(1, Math.round((g.cap * pctNow) / 100));
  const info = h("div", null, h("b", null, "Meta da semana"));
  let hint = `Padrão: ${g.defaultPct}% do máximo (${g.activeMembers} ${plural(g.activeMembers, "pessoa", "pessoas")} × 7 dias).`;
  if (g.pending) hint = `Vale a partir de segunda: ${goalNext} de ${g.cap} gotas (${pctNow}%). Esta semana continua em ${g.goal}.`;
  else if (g.pct !== g.defaultPct) hint = `Personalizada: ${g.pct}% do máximo. O padrão seria ${Math.max(1, Math.round((g.cap * g.defaultPct) / 100))}.`;
  info.appendChild(h("small", null, hint));
  const box = h("div", "g-goal", info);
  if (g.isCreator) {
    const minus = h("button", null, "−");
    const plus = h("button", null, "+");
    minus.type = plus.type = "button";
    minus.setAttribute("aria-label", "Diminuir a meta");
    plus.setAttribute("aria-label", "Aumentar a meta");
    minus.disabled = pctNow <= 50;
    plus.disabled = pctNow >= 100;
    minus.addEventListener("click", () => changeGoal(-5));
    plus.addEventListener("click", () => changeGoal(5));
    box.appendChild(h("div", "g-stepper", minus, h("span", null, `${goalNext} de ${g.cap}`), plus));
  } else {
    box.appendChild(h("b", null, `${g.goal} de ${g.cap}`));
    info.appendChild(h("small", null, "Só quem criou o grupo muda a meta."));
  }
  return box;
}

function memberTodayCounted(m, week, todayIdx) {
  return m.weekStart === week && m.days[todayIdx] === 1;
}

function pokeButton(m, row) {
  const done = actDoneToday("poke", m.mid);
  const b = h("button", "g-btn" + (done ? " sent" : ""), done ? "Enviado ✓" : "💧 Cutucar");
  b.type = "button";
  b.disabled = done;
  b.setAttribute("aria-label", `Cutucar ${m.nick} com um copo d'água`);
  b.addEventListener("click", () => sendPoke(m, b, row));
  return b;
}
function reactButton(m, row, days) {
  const b = h("button", "g-btn", "✨ Reagir");
  b.type = "button";
  b.setAttribute("aria-label", `Reagir a ${m.nick}`);
  b.addEventListener("click", () => toggleTray(m, row, days));
  return b;
}

function renderRowsSection(st, week, todayIdx) {
  const sec = h("section", "g-sec");
  sec.appendChild(h("h3", "g-sec-title", "Constância da semana"));
  const rows = h("div", "g-rows");
  const order = st.members.slice().sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    if (!a.visible) return 0;
    return sumDays(memberDays(b, week)) - sumDays(memberDays(a, week)) || b.streak - a.streak;
  });
  const dayNames = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
  for (const m of order) {
    const row = h("div", "g-row" + (m.isMe ? " me" : "") + (m.visible ? "" : " hid"));
    row.dataset.mid = m.mid;
    row.appendChild(avatarNode(m, "gavatar"));
    const who = h("div", "g-who");
    const top = h("div", "g-who-top", h("b", null, m.isMe ? `${m.nick} (você)` : m.nick));
    if (m.visible) {
      top.appendChild(h("span", "g-pill", `Nv ${m.level}`));
      top.appendChild(h("span", "g-streak", `🔥 ${m.streak} ${plural(m.streak, "dia", "dias")}`));
    }
    who.appendChild(top);
    const side = h("div", "g-side");
    if (m.visible) {
      const days = memberDays(m, week);
      const before = groupUi.prevDays[m.mid];
      const dots = h("div", "g-dots");
      dots.setAttribute("role", "img");
      const okNames = [];
      for (let d = 0; d < 7; d++) {
        let cls = "g-dot";
        if (days[d] === 1) {
          cls += " ok";
          okNames.push(dayNames[d]);
          if (before && before[d] === "0") cls += " pop"; // acabou de contar: a bolinha "estoura"
        } else if (d === todayIdx) cls += " today";
        else if (d > todayIdx) cls += " future";
        dots.appendChild(h("span", cls, GROUP_DAY_LETTERS[d]));
      }
      groupUi.prevDays[m.mid] = days.join("");
      dots.setAttribute("aria-label", "Dias que contaram: " + (okNames.length ? okNames.join(", ") : "nenhum"));
      who.appendChild(dots);
      if (!m.isMe) {
        if (memberTodayCounted(m, week, todayIdx)) side.appendChild(h("span", "g-counted", "hoje ✓"));
        else side.appendChild(pokeButton(m, row));
        side.appendChild(reactButton(m, row, days));
      }
    } else {
      side.textContent = "oculto";
    }
    row.append(who, side);
    rows.appendChild(row);
  }
  sec.appendChild(rows);
  sec.appendChild(h("p", "g-note", "Ordem por dias que contaram, depois por sequência. Compara constância, nunca litros. Cutucar: 1 por pessoa por dia. Reagir: 1 de cada tipo por pessoa por dia. O aviso chega se a pessoa tiver as notificações ligadas."));
  return sec;
}

// ---------- comparar álbum ----------
function glyphNode(e) {
  const g = emblemGlyph(e);
  if (g === e.label.charAt(0)) return h("span", "letter", g);
  return document.createTextNode(g);
}

function renderAlbumSection() {
  const st = groupState;
  const others = st.members.filter((m) => !m.isMe && m.visible);
  if (!others.length) return null;
  if (!others.some((m) => m.mid === groupUi.other)) {
    groupUi.other = others[0].mid;
    groupUi.sel = "";
    groupUi.filter = "all";
  }
  const other = others.find((m) => m.mid === groupUi.other);
  const mine = new Set(currentData.emblems.filter((id) => knownEmblem(id)));
  const theirs = new Set((other.emblems || []).filter((id) => knownEmblem(id)));
  const total = EMBLEMS.length;
  const onlyThem = EMBLEMS.filter((e) => theirs.has(e.id) && !mine.has(e.id));
  const onlyMe = EMBLEMS.filter((e) => mine.has(e.id) && !theirs.has(e.id));
  const name = other.nick;
  const rerender = () => {
    const fresh = renderAlbumSection();
    if (groupUi.albumEl && fresh) {
      groupUi.albumEl.replaceWith(fresh);
      groupUi.albumEl = fresh;
    }
  };

  const sec = h("section", "g-sec");
  sec.appendChild(h("h3", "g-sec-title", "Comparar álbum"));
  const chips = h("div", "g-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Comparar com");
  for (const m of others) {
    const c = h("button", "g-chip", avatarNode(m, "g-mini"), m.nick);
    c.type = "button";
    c.setAttribute("aria-pressed", String(m.mid === groupUi.other));
    c.addEventListener("click", () => {
      groupUi.other = m.mid;
      groupUi.sel = "";
      groupUi.filter = "all";
      groupUi.animGrid = true;
      rerender();
    });
    chips.appendChild(c);
  }
  sec.appendChild(chips);
  const versus = (label, n, cls) => {
    const fillEl = h("i");
    fillEl.style.width = (n / total) * 100 + "%";
    return h("div", cls, h("small", null, label), h("b", null, String(n)), h("small", null, `de ${total} emblemas`), h("div", "g-bar", fillEl));
  };
  sec.appendChild(h("div", "g-versus", versus("Você", mine.size, ""), versus(name, theirs.size, "other")));
  sec.appendChild(h("p", "g-gap", h("b", null, String(onlyThem.length)), ` que ${name} tem e você ainda não · `, h("b", null, String(onlyMe.length)), ` que você tem e ${name} não.`));

  const filters = h("div", "g-chips");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Filtro do álbum");
  for (const [key, text] of [["all", "Todos"], ["them", `Só ${name} tem (${onlyThem.length})`], ["me", `Só eu tenho (${onlyMe.length})`]]) {
    const c = h("button", "g-chip small", text);
    c.type = "button";
    c.setAttribute("aria-pressed", String(groupUi.filter === key));
    c.addEventListener("click", () => {
      groupUi.filter = key;
      groupUi.animGrid = true;
      rerender();
    });
    filters.appendChild(c);
  }
  sec.appendChild(filters);

  const grid = h("div", "g-grid" + (groupUi.animGrid ? " swap" : ""));
  let selTile = null;
  for (const e of EMBLEMS) {
    const im = mine.has(e.id);
    const it = theirs.has(e.id);
    let cls = `g-tile r-${e.rarity} ` + (im && it ? "both" : im ? "mine" : it ? "theirs" : "none");
    if (groupUi.filter === "them" && !(it && !im)) cls += " dim";
    if (groupUi.filter === "me" && !(im && !it)) cls += " dim";
    if (groupUi.sel === e.id) cls += " sel";
    const dot = (who, on) => h("i", who + (on ? " on" : ""));
    const b = h("button", cls, glyphNode(e), h("span", "g-own", dot("me", im), dot("them", it)));
    b.type = "button";
    b.setAttribute("aria-label", `${e.label}, ${RARITY_LABELS[e.rarity]}. ` + (im && it ? "Vocês dois têm." : im ? "Só você tem." : it ? `Só ${name} tem.` : "Nenhum de vocês tem."));
    b.addEventListener("click", () => {
      groupUi.sel = e.id;
      groupUi.animSel = e.id;
      FX.buzz(8);
      rerender();
    });
    if (groupUi.sel === e.id) selTile = b;
    grid.appendChild(b);
  }
  sec.appendChild(grid);

  const pair = (a, b) => h("span", "g-pair", h("i", "me" + (a ? " on" : "")), h("i", "them" + (b ? " on" : "")));
  sec.appendChild(h("div", "g-key", h("span", null, pair(true, true), "os dois têm"), h("span", null, pair(true, false), "só você tem"), h("span", null, pair(false, true), `só ${name} tem`), h("span", null, pair(false, false), "nenhum tem")));

  const detail = h("div", "g-detail");
  const sel = knownEmblem(groupUi.sel);
  if (!sel) {
    detail.append(h("span", "big", "👆"), h("p", null, "Toque num emblema para ver quem tem e presentear seus repetidos."));
  } else {
    const im = mine.has(sel.id);
    const it = theirs.has(sel.id);
    const extra = emblemCopies(currentData, sel.id) - 1;
    let text;
    if (im && it) text = "Vocês dois têm.";
    else if (im) text = `Você tem e ${name} ainda não.` + (extra > 0 ? ` Sobra ${extra} ${plural(extra, "repetido", "repetidos")}.` : "");
    else if (it) text = `${name} tem e você ainda não. Continue bebendo para sortear.`;
    else text = "Nenhum de vocês tem ainda.";
    const chip = (label, on, who) => h("span", `g-who-chip ${who}` + (on ? " yes" : ""), (on ? "✓ " : "") + label);
    const big = h("span", "big", glyphNode(sel));
    const body = h("p", null, h("b", null, sel.label), ` · ${RARITY_LABELS[sel.rarity]}`, h("br"), text, h("span", "g-who-chips", chip("Você", im, "me"), chip(name, it, "them")));
    if (im && !it && extra > 0) {
      const gift = h("button", "g-btn", `🎁 Presentear ${name}`);
      gift.type = "button";
      gift.addEventListener("click", async () => {
        gift.disabled = true;
        await sendGift(other, sel, big);
      });
      body.append(h("br"), gift);
    }
    detail.append(big, body);
    if (groupUi.animSel === sel.id) detail.classList.add("fresh");
  }
  sec.appendChild(detail);
  if (selTile && groupUi.animSel) requestAnimationFrame(() => FX.bounce(selTile));
  groupUi.animSel = "";
  groupUi.animGrid = false;
  return sec;
}

// ---------- privacidade e ajustes ----------
// O interruptor muda no lugar (com a animação) antes de a tela ser atualizada.
function switchRow(title, hint, checked, onChange, disabled) {
  const sw = h("button", "g-switch");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(checked));
  sw.setAttribute("aria-label", title);
  sw.disabled = !!disabled;
  sw.addEventListener("click", () => {
    sw.setAttribute("aria-checked", String(!checked));
    FX.buzz(10);
    holdRender(340)(); // deixa o interruptor terminar de deslizar antes de remontar a tela
    onChange(!checked);
  });
  return h("div", "g-switch-row", h("p", null, title, h("small", null, hint)), sw);
}

function renderPrivacySection(st) {
  const g = st.group;
  const prefs = gp();
  const sec = h("section", "g-card");
  sec.appendChild(h("h3", null, "O que o grupo vê"));
  sec.appendChild(
    h(
      "div",
      "g-two",
      h("div", "yes", h("h4", null, "Vê"), h("ul", null, h("li", null, "Seu apelido"), h("li", null, "Dias da semana que contaram"), h("li", null, "Sequência e nível"), h("li", null, "Quais emblemas você tem"), h("li", null, "Sua foto, só se você permitir"))),
      h("div", "no", h("h4", null, "Não vê"), h("ul", null, h("li", null, "Litros bebidos"), h("li", null, "Peso e horários"), h("li", null, "E-mail e nome do Google")))
    )
  );

  const hasPhoto = !!safeGroupPhoto(currentProfile.picture);
  sec.appendChild(switchRow("Aparecer neste grupo", prefs.visible === false ? "Você fica oculto e suas gotas saem da Jarra. Você ainda vê o grupo." : "Você e suas gotas estão visíveis para todos.", prefs.visible !== false, (v) => saveGroupPref("visible", v, true)));
  sec.appendChild(switchRow("Mostrar minha foto neste grupo", !hasPhoto ? "Sua conta do Google não tem uma foto que dê para usar." : prefs.showPhoto === true ? "Ligado: só os membros deste grupo veem a foto." : "Desligado: o grupo vê só a sua inicial.", prefs.showPhoto === true && hasPhoto, (v) => saveGroupPref("showPhoto", v, true), !hasPhoto));
  const notifOn = window.Notification && Notification.permission === "granted";
  sec.appendChild(switchRow("Receber avisos deste grupo", notifOn ? "Cutucadas, reações, presentes e o resumo de domingo." : "Ative as notificações na aba Hoje para receber avisos com o app fechado.", prefs.pushOk !== false, (v) => saveGroupPref("pushOk", v, true)));

  // apelido
  const nick = document.createElement("input");
  nick.type = "text";
  nick.value = prefs.nick || defaultNick();
  nick.maxLength = 20;
  nick.autocomplete = "off";
  nick.setAttribute("aria-label", "Seu apelido no grupo");
  const saveNick = h("button", "g-btn", "Salvar");
  saveNick.type = "button";
  saveNick.addEventListener("click", () => {
    const n = cleanGroupText(nick.value, 20);
    if (!n) return setGroupMsg("Use só letras, números e espaços no apelido (até 20).");
    setGroupMsg("");
    saveGroupPref("nick", n);
  });
  sec.appendChild(h("div", "g-manage", h("p", "g-note", "Seu apelido neste grupo"), h("div", "g-inline", nick, saveNick)));

  if (g.isCreator) {
    const manage = h("div", "g-manage", h("p", "g-note", "Você criou este grupo. Só você muda a meta, cria um novo convite e remove pessoas."));
    const rotate = h("button", "g-btn", "🔑 Criar novo código de convite");
    rotate.type = "button";
    rotate.addEventListener("click", rotateInvite);
    manage.appendChild(rotate);
    for (const m of st.members.filter((x) => !x.isMe)) {
      const armed = groupUi.kickArm === m.mid;
      const kick = h("button", "g-btn danger" + (armed ? " armed" : ""), armed ? "Toque de novo para remover" : "Remover");
      kick.type = "button";
      kick.addEventListener("click", () => {
        if (!armed) {
          groupUi.kickArm = m.mid;
          renderGroup();
        } else kickMember(m);
      });
      manage.appendChild(h("div", "g-manage-row", h("span", null, m.nick), kick));
    }
    sec.appendChild(manage);
  }

  const leave = h("button", "g-leave" + (groupUi.leaveArm ? " armed" : ""), groupUi.leaveArm ? "Tem certeza? Toque de novo para sair (o que você compartilhava é apagado)" : "Sair do grupo");
  leave.type = "button";
  leave.addEventListener("click", () => {
    if (!groupUi.leaveArm) {
      groupUi.leaveArm = true;
      renderGroup();
    } else leaveGroup();
  });
  sec.appendChild(leave);
  return sec;
}

document.addEventListener("DOMContentLoaded", () => {
  const on = (id, fn) => {
    const el = gEl(id);
    if (el) el.addEventListener("click", fn);
  };
  on("btn-gconsent-accept", acceptGroupConsent);
  on("btn-gconsent-decline", declineGroupConsent);
  on("btn-gconsent-policy", () => openModal("privacy-modal"));
  const root = gEl("group-root");
  if (root) {
    root.addEventListener("focusout", () => setTimeout(() => { if (groupUi.dirty) renderGroup(); }, 0));
    // toque em qualquer botão da aba: onda + vibração curta
    root.addEventListener("pointerdown", (ev) => {
      const el = ev.target.closest(".g-btn, .g-chip, .g-tile, .g-invite, .g-react, .g-stepper button, .btn-primary");
      if (!el || el.disabled) return;
      FX.ripple(el, ev);
      FX.buzz(6);
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !currentProfile) return;
    scheduleGroupSnapshot(1000);
    if (groupTabActive()) refreshGroup();
  });
});
