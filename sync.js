/* Sincronização entre aparelhos (somente contas Google). Depende de app.js e push-config.js.
   Vai para a nuvem só: peso, atividade, horários, intervalo e histórico/conquistas.
   Nunca: e-mail, nome ou foto. */

const SYNC_SESSIONS_KEY = "hidrata_sessions";
const SYNC_DEBOUNCE_MS = 4000;
const SYNC_VISIBLE_GAP_MS = 30000;
const SYNC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SYNC_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SYNC_LOG_ID_RE = /^[A-Za-z0-9|:_-]{1,60}$/;
const SYNC_NAME_ID_RE = /^[a-z0-9_]{1,40}$/;
const SYNC_GIFT_RE = /^[a-z0-9_]{1,40}:[A-Za-z0-9_-]{8,40}$/;
const SYNC_DEFAULT_SETTINGS = { weightKg: 70, activity: "light", hot: false, wake: "07:00", sleep: "23:00", interval: 90, safetyHours: 6, goalOverride: null };

let syncInFlight = false;
let syncQueued = false;
let syncTimer = null;
let lastSyncAt = 0;
let lastSyncError = null;

function resetSyncState() {
  clearTimeout(syncTimer);
  syncQueued = false;
  lastSyncError = null;
  lastSyncAt = 0;
}

function syncAvailable() {
  return typeof PUSH_SERVER_URL === "string" && PUSH_SERVER_URL !== "";
}
function syncBase() {
  return PUSH_SERVER_URL.replace(/\/$/, "");
}
// Só sincroniza com consentimento explícito (cloudSync === true).
function syncEnabledFor(profile) {
  return !!profile && profile.authProvider === "google" && profile.cloudSync === true;
}

// ---------- sessão (token opaco emitido pelo nosso servidor) ----------
function readSessions() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_SESSIONS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function getSession(email) {
  const s = readSessions()[email];
  return s && s.token && s.exp > Date.now() ? s : null;
}
function saveSession(email, token, exp) {
  const all = readSessions();
  all[email] = { token, exp };
  localStorage.setItem(SYNC_SESSIONS_KEY, JSON.stringify(all));
}
function clearSession(email) {
  const all = readSessions();
  delete all[email];
  localStorage.setItem(SYNC_SESSIONS_KEY, JSON.stringify(all));
}

async function establishSession(email, idToken) {
  if (!syncAvailable()) return false;
  try {
    const resp = await fetch(syncBase() + "/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!resp.ok) {
      lastSyncError = "O servidor não validou seu login do Google.";
      return false;
    }
    const data = await resp.json();
    saveSession(email, data.token, data.expiresAt);
    return true;
  } catch {
    lastSyncError = "Sem conexão com o servidor.";
    return false;
  }
}

// ---------- estado sincronizável ----------
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

// Registros antigos não tinham id: cria um id estável (igual em qualquer aparelho).
function ensureLogIds(data) {
  for (const date of Object.keys(data.logs || {})) {
    const seen = {};
    for (const e of data.logs[date]) {
      if (!e.id) {
        const base = `L${date}|${e.time}|${e.ml}`;
        seen[base] = (seen[base] || 0) + 1;
        e.id = base + "|" + seen[base];
      }
      if (!e.ts) e.ts = Date.parse(`${date}T${e.time}:00`) || 0;
    }
  }
}

function isDefaultSettings(p) {
  const D = SYNC_DEFAULT_SETTINGS;
  return (
    p.weightKg === D.weightKg && p.activity === D.activity && !p.hot && p.wake === D.wake && p.sleep === D.sleep &&
    Number(p.interval) === D.interval && (p.safetyHours === undefined || p.safetyHours === D.safetyHours) && !p.goalOverride
  );
}

