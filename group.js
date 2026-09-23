/* Grupos do Hidrata (aba Grupo). Depende de app.js, sync.js e privacy.js.
   Compartilha com o grupo só: apelido, dias da semana que chegaram à meta, sequência, nível, emblemas
   e (se a pessoa ligar) o endereço da foto do Google. Nunca litros, peso, horários, e-mail ou nome.
   Tudo o que vem do servidor é tratado como não confiável: só vira texto (textContent), nunca HTML. */

const GROUP_REFRESH_MS = 60000;
const GROUP_SNAPSHOT_DEBOUNCE_MS = 5000;
const GROUP_SNAPSHOT_MAX_AGE_MS = 5 * 3600 * 1000;
const GROUP_DEVICE_LINK_MS = 24 * 3600 * 1000;
const GROUP_PHOTO_RE = /^https:\/\/lh[3-6]\.googleusercontent\.com\/[A-Za-z0-9_\-\/=.]{1,300}$/;
const GROUP_TEXT_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]*$/u;
const GROUP_MEMBER_RE = /^[0-9a-f]{20}$/;
const GROUP_GIFT_ID_RE = /^[A-Za-z0-9_-]{16,24}$/;
const GROUP_DAY_LETTERS = ["S", "T", "Q", "Q", "S", "S", "D"];
const GROUP_TROPHIES = {
  bronze: { name: "Bronze", color: "#cd7f32", next: "Prata com 4 semanas seguidas" },
  prata: { name: "Prata", color: "#cbd5e1", next: "Ouro com 12 semanas seguidas" },
  ouro: { name: "Ouro", color: "#fbbf24", next: null },
};
const GROUP_JAR = { top: 44, height: 108 };

let groupState = null; // resposta do servidor: { group, members, inbox }
let groupBusy = false;
let groupError = null;
let groupPollTimer = null;
let groupSnapTimer = null;
let groupGoalTimer = null;
let groupLastSnap = { hash: "", at: 0 };
let groupUi = freshGroupUi();

function freshGroupUi() {
  return { other: null, filter: "all", sel: "", needFeed: false, feed: [], kickArm: "", leaveArm: false, dirty: false, msg: "", msgOk: false, albumEl: null, jarReady: false };
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
async function groupApi(method, path, body) {
  const session = getSession(currentEmail);
  if (!session) throw Object.assign(new Error("sem sessao"), { code: "unauthorized" });
  const resp = await fetch(syncBase() + path, {
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
function buildGroupMe() {
  const prefs = groupPrefs();
  const me = {
    nick: cleanGroupText(prefs.nick, 20) || defaultNick(),
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

async function pushGroupSnapshot(force) {
  const me = buildGroupMe();
  const hash = stableStringify(me);
  if (!force && hash === groupLastSnap.hash && Date.now() - groupLastSnap.at < GROUP_SNAPSHOT_MAX_AGE_MS) return true;
  const r = await groupApi("PUT", "/group/me", me);
  if (r.status === 404) {
    groupPrefs().inGroup = false;
    saveProfiles();
    groupState = null;
    return false;
  }
  if (!r.ok) throw new Error("PUT " + r.status);
  groupLastSnap = { hash, at: Date.now() };
  return true;
}

// chamado depois de registrar água, sincronizar, mudar emblemas etc.
function scheduleGroupSnapshot(delay) {
  if (!currentProfile || !groupUsable() || !groupPrefs().inGroup) return;
  clearTimeout(groupSnapTimer);
  groupSnapTimer = setTimeout(async () => {
    const email = currentEmail;
    try {
      const ok = await pushGroupSnapshot(false);
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

async function receiveGifts(inbox) {
  if (!Array.isArray(inbox) || !inbox.length) return;
  const d = currentData;
  const got = [];
  const ackIds = [];
  for (const g of inbox) {
    if (!g || typeof g.id !== "string" || !GROUP_GIFT_ID_RE.test(g.id) || !knownEmblem(g.e)) continue;
    ackIds.push(g.id);
    const key = g.e + ":" + g.id;
    if (d.giftIn.includes(key)) continue;
    d.giftIn.push(key);
    if (!d.emblems.includes(g.e)) d.emblems.push(g.e);
    got.push(g);
  }
  if (got.length) {
    saveData();
    scheduleSync();
    renderAlbum();
    scheduleGroupSnapshot(1500);
    const g = got[0];
    const from = cleanGroupText(g.from, 20) || "Alguém do grupo";
    const label = knownEmblem(g.e).label;
    showToast(got.length === 1 ? `🎁 ${from} te deu o emblema ${label}!` : `🎁 Você recebeu ${got.length} emblemas de presente!`);
  }
  if (ackIds.length) {
    try {
      await groupApi("POST", "/group/inbox/ack", { ids: ackIds });
    } catch {}
  }
}

// ---------- novidades desde a última visita ----------
function summarizeForFeed(state) {
  const members = {};
  for (const m of state.members) if (m.visible && !m.isMe) members[m.mid] = { nick: m.nick, level: m.level, streak: m.streak, emblems: (m.emblems || []).length };
  return { members, jar: state.group.jarLevel || "" };
}
function computeFeed(state) {
  const prefs = groupPrefs();
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
    if ((rank[now.jar] || 0) > (rank[before.jar] || 0)) items.push(`🏆 A Jarra do grupo evoluiu para ${GROUP_TROPHIES[now.jar].name}`);
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
    if (prefs.inGroup) await pushGroupSnapshot(false);
    const r = await groupApi("GET", "/group");
    if (currentEmail !== email) return;
    if (!r.ok || !r.data) throw new Error("GET " + r.status);
    if (!r.data.group) {
      prefs.inGroup = false;
      groupState = null;
    } else {
      const first = !prefs.inGroup;
      prefs.inGroup = true;
      groupState = r.data;
      if (groupUi.needFeed) {
        groupUi.feed = computeFeed(r.data);
        groupUi.needFeed = false;
      }
      if (first) scheduleGroupSnapshot(500);
      await receiveGifts(r.data.inbox);
      linkPushDevice().catch(() => {});
    }
    saveProfiles();
    groupError = null;
  } catch (e) {
    groupError = e.code === "unauthorized" ? "Sua sessão expirou. Toque em ⇄ (Trocar de perfil) e entre de novo com o Google." : "Não foi possível falar com o servidor agora.";
  } finally {
    groupBusy = false;
    if (currentEmail === email) renderGroup();
  }
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
  groupLastSnap = { hash: "", at: 0 };
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
  prefs.inGroup = false;
  prefs.deviceLinkedAt = 0;
  delete prefs.seen;
  saveProfiles();
  groupState = null;
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
  const table = {
    create: { 409: "Você já está em um grupo.", 400: "Confira o nome do grupo e o seu apelido (letras, números e espaços)." },
    join: { 404: "Não encontrei esse convite. Confira o código.", 409: "Esse grupo está cheio ou você já está em um grupo.", 429: "Muitas tentativas. Tente de novo daqui a pouco.", 400: "Confira o código e o seu apelido." },
    poke: { 409: "Essa pessoa já contou o dia de hoje.", 429: "Você já cutucou essa pessoa hoje (ou atingiu o limite do dia)." },
    cheer: { 409: "Ainda não há o que aplaudir.", 429: "Você já aplaudiu essa pessoa hoje." },
    gift: { 409: "Esse presente não dá agora: a pessoa já tem o emblema ou já há um a caminho.", 429: "Limite de presentes de hoje atingido." },
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
  prefs.inGroup = true;
  prefs.deviceLinkedAt = 0;
  prefs.seen = summarizeForFeed(data);
  saveProfiles();
  groupState = data;
  groupUi = freshGroupUi();
  groupLastSnap = { hash: stableStringify(buildGroupMe()), at: Date.now() };
  linkPushDevice().catch(() => {});
  renderGroup();
}

async function leaveGroup() {
  const r = await runGroupAction(() => groupApi("POST", "/group/leave"));
  if (!r || !r.ok) return;
  const prefs = groupPrefs();
  prefs.inGroup = false;
  prefs.deviceLinkedAt = 0;
  delete prefs.seen;
  saveProfiles();
  groupState = null;
  groupUi = freshGroupUi();
  renderGroup();
  showToast("Você saiu do grupo e o que você compartilhava foi apagado.");
}

function actKey(kind, mid) {
  return kind + ":" + mid;
}
function actDoneToday(kind, mid) {
  return groupPrefs().acts && groupPrefs().acts[actKey(kind, mid)] === todayStr();
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
async function pokeOrCheer(kind, m) {
  const r = await runGroupAction(() => groupApi("POST", "/group/" + kind, { mid: m.mid }));
  if (!r) return;
  if (r.ok) {
    markActDone(kind, m.mid);
    showToast(kind === "poke" ? `💧 ${m.nick} recebeu um copo d'água` : `👏 Aplauso enviado para ${m.nick}`);
  } else {
    if (r.status === 429) markActDone(kind, m.mid);
    showToast("⚠️ " + friendlyGroupError(kind, r));
  }
  renderGroup();
}

async function sendGift(m, emblem) {
  const r = await runGroupAction(() => groupApi("POST", "/group/gift", { mid: m.mid, emblem: emblem.id }));
  if (!r) return;
  if (!r.ok || !r.data || !GROUP_GIFT_ID_RE.test(String(r.data.giftId || ""))) {
    showToast("⚠️ " + friendlyGroupError("gift", r));
    return;
  }
  currentData.giftOut.push(emblem.id + ":" + r.data.giftId);
  saveData();
  scheduleSync();
  renderAlbum();
  showToast(`🎁 ${m.nick} recebeu ${emblem.label} de presente`);
  await runGroupAction(() => pushGroupSnapshot(true));
  refreshGroup();
}

async function saveGroupPref(key, value) {
  const prefs = groupPrefs();
  prefs[key] = value;
  saveProfiles();
  renderGroup();
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
function renderGroup() {
  const root = gEl("group-root");
  if (!root || !currentProfile) return;
  // não apaga o que a pessoa está digitando
  const active = document.activeElement;
  if (active && root.contains(active) && active.tagName === "INPUT") {
    groupUi.dirty = true;
    return;
  }
  groupUi.dirty = false;
  const y = window.scrollY;
  root.textContent = "";
  groupUi.albumEl = null;
  if (currentProfile.authProvider !== "google") root.appendChild(gateCard("Grupos precisam de login com Google", "Entre com o Google (toque em ⇄ no topo) para criar ou entrar em um grupo. Contas locais continuam funcionando normalmente, só sem grupos."));
  else if (!syncAvailable()) root.appendChild(gateCard("Grupos indisponíveis", "O servidor não está configurado neste aparelho."));
  else if (groupPrefs().consent !== true) root.appendChild(consentGate());
  else if (!getSession(currentEmail)) root.appendChild(gateCard("Falta entrar de novo com o Google", "Para abrir seu grupo, toque em ⇄ (Trocar de perfil) e entre com o Google outra vez. É rápido."));
  else if (inGroup()) renderDashboard(root);
  else if (groupBusy && !groupError) root.appendChild(gateCard("Carregando...", ""));
  else renderForms(root);
  if (groupError && !inGroup()) root.appendChild(h("p", "g-msg", groupError));
  window.scrollTo(0, y);
}

function gateCard(title, text) {
  return h("div", "g-card", h("h3", null, title), text ? h("p", null, text) : null);
}
function consentGate() {
  const btn = h("button", "btn-primary", "Criar ou entrar em um grupo");
  btn.type = "button";
  btn.addEventListener("click", askGroupConsent);
  return h(
    "div",
    "g-card",
    h("h3", null, "👥 Beba água em grupo"),
    h("p", null, "Junte a família ou os amigos com um código de convite. Cada pessoa tem a própria meta: o grupo enche uma Jarra juntos durante a semana, se cutucam, se aplaudem e comparam os álbuns de emblemas."),
    h("p", null, "Ninguém vê quanto você bebeu. Você escolhe o que aparece e pode sair quando quiser."),
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
  const nick = inputField("Seu apelido no grupo", "g-nick", prefs.nick || defaultNick(), { max: 20 });
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
  const invite = h("button", "g-invite", h("small", null, "Convite"), h("span", null, code));
  invite.type = "button";
  invite.setAttribute("aria-label", "Copiar código de convite " + code);
  invite.addEventListener("click", () => {
    const done = () => showToast("Código copiado: " + code);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => showToast("Selecione e copie: " + code));
    else showToast("Selecione e copie: " + code);
  });
  root.appendChild(h("header", "g-head", h("div", null, h("h2", "g-title", g.name), h("p", "g-meta", `${st.members.length} ${plural(st.members.length, "pessoa", "pessoas")} · cada uma com a própria meta`)), invite));

  // resumo da semana passada
  const lr = g.lastResult;
  if (lr && lr.members >= 2 && groupPrefs().recapSeen !== lr.week) {
    const close = h("button", "btn-link", "Fechar");
    close.type = "button";
    close.addEventListener("click", () => {
      groupPrefs().recapSeen = lr.week;
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
    root.appendChild(h("div", "g-card", h("h3", null, "Desde a sua última visita"), h("ul", "g-feed", ...groupUi.feed.map((t) => h("li", null, t)))));
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
  const water = svg.querySelector("#g-water");
  const target = `translateY(${GROUP_JAR.top + GROUP_JAR.height * (1 - fill)}px)`;
  if (groupUi.jarReady) water.style.transform = target;
  else {
    requestAnimationFrame(() => setTimeout(() => { water.style.transform = target; groupUi.jarReady = true; }, 80));
  }

  const left = Math.max(0, goal - drops);
  let msg;
  if (g.activeMembers < 2) msg = h("p", null, "A Jarra só enche com duas ou mais pessoas visíveis. Convide alguém com o código acima.");
  else if (left === 0) msg = h("p", null, h("b", null, "Jarra cheia!"), " Mantendo até domingo, o grupo ganha mais uma semana na sequência.");
  else msg = h("p", null, "Faltam ", h("b", null, `${left} ${plural(left, "gota", "gotas")}`), daysLeft === 1 ? ". Último dia, hoje conta!" : ` em ${daysLeft} ${plural(daysLeft, "dia", "dias")}. `, daysLeft === 1 ? null : h("b", null, "Hoje conta."));

  const trophy = g.jarLevel ? GROUP_TROPHIES[g.jarLevel] : null;
  const trophyBox = h("div", "g-trophy" + (trophy ? " on" : ""));
  if (trophy) trophyBox.style.setProperty("--g-trophy", trophy.color);
  trophyBox.appendChild(jarBadgeSvg(trophy ? trophy.color : "#5b6b86"));
  trophyBox.appendChild(
    trophy
      ? h("span", null, h("b", null, `Jarra ${trophy.name}`), `${g.jarStreak} ${plural(g.jarStreak, "semana seguida", "semanas seguidas")}.`, trophy.next ? ` Próxima: ${trophy.next}.` : " O topo!")
      : h("span", null, h("b", null, "Emblema do grupo"), `Encha a Jarra até domingo para ganhar a Jarra Bronze.${g.jarBest ? ` Melhor sequência: ${g.jarBest}.` : ""}`)
  );

  sec.appendChild(h("div", "g-jar-wrap", svgBox, h("div", "g-jar-txt", h("div", "g-jar-num", h("span", null, String(drops)), " ", h("small", null, `/ ${goal} gotas`)), msg, trophyBox)));
  sec.appendChild(h("p", "g-note", "Cada gota é um dia em que alguém chegou ao mínimo ", h("u", null, "da própria meta"), ". Ninguém precisa fechar todos os dias."));
  sec.appendChild(renderGoalBox(g));
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

function renderRowsSection(st, week, todayIdx) {
  const sec = h("section", "g-sec");
  sec.appendChild(h("h3", "g-sec-title", "Constância da semana"));
  const rows = h("div", "g-rows");
  const order = st.members.slice().sort((a, b) => {
    if (a.visible !== b.visible) return a.visible ? -1 : 1;
    if (!a.visible) return 0;
    return sumDays(memberDays(b, week)) - sumDays(memberDays(a, week)) || b.streak - a.streak;
  });
  for (const m of order) {
    const row = h("div", "g-row" + (m.isMe ? " me" : "") + (m.visible ? "" : " hid"));
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
      const dots = h("div", "g-dots");
      dots.setAttribute("role", "img");
      const okNames = [];
      const dayNames = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
      for (let d = 0; d < 7; d++) {
        let cls = "g-dot";
        if (days[d] === 1) {
          cls += " ok";
          okNames.push(dayNames[d]);
        } else if (d === todayIdx) cls += " today";
        else if (d > todayIdx) cls += " future";
        dots.appendChild(h("span", cls, GROUP_DAY_LETTERS[d]));
      }
      dots.setAttribute("aria-label", "Dias que contaram: " + (okNames.length ? okNames.join(", ") : "nenhum"));
      who.appendChild(dots);
      if (!m.isMe) {
        const counted = memberTodayCounted(m, week, todayIdx);
        if (counted) side.appendChild(h("span", null, "hoje ✓"));
        else side.appendChild(actionButton("poke", m, "Cutucar", `Cutucar ${m.nick} com um copo d'água`));
        if (m.streak >= 3 || sumDays(days) >= 3) side.appendChild(actionButton("cheer", m, "👏 Aplaudir", `Aplaudir ${m.nick}`));
      }
    } else {
      side.textContent = "oculto";
    }
    row.append(who, side);
    rows.appendChild(row);
  }
  sec.appendChild(rows);
  sec.appendChild(h("p", "g-note", "Ordem por dias que contaram, depois por sequência. Compara constância, nunca litros. Cutucar e aplaudir: 1 por pessoa por dia; o aviso chega se a pessoa tiver as notificações ligadas."));
  return sec;
}

function actionButton(kind, m, label, aria) {
  const done = actDoneToday(kind, m.mid);
  const b = h("button", "g-btn", done ? "Enviado ✓" : label);
  b.type = "button";
  b.disabled = done;
  b.setAttribute("aria-label", aria);
  b.addEventListener("click", () => {
    b.disabled = true;
    pokeOrCheer(kind, m);
  });
  return b;
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
      rerender();
    });
    chips.appendChild(c);
  }
  sec.appendChild(chips);
  const versus = (label, n, cls) => h("div", cls, h("small", null, label), h("b", null, String(n)), h("small", null, `de ${total} emblemas`), h("div", "g-bar", (() => { const i = h("i"); i.style.width = (n / total) * 100 + "%"; return i; })()));
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
      rerender();
    });
    filters.appendChild(c);
  }
  sec.appendChild(filters);

  const grid = h("div", "g-grid");
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
      rerender();
    });
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
    const body = h("p", null, h("b", null, sel.label), ` · ${RARITY_LABELS[sel.rarity]}`, h("br"), text, h("span", "g-who-chips", chip("Você", im, "me"), chip(name, it, "them")));
    if (im && !it && extra > 0) {
      const gift = h("button", "g-btn", `🎁 Presentear ${name}`);
      gift.type = "button";
      gift.addEventListener("click", async () => {
        gift.disabled = true;
        await sendGift(other, sel);
      });
      body.append(h("br"), gift);
    }
    detail.append(h("span", "big", glyphNode(sel)), body);
  }
  sec.appendChild(detail);
  return sec;
}

// ---------- privacidade e ajustes ----------
function switchRow(title, hint, checked, onChange, disabled) {
  const sw = h("button", "g-switch");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(checked));
  sw.setAttribute("aria-label", title);
  sw.disabled = !!disabled;
  sw.addEventListener("click", () => onChange(!checked));
  return h("div", "g-switch-row", h("p", null, title, h("small", null, hint)), sw);
}

function renderPrivacySection(st) {
  const g = st.group;
  const prefs = groupPrefs();
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
  sec.appendChild(switchRow("Aparecer no grupo", prefs.visible === false ? "Você fica oculto e suas gotas saem da Jarra. Você ainda vê o grupo." : "Você e suas gotas estão visíveis para todos.", prefs.visible !== false, (v) => saveGroupPref("visible", v)));
  sec.appendChild(switchRow("Mostrar minha foto do Google", !hasPhoto ? "Sua conta do Google não tem uma foto que dê para usar." : prefs.showPhoto === true ? "Ligado: só os membros deste grupo veem a foto." : "Desligado: o grupo vê só a sua inicial.", prefs.showPhoto === true && hasPhoto, (v) => saveGroupPref("showPhoto", v), !hasPhoto));
  const notifOn = window.Notification && Notification.permission === "granted";
  sec.appendChild(switchRow("Receber avisos do grupo", notifOn ? "Cutucadas, aplausos, presentes e o resumo de domingo." : "Ative as notificações na aba Hoje para receber avisos com o app fechado.", prefs.pushOk !== false, (v) => saveGroupPref("pushOk", v)));

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
  sec.appendChild(h("div", "g-manage", h("p", "g-note", "Seu apelido no grupo"), h("div", "g-inline", nick, saveNick)));

  if (g.isCreator) {
    const manage = h("div", "g-manage", h("p", "g-note", "Você criou este grupo. Só você muda a meta, cria um novo convite e remove pessoas."));
    const rotate = h("button", "g-btn", "🔑 Criar novo código de convite");
    rotate.type = "button";
    rotate.addEventListener("click", rotateInvite);
    manage.appendChild(rotate);
    for (const m of st.members.filter((x) => !x.isMe)) {
      const armed = groupUi.kickArm === m.mid;
      const kick = h("button", "g-btn danger", armed ? "Toque de novo para remover" : "Remover");
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

  const leave = h("button", "g-leave", groupUi.leaveArm ? "Tem certeza? Toque de novo para sair (o que você compartilhava é apagado)" : "Sair do grupo");
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
  if (root) root.addEventListener("focusout", () => setTimeout(() => { if (groupUi.dirty) renderGroup(); }, 0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !currentProfile) return;
    scheduleGroupSnapshot(1000);
    if (groupTabActive()) refreshGroup();
  });
});