function localSyncState() {
  ensureLogIds(currentData);
  const p = currentProfile;
  const d = currentData;
  // perfil antigo sem carimbo: se já foi personalizado, o primeiro envio o declara como "o certo"
  const updatedAt = p.settingsUpdatedAt || (isDefaultSettings(p) ? 0 : Date.now());
  return JSON.parse(
    JSON.stringify({
      v: 1,
      resetAt: d.resetAt || 0,
      settings: {
        weightKg: p.weightKg,
        activity: p.activity,
        hot: !!p.hot,
        wake: p.wake,
        sleep: p.sleep,
        interval: p.interval,
        safetyHours: p.safetyHours === undefined ? 6 : p.safetyHours,
        streakMinPct: streakMinPct(p),
        goalOverride: p.goalOverride || null,
        updatedAt,
      },
      data: {
        logs: d.logs || {},
        goalHit: d.goalHit || {},
        emblemCounts: d.emblemCounts || {},
        xp: d.xp || 0,
        streak: d.streak || 0,
        bestStreak: d.bestStreak || 0,
        lastStreakDate: d.lastStreakDate || null,
        earlyLogs: d.earlyLogs || 0,
        nightLogs: d.nightLogs || 0,
        overGoalDays: d.overGoalDays || 0,
        unlockedBadges: d.unlockedBadges || [],
        emblems: d.emblems || [],
        streakMilestones: d.streakMilestones || [],
        giftIn: d.giftIn || [],
        giftOut: d.giftOut || [],
      },
    })
  );
}

function clampNum(v, min, max, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}
function cleanGiftIds(arr) {
  return Array.isArray(arr) ? [...new Set(arr.filter((x) => typeof x === "string" && SYNC_GIFT_RE.test(x)))].sort().slice(0, 500) : [];
}
function cleanNameIds(arr) {
  return Array.isArray(arr) ? [...new Set(arr.filter((x) => typeof x === "string" && SYNC_NAME_ID_RE.test(x)))].slice(0, 500) : [];
}

// Tudo que vem da nuvem é tratado como não confiável: só passa o que tem formato esperado.
function sanitizeBlob(raw) {
  if (!raw || typeof raw !== "object" || raw.v !== 1 || !raw.settings || typeof raw.settings !== "object" || !raw.data || typeof raw.data !== "object") return null;
  const s = raw.settings;
  const d = raw.data;
  const settings = {
    weightKg: clampNum(s.weightKg, 20, 250, SYNC_DEFAULT_SETTINGS.weightKg),
    activity: ["sedentary", "light", "moderate", "intense"].includes(s.activity) ? s.activity : "light",
    hot: !!s.hot,
    wake: SYNC_TIME_RE.test(s.wake) ? s.wake : "07:00",
    sleep: SYNC_TIME_RE.test(s.sleep) ? s.sleep : "23:00",
    interval: clampInterval(s.interval),
    safetyHours: clampSafetyHours(s.safetyHours === undefined ? 6 : s.safetyHours),
    streakMinPct: streakMinPct({ streakMinPct: s.streakMinPct }),
    goalOverride: s.goalOverride ? clampNum(s.goalOverride, 500, 8000, null) : null,
    updatedAt: clampNum(s.updatedAt, 0, 8.64e15, 0),
  };

  const logs = {};
  let total = 0;
  if (d.logs && typeof d.logs === "object") {
    for (const date of Object.keys(d.logs)) {
      if (!SYNC_DATE_RE.test(date) || !Array.isArray(d.logs[date])) continue;
      const list = [];
      for (const e of d.logs[date]) {
        if (!e || typeof e.id !== "string" || !SYNC_LOG_ID_RE.test(e.id) || typeof e.time !== "string" || !SYNC_TIME_RE.test(e.time)) continue;
        const ml = Math.round(Number(e.ml));
        if (!(ml >= 1 && ml <= 5000)) continue;
        if (++total > 20000) break;
        list.push({ id: e.id, time: e.time, ml, ts: clampNum(e.ts, 0, 8.64e15, 0) });
      }
      if (list.length) logs[date] = list;
    }
  }
  const goalHit = {};
  if (d.goalHit && typeof d.goalHit === "object") {
    for (const k of Object.keys(d.goalHit)) if (SYNC_DATE_RE.test(k) && d.goalHit[k]) goalHit[k] = true;
  }
  const emblemCounts = {};
  if (d.emblemCounts && typeof d.emblemCounts === "object") {
    for (const k of Object.keys(d.emblemCounts)) if (SYNC_NAME_ID_RE.test(k)) emblemCounts[k] = Math.round(clampNum(d.emblemCounts[k], 1, 100000, 1));
  }
  return {
    v: 1,
    resetAt: clampNum(raw.resetAt, 0, 8.64e15, 0),
    settings,
    data: {
      logs,
      goalHit,
      emblemCounts,
      xp: Math.round(clampNum(d.xp, 0, 1e9, 0)),
      streak: Math.round(clampNum(d.streak, 0, 100000, 0)),
      bestStreak: Math.round(clampNum(d.bestStreak, 0, 100000, 0)),
      lastStreakDate: typeof d.lastStreakDate === "string" && SYNC_DATE_RE.test(d.lastStreakDate) ? d.lastStreakDate : null,
      earlyLogs: Math.round(clampNum(d.earlyLogs, 0, 1e6, 0)),
      nightLogs: Math.round(clampNum(d.nightLogs, 0, 1e6, 0)),
      overGoalDays: Math.round(clampNum(d.overGoalDays, 0, 1e6, 0)),
      unlockedBadges: cleanNameIds(d.unlockedBadges),
      emblems: cleanNameIds(d.emblems),
      streakMilestones: Array.isArray(d.streakMilestones)
        ? [...new Set(d.streakMilestones.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 100000))]
        : [],
      giftIn: cleanGiftIds(d.giftIn),
      giftOut: cleanGiftIds(d.giftOut),
    },
  };
}

// União sem perda: registros de água de qualquer aparelho entram; contadores usam o maior valor.
// "Apagar meus dados" cria uma nova época (resetAt): quem reiniciou depois vence por inteiro.
function mergeSyncStates(local, remote) {
  const lr = local.resetAt || 0;
  const rr = remote.resetAt || 0;
  if (rr > lr) return remote;
  if (lr > rr) return local;

  const L = local.data;
  const R = remote.data;
  const settings = (remote.settings.updatedAt || 0) > (local.settings.updatedAt || 0) ? remote.settings : local.settings;

  const logs = {};
  for (const date of new Set([...Object.keys(L.logs), ...Object.keys(R.logs)])) {
    const byId = new Map();
    for (const e of [...(L.logs[date] || []), ...(R.logs[date] || [])]) if (!byId.has(e.id)) byId.set(e.id, e);
    logs[date] = [...byId.values()].sort((a, b) => (a.time === b.time ? (a.id < b.id ? -1 : 1) : a.time < b.time ? -1 : 1));
  }

  let streak;
  let lastStreakDate;
  if (L.lastStreakDate === R.lastStreakDate) {
    streak = Math.max(L.streak, R.streak);
    lastStreakDate = L.lastStreakDate;
  } else if ((R.lastStreakDate || "") > (L.lastStreakDate || "")) {
    streak = R.streak;
    lastStreakDate = R.lastStreakDate;
  } else {
    streak = L.streak;
    lastStreakDate = L.lastStreakDate;
  }

  const emblems = [...new Set([...L.emblems, ...R.emblems])].sort();
  const emblemCounts = {};
  for (const id of emblems) emblemCounts[id] = Math.max(L.emblemCounts[id] || 1, R.emblemCounts[id] || 1);

  return {
    v: 1,
    resetAt: lr,
    settings,
    data: {
      logs,
      goalHit: { ...L.goalHit, ...R.goalHit },
      emblemCounts,
      xp: Math.max(L.xp, R.xp),
      streak,
      bestStreak: Math.max(L.bestStreak, R.bestStreak),
      lastStreakDate,
      earlyLogs: Math.max(L.earlyLogs, R.earlyLogs),
      nightLogs: Math.max(L.nightLogs, R.nightLogs),
      overGoalDays: Math.max(L.overGoalDays, R.overGoalDays),
      unlockedBadges: [...new Set([...L.unlockedBadges, ...R.unlockedBadges])].sort(),
      emblems,
      streakMilestones: [...new Set([...L.streakMilestones, ...R.streakMilestones])].sort((a, b) => a - b),
      giftIn: [...new Set([...L.giftIn, ...R.giftIn])].sort(),
      giftOut: [...new Set([...L.giftOut, ...R.giftOut])].sort(),
    },
  };
}

// forma canônica (ordenada), para comparar estados sem falsos "diferentes"
function canonSyncState(s) {
  return mergeSyncStates(s, s);
}

function applySyncState(state) {
  const d = currentData;
  const p = currentProfile;
  const s = state.settings;
  const before = [p.wake, p.sleep, p.interval, p.safetyHours].join("|");
  d.resetAt = state.resetAt;
  Object.assign(d, {
    logs: state.data.logs,
    goalHit: state.data.goalHit,
    emblemCounts: state.data.emblemCounts,
    xp: state.data.xp,
    streak: state.data.streak,
    bestStreak: state.data.bestStreak,
    lastStreakDate: state.data.lastStreakDate,
    earlyLogs: state.data.earlyLogs,
    nightLogs: state.data.nightLogs,
    overGoalDays: state.data.overGoalDays,
    unlockedBadges: state.data.unlockedBadges,
    emblems: state.data.emblems,
    streakMilestones: state.data.streakMilestones,
    giftIn: state.data.giftIn,
    giftOut: state.data.giftOut,
  });
  Object.assign(p, {
    weightKg: s.weightKg,
    activity: s.activity,
    hot: s.hot,
    wake: s.wake,
    sleep: s.sleep,
    interval: s.interval,
    safetyHours: s.safetyHours,
    streakMinPct: s.streakMinPct,
    goalOverride: s.goalOverride,
    settingsUpdatedAt: s.updatedAt,
  });
  recomputeStreak();
  saveData();
  saveProfiles();
  return before !== [p.wake, p.sleep, p.interval, p.safetyHours].join("|");
}

// ---------- rede ----------
async function apiSync(method, body) {
  const session = getSession(currentEmail);
  if (!session) throw Object.assign(new Error("sem sessao"), { code: "unauthorized" });
  const resp = await fetch(syncBase() + "/sync", {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (resp.status === 401) {
    clearSession(currentEmail);
    throw Object.assign(new Error("sessao expirada"), { code: "unauthorized" });
  }
  return resp;
}

async function syncNow(opts) {
  const manual = !!(opts && opts.manual);
  if (!currentProfile || !syncAvailable() || !syncEnabledFor(currentProfile)) {
    updateSyncUI();
    return false;
  }
  if (!getSession(currentEmail)) {
    lastSyncError = "Sem sessão na nuvem. Toque em \"Trocar de perfil\" e entre de novo com o Google.";
    updateSyncUI();
    return false;
  }
  if (syncInFlight) {
    syncQueued = true;
    return false;
  }
  syncInFlight = true;
  lastSyncError = null;
  updateSyncUI();
  const email = currentEmail;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const getResp = await apiSync("GET");
      if (!getResp.ok) throw new Error("GET " + getResp.status);
      const remoteRes = await getResp.json();
      if (currentEmail !== email) return false;

      const local = localSyncState();
      let target = local;
      let remoteCanon = null;
      if (remoteRes.blob) {
        const remote = sanitizeBlob(remoteRes.blob);
        if (remote) {
          remoteCanon = canonSyncState(remote);
          target = mergeSyncStates(local, remote);
        }
      }
      const targetCanon = canonSyncState(target);
      const localChanged = stableStringify(canonSyncState(local)) !== stableStringify(targetCanon);
      const settingsChanged = applySyncState(target);

      if (!remoteCanon || stableStringify(targetCanon) !== stableStringify(remoteCanon)) {
        const put = await apiSync("PUT", { baseVersion: remoteRes.version, blob: targetCanon });
        if (put.status === 409) continue;
        if (!put.ok) throw new Error("PUT " + put.status);
      }
      lastSyncAt = Date.now();
      if (localChanged) {
        refreshAfterSync(settingsChanged);
        showToast("☁️ Dados atualizados com a nuvem");
      }
      return true;
    }
    throw new Error("conflitos repetidos");
  } catch (e) {
    lastSyncError = e.code === "unauthorized" ? "Sua sessão expirou. Toque em \"Trocar de perfil\" e entre de novo com o Google." : "Não foi possível sincronizar agora.";
    return false;
  } finally {
    syncInFlight = false;
    updateSyncUI();
    if (syncQueued) {
      syncQueued = false;
      scheduleSync(1500);
    }
  }
}

function scheduleSync(delay) {
  if (!currentProfile || !syncEnabledFor(currentProfile) || !syncAvailable() || !getSession(currentEmail)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), delay === undefined ? SYNC_DEBOUNCE_MS : delay);
}

function refreshAfterSync(settingsChanged) {
  renderToday();
  renderProgress();
  renderAlbum();
  if (typeof scheduleGroupSnapshot === "function") scheduleGroupSnapshot();
  if (settingsChanged) {
    fillProfileForm();
    syncPushSubscription({ silent: true });
  }
}

// ---------- interface ----------
function updateSyncUI() {
  const statusEl = document.getElementById("sync-status");
  if (!statusEl || !currentProfile) return;
  const nowBtn = document.getElementById("btn-sync-now");
  const delBtn = document.getElementById("btn-sync-delete");
  const isGoogle = currentProfile.authProvider === "google";
  nowBtn.classList.toggle("hidden", !isGoogle);
  delBtn.classList.toggle("hidden", !isGoogle);
  if (!isGoogle) {
    statusEl.textContent = "Conta local: seus dados ficam só neste aparelho. Entre com o Google para sincronizar entre aparelhos.";
    return;
  }
  if (currentProfile.cloudSync !== true) {
    statusEl.textContent = currentProfile.cloudSync === false
      ? "Sincronização desativada. Seus dados ficam só neste aparelho."
      : "Sincronização ainda não ativada. Seus dados ficam só neste aparelho.";
    nowBtn.textContent = "☁️ Ativar sincronização";
    return;
  }
  nowBtn.textContent = "🔄 Sincronizar agora";
  if (syncInFlight) statusEl.textContent = "Sincronizando...";
  else if (lastSyncError) statusEl.textContent = "⚠️ " + lastSyncError;
  else if (lastSyncAt) statusEl.textContent = "✅ Sincronizado às " + new Date(lastSyncAt).toTimeString().slice(0, 5);
  else statusEl.textContent = getSession(currentEmail) ? "Aguardando a primeira sincronização..." : "Sem sessão na nuvem. Entre de novo com o Google.";
}

document.addEventListener("DOMContentLoaded", () => {
  const nowBtn = document.getElementById("btn-sync-now");
  const delBtn = document.getElementById("btn-sync-delete");
  if (!nowBtn || !delBtn) return;

  nowBtn.addEventListener("click", async () => {
    if (currentProfile.cloudSync !== true) {
      askCloudConsent();
      return;
    }
    showToast("🔄 Sincronizando...");
    const ok = await syncNow({ manual: true });
    showToast(ok ? "☁️ Sincronizado!" : "⚠️ " + (lastSyncError || "Não foi possível sincronizar."));
  });

  delBtn.addEventListener("click", async () => {
    if (!confirm("Apagar seus dados da nuvem? Isso também tira você do grupo, se estiver em um. Os dados deste aparelho continuam, mas a sincronização será desativada até você ativar de novo.")) return;
    try {
      const resp = await apiSync("DELETE");
      if (!resp.ok) throw new Error("DELETE " + resp.status);
    } catch {
      showToast("⚠️ Não consegui apagar agora. Tente de novo em instantes.");
      return;
    }
    currentProfile.cloudSync = false;
    saveProfiles();
    lastSyncAt = 0;
    updateSyncUI();
    if (typeof groupAfterCloudDelete === "function") groupAfterCloudDelete();
    showToast("🗑️ Dados da nuvem apagados.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastSyncAt > SYNC_VISIBLE_GAP_MS) syncNow();
  });
});
