/* Hidrata — app local (sem servidor). Dados ficam em localStorage neste aparelho/navegador. */

const ACTIVITY_BONUS = { sedentary: 0, light: 300, moderate: 500, intense: 800 };
const HOT_BONUS = 350;

const LEVELS = [
  { xp: 0, name: "Gotinha" },
  { xp: 200, name: "Aprendiz da Água" },
  { xp: 500, name: "Hidratado" },
  { xp: 1000, name: "Guerreiro da Hidratação" },
  { xp: 2000, name: "Mestre das Águas" },
  { xp: 4000, name: "Lenda Aquática" },
];

const RARITY_ORDER = ["comum", "raro", "epico", "lendario"];
const RARITY_WEIGHTS = { comum: 60, raro: 25, epico: 12, lendario: 3 };
const RARITY_LABELS = { comum: "Comum", raro: "Raro", epico: "Épico", lendario: "Lendário" };

const EMBLEMS = [
  { id: "gota", emoji: "💧", label: "Gota", rarity: "comum" },
  { id: "nuvem", emoji: "☁️", label: "Nuvem", rarity: "comum" },
  { id: "copo", emoji: "🥛", label: "Copo", rarity: "comum" },
  { id: "folha", emoji: "🍃", label: "Folha", rarity: "comum" },
  { id: "bolha", emoji: "🫧", label: "Bolha", rarity: "comum" },
  { id: "chuva", emoji: "🌧️", label: "Chuva", rarity: "comum" },
  { id: "onda", emoji: "🌊", label: "Onda", rarity: "raro" },
  { id: "concha", emoji: "🐚", label: "Concha", rarity: "raro" },
  { id: "peixinho", emoji: "🐠", label: "Peixinho", rarity: "raro" },
  { id: "arcoiris", emoji: "🌈", label: "Arco-íris", rarity: "raro" },
  { id: "cacto", emoji: "🌵", label: "Cacto Hidratado", rarity: "raro" },
  { id: "lua", emoji: "🌙", label: "Lua", rarity: "raro" },
  { id: "cachoeira", emoji: "⛲", label: "Cachoeira", rarity: "epico" },
  { id: "golfinho", emoji: "🐬", label: "Golfinho", rarity: "epico" },
  { id: "tartaruga", emoji: "🐢", label: "Tartaruga Marinha", rarity: "epico" },
  { id: "estrelamar", emoji: "⭐", label: "Estrela do Mar", rarity: "epico" },
  { id: "iceberg", emoji: "🧊", label: "Iceberg", rarity: "epico" },
  { id: "sereia", emoji: "🧜‍♀️", label: "Sereia", rarity: "lendario" },
  { id: "tridente", emoji: "🔱", label: "Tridente de Poseidon", rarity: "lendario" },
  { id: "baleia", emoji: "🐋", label: "Baleia Mística", rarity: "lendario" },
  { id: "dragao", emoji: "🐉", label: "Dragão das Águas", rarity: "lendario" },
];

const STREAK_MILESTONES = [
  { n: 3, minRarity: "raro" },
  { n: 7, minRarity: "raro" },
  { n: 14, minRarity: "epico" },
  { n: 30, minRarity: "epico" },
  { n: 60, minRarity: "lendario" },
  { n: 100, minRarity: "lendario" },
];

function dayHasAllSizes(dayLogs) {
  const set = new Set(dayLogs.map((e) => e.ml));
  return set.has(150) && set.has(250) && set.has(500);
}

const BADGES = [
  { id: "first_drop", emoji: "💧", label: "Primeira Gota", check: (d) => totalEntries(d) >= 1 },
  { id: "goal_day", emoji: "🎯", label: "Meta Batida", check: (d) => Object.values(d.goalHit || {}).some(Boolean) },
  { id: "goal5", emoji: "📅", label: "5 Dias de Meta", check: (d) => Object.values(d.goalHit || {}).filter(Boolean).length >= 5 },
  { id: "goal14", emoji: "🗓️", label: "Hábito Formado (14 dias de meta)", check: (d) => Object.values(d.goalHit || {}).filter(Boolean).length >= 14 },
  { id: "streak3", emoji: "🔥", label: "3 Dias Seguidos", check: (d) => d.streak >= 3 || d.bestStreak >= 3 },
  { id: "streak7", emoji: "🏆", label: "7 Dias Seguidos", check: (d) => d.streak >= 7 || d.bestStreak >= 7 },
  { id: "streak30", emoji: "👑", label: "30 Dias — Lenda", check: (d) => d.streak >= 30 || d.bestStreak >= 30 },
  { id: "streak60", emoji: "🌟", label: "60 Dias sem Falhar", check: (d) => d.streak >= 60 || d.bestStreak >= 60 },
  { id: "streak100", emoji: "🐋", label: "100 Dias — Imparável", check: (d) => d.streak >= 100 || d.bestStreak >= 100 },
  { id: "early_bird", emoji: "🌅", label: "Madrugador", check: (d) => (d.earlyLogs || 0) >= 1 },
  { id: "night_owl", emoji: "🌙", label: "Coruja Noturna", check: (d) => (d.nightLogs || 0) >= 1 },
  { id: "overachiever", emoji: "🚀", label: "Além da Meta", check: (d) => (d.overGoalDays || 0) >= 1 },
  { id: "big_gulp", emoji: "🥤", label: "Gole Grande (750ml de uma vez)", check: (d) => Object.values(d.logs).some((arr) => arr.some((e) => e.ml >= 750)) },
  { id: "variety", emoji: "🎨", label: "Combo Completo", check: (d) => Object.values(d.logs).some(dayHasAllSizes) },
  { id: "hundred", emoji: "💯", label: "100 Copos Registrados", check: (d) => totalEntries(d) >= 100 },
  { id: "xp1000", emoji: "⭐", label: "1000 XP", check: (d) => d.xp >= 1000 },
  { id: "album_starter", emoji: "🖼️", label: "Comecei a Colecionar", check: (d) => (d.emblems || []).length >= 1 },
  { id: "album_half", emoji: "📚", label: "Metade do Álbum", check: (d) => (d.emblems || []).length >= Math.ceil(EMBLEMS.length / 2) },
  { id: "album_complete", emoji: "🏅", label: "Álbum Completo", check: (d) => (d.emblems || []).length >= EMBLEMS.length },
];

// ---------- estado global em memória ----------
let profiles = [];
let currentEmail = null;
let currentProfile = null;
let currentData = null;
let reminderTimer = null;

// ---------- utilidades de data ----------
function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
function nowHM() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
}
function hmToMinutes(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHM(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------- persistência ----------
function loadProfiles() {
  try { profiles = JSON.parse(localStorage.getItem("hidrata_profiles") || "[]"); }
  catch { profiles = []; }
}
function saveProfiles() {
  localStorage.setItem("hidrata_profiles", JSON.stringify(profiles));
}
function loadData(email) {
  let data;
  try { data = JSON.parse(localStorage.getItem("hidrata_data_" + email) || "null"); }
  catch { data = null; }
  if (!data) {
    data = { logs: {}, xp: 0, streak: 0, bestStreak: 0, lastStreakDate: null, goalHit: {}, notified: {}, earlyLogs: 0, nightLogs: 0, overGoalDays: 0, unlockedBadges: [], emblems: [], emblemCounts: {}, streakMilestones: [] };
  }
  data.logs = data.logs || {};
  data.goalHit = data.goalHit || {};
  data.notified = data.notified || {};
  data.unlockedBadges = data.unlockedBadges || [];
  data.emblems = data.emblems || [];
  data.emblemCounts = data.emblemCounts || {};
  data.streakMilestones = data.streakMilestones || [];
  return data;
}
function saveData() {
  if (!currentEmail) return;
  localStorage.setItem("hidrata_data_" + currentEmail, JSON.stringify(currentData));
}

// ---------- cálculo de meta ----------
function calcGoal(profile) {
  if (profile.goalOverride) return profile.goalOverride;
  let ml = (profile.weightKg || 70) * 35;
  ml += ACTIVITY_BONUS[profile.activity] || 0;
  if (profile.hot) ml += HOT_BONUS;
  ml = Math.round(ml / 50) * 50;
  return Math.max(1200, Math.min(6000, ml));
}

function totalEntries(d) {
  return Object.values(d.logs).reduce((sum, arr) => sum + arr.length, 0);
}
function getDayTotal(d, dateKey) {
  return (d.logs[dateKey] || []).reduce((s, e) => s + e.ml, 0);
}

// ---------- lembretes ----------
function computeReminderTimes(profile) {
  const start = hmToMinutes(profile.wake || "07:00");
  let end = hmToMinutes(profile.sleep || "23:00");
  if (end <= start) end += 1440;
  const step = Number(profile.interval) || 90;
  const times = [];
  for (let t = start; t <= end; t += step) times.push(minutesToHM(t));
  return times;
}

function nextReminderLabel() {
  const times = computeReminderTimes(currentProfile);
  const nowMin = hmToMinutes(nowHM());
  const upcoming = times.find((t) => hmToMinutes(t) >= nowMin);
  return upcoming || times[0] || "--:--";
}

function checkReminders() {
  if (!currentProfile || !currentData) return;
  const date = todayStr();
  const times = computeReminderTimes(currentProfile);
  const nowMin = hmToMinutes(nowHM());
  currentData.notified[date] = currentData.notified[date] || [];

  if (currentData._reminderBaseline !== date) {
    // Primeira checagem do dia (ex: acabou de abrir o app): marca como
    // "vistos" todos os horários que já passaram, sem notificar em rajada.
    // Só os horários que vencerem dali pra frente, com o app aberto, disparam notificação de verdade.
    times.forEach((t) => {
      if (hmToMinutes(t) <= nowMin && !currentData.notified[date].includes(t)) {
        currentData.notified[date].push(t);
      }
    });
    currentData._reminderBaseline = date;
    saveData();
  } else {
    for (const t of times) {
      if (hmToMinutes(t) <= nowMin && !currentData.notified[date].includes(t)) {
        currentData.notified[date].push(t);
        saveData();
        fireNotification();
        break; // um por vez é suficiente
      }
    }
  }
  const nextEl = document.getElementById("next-reminder");
  if (nextEl) nextEl.textContent = nextReminderLabel();
}

function fireNotification() {
  showToast("💧 Hora de beber água!");
  if (window.Notification && Notification.permission === "granted") {
    const body = "Você já bebeu " + getDayTotal(currentData, todayStr()) + "ml hoje. Bora completar a meta!";
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification("Hidrata 💧", { body, icon: "icon.svg", badge: "icon.svg", vibrate: [80, 40, 80] });
      });
    } else {
      new Notification("Hidrata 💧", { body, icon: "icon.svg" });
    }
  }
}

// ---------- gamificação ----------
function levelInfo(xp) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i].xp) idx = i;
  const cur = LEVELS[idx];
  const nextLvl = LEVELS[idx + 1];
  return { num: idx + 1, name: cur.name, next: nextLvl };
}

function registerGoalProgress(goal) {
  const date = todayStr();
  const total = getDayTotal(currentData, date);
  const alreadyHit = !!currentData.goalHit[date];
  let justHit = false;
  if (total >= goal && !alreadyHit) {
    currentData.goalHit[date] = true;
    currentData.xp += 50;
    justHit = true;
    // streak
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    if (currentData.lastStreakDate === yesterday) currentData.streak += 1;
    else if (currentData.lastStreakDate !== date) currentData.streak = 1;
    currentData.lastStreakDate = date;
    currentData.bestStreak = Math.max(currentData.bestStreak || 0, currentData.streak);
    showToast("🎉 Meta do dia batida! +50 XP");
  }
  if (total >= goal * 1.5 && !currentData._overFlagged) {
    currentData.overGoalDays = (currentData.overGoalDays || 0) + 1;
  }
  return justHit;
}

// ---------- emblemas (sorteio aleatório + álbum) ----------
function pickRarity(minRarity) {
  const minIdx = minRarity ? RARITY_ORDER.indexOf(minRarity) : 0;
  const pool = RARITY_ORDER.slice(minIdx);
  const total = pool.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
  let roll = Math.random() * total;
  for (const r of pool) {
    if (roll < RARITY_WEIGHTS[r]) return r;
    roll -= RARITY_WEIGHTS[r];
  }
  return pool[pool.length - 1];
}

function rollEmblem(minRarity) {
  const rarity = pickRarity(minRarity);
  const candidates = EMBLEMS.filter((e) => e.rarity === rarity);
  const unowned = candidates.filter((e) => !currentData.emblems.includes(e.id));
  let emblem, isNew;
  if (unowned.length > 0) {
    emblem = unowned[Math.floor(Math.random() * unowned.length)];
    currentData.emblems.push(emblem.id);
    currentData.emblemCounts[emblem.id] = 1;
    isNew = true;
  } else {
    emblem = candidates[Math.floor(Math.random() * candidates.length)];
    currentData.emblemCounts[emblem.id] = (currentData.emblemCounts[emblem.id] || 1) + 1;
    currentData.xp += 5;
    isNew = false;
  }
  return { emblem, isNew };
}

function grantEmblemWithToast(minRarity) {
  const { emblem, isNew } = rollEmblem(minRarity);
  if (isNew) showToast(`🎖️ Novo emblema: ${emblem.label} (${RARITY_LABELS[emblem.rarity]})`);
  else showToast(`🔁 Emblema repetido: ${emblem.label} (+5 XP)`);
  return emblem;
}

function checkStreakMilestones() {
  for (const m of STREAK_MILESTONES) {
    if (currentData.streak >= m.n && !currentData.streakMilestones.includes(m.n)) {
      currentData.streakMilestones.push(m.n);
      grantEmblemWithToast(m.minRarity);
    }
  }
}

function checkBadges() {
  const newly = [];
  for (const b of BADGES) {
    if (!currentData.unlockedBadges.includes(b.id) && b.check(currentData)) {
      currentData.unlockedBadges.push(b.id);
      newly.push(b);
    }
  }
  if (newly.length) {
    showToast("🏅 Nova conquista: " + newly.map((b) => b.label).join(", "));
  }
}

// ---------- ações ----------
function addWater(ml) {
  const date = todayStr();
  const time = nowHM();
  currentData.logs[date] = currentData.logs[date] || [];
  currentData.logs[date].push({ time, ml });
  currentData.xp += 10;
  if (hmToMinutes(time) < hmToMinutes("08:00")) currentData.earlyLogs = (currentData.earlyLogs || 0) + 1;
  if (hmToMinutes(time) >= hmToMinutes("22:00")) currentData.nightLogs = (currentData.nightLogs || 0) + 1;

  const goal = calcGoal(currentProfile);
  const justHitGoal = registerGoalProgress(goal);
  checkStreakMilestones();

  if (Math.random() < 0.35) grantEmblemWithToast();
  if (justHitGoal) grantEmblemWithToast();

  checkBadges();
  saveData();
  renderToday();
  renderProgress();
  renderAlbum();
}

// ---------- render ----------
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function renderAuthScreen() {
  loadProfiles();
  const list = document.getElementById("profile-list");
  list.innerHTML = "";
  if (profiles.length === 0) {
    document.getElementById("profile-block").classList.add("hidden");
    document.getElementById("form-create").classList.remove("hidden");
  } else {
    document.getElementById("profile-block").classList.remove("hidden");
    document.getElementById("form-create").classList.add("hidden");
    profiles.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "profile-chip";
      const avatarHtml = p.picture
        ? `<img class="avatar" src="${escapeHtml(p.picture)}" alt="" />`
        : `<span class="drop">💧</span>`;
      chip.innerHTML = `<div class="chip-info">${avatarHtml}<div><div class="name">${escapeHtml(p.name)}</div><div class="email">${escapeHtml(p.email)}</div></div></div><div>➜</div>`;
      chip.addEventListener("click", () => login(p.email));
      list.appendChild(chip);
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function login(email) {
  const p = profiles.find((x) => x.email === email);
  if (!p) return;
  currentEmail = email;
  currentProfile = p;
  currentData = loadData(email);
  localStorage.setItem("hidrata_current", email);
  saveData();
  document.getElementById("screen-auth").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("hidden");
  document.getElementById("user-name").textContent = p.name.split(" ")[0];
  const avatarEl = document.getElementById("user-avatar");
  if (p.picture) {
    avatarEl.src = p.picture;
    avatarEl.classList.remove("hidden");
  } else {
    avatarEl.classList.add("hidden");
  }
  fillProfileForm();
  renderToday();
  renderProgress();
  renderAlbum();
  startReminderLoop();
}

function logout() {
  stopReminderLoop();
  currentEmail = null;
  currentProfile = null;
  currentData = null;
  localStorage.removeItem("hidrata_current");
  document.getElementById("screen-app").classList.add("hidden");
  document.getElementById("screen-auth").classList.remove("hidden");
  renderAuthScreen();
}

function renderToday() {
  if (!currentProfile) return;
  const date = todayStr();
  const goal = calcGoal(currentProfile);
  const total = getDayTotal(currentData, date);
  const pct = Math.min(1, total / goal);

  document.getElementById("today-ml").textContent = total;
  document.getElementById("today-goal").textContent = goal;
  document.getElementById("today-pct").textContent = Math.round(pct * 100) + "%";

  const circumference = 2 * Math.PI * 88;
  const ring = document.getElementById("ring-fg");
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - pct));

  document.getElementById("streak-num").textContent = currentData.streak || 0;
  document.getElementById("xp-num").textContent = currentData.xp || 0;
  document.getElementById("next-reminder").textContent = nextReminderLabel();

  const lvl = levelInfo(currentData.xp || 0);
  document.getElementById("level-name").textContent = lvl.name;
  document.getElementById("level-num").textContent = lvl.num;

  const notifBtn = document.getElementById("btn-enable-notif");
  if (window.Notification && Notification.permission === "granted") {
    notifBtn.textContent = "🔔 Notificações ativadas";
    notifBtn.disabled = true;
  }
}

function renderProgress() {
  const chart = document.getElementById("week-chart");
  chart.innerHTML = "";
  const goal = calcGoal(currentProfile);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push({ key, label: d.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3), total: getDayTotal(currentData, key) });
  }
  const maxVal = Math.max(goal, ...days.map((d) => d.total), 1);
  days.forEach((d) => {
    const col = document.createElement("div");
    col.className = "chart-col";
    const bar = document.createElement("div");
    bar.className = "chart-bar" + (d.total >= goal ? " hit" : "");
    bar.style.height = Math.max(3, (d.total / maxVal) * 100) + "%";
    const label = document.createElement("div");
    label.className = "chart-day";
    label.textContent = d.label;
    col.appendChild(bar);
    col.appendChild(label);
    chart.appendChild(col);
  });

  const grid = document.getElementById("badges-grid");
  grid.innerHTML = "";
  BADGES.forEach((b) => {
    const unlocked = currentData.unlockedBadges.includes(b.id);
    const el = document.createElement("div");
    el.className = "badge" + (unlocked ? " unlocked" : "");
    el.innerHTML = `<span class="emoji">${b.emoji}</span><div class="label">${b.label}</div>`;
    grid.appendChild(el);
  });
}

function renderAlbum() {
  const grid = document.getElementById("album-grid");
  grid.innerHTML = "";
  EMBLEMS.forEach((e) => {
    const owned = currentData.emblems.includes(e.id);
    const count = currentData.emblemCounts[e.id] || 0;
    const el = document.createElement("div");
    el.className = `emblem rarity-${e.rarity}` + (owned ? " owned" : "");
    el.innerHTML = `
      ${owned && count > 1 ? `<div class="count">x${count}</div>` : ""}
      <span class="emoji">${e.emoji}</span>
      <div class="label">${owned ? e.label : "???"}</div>
      <div class="rarity-tag">${RARITY_LABELS[e.rarity]}</div>
    `;
    grid.appendChild(el);
  });
  document.getElementById("album-count").textContent = currentData.emblems.length;
  document.getElementById("album-total").textContent = EMBLEMS.length;
  const pct = Math.round((currentData.emblems.length / EMBLEMS.length) * 100);
  document.getElementById("album-progress-fill").style.width = pct + "%";
}

function fillProfileForm() {
  document.getElementById("p-name").value = currentProfile.name;
  document.getElementById("p-weight").value = currentProfile.weightKg;
  document.getElementById("p-activity").value = currentProfile.activity;
  document.getElementById("p-hot").checked = !!currentProfile.hot;
  document.getElementById("p-wake").value = currentProfile.wake;
  document.getElementById("p-sleep").value = currentProfile.sleep;
  document.getElementById("p-interval").value = String(currentProfile.interval);
  document.getElementById("p-goal-override").value = currentProfile.goalOverride || "";
}

// ---------- lembrete: loop ----------
function startReminderLoop() {
  checkReminders();
  stopReminderLoop();
  reminderTimer = setInterval(checkReminders, 20000);
}
function stopReminderLoop() {
  if (reminderTimer) clearInterval(reminderTimer);
  reminderTimer = null;
}

// ---------- login com Google ----------
function decodeJwt(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(json);
}

function handleGoogleCredential(response) {
  let payload;
  try {
    payload = decodeJwt(response.credential);
  } catch {
    alert("Não foi possível ler os dados do Google. Tente novamente.");
    return;
  }
  const email = (payload.email || "").toLowerCase();
  if (!email) return;

  loadProfiles();
  let profile = profiles.find((p) => p.email === email);
  if (!profile) {
    profile = {
      email,
      name: payload.name || email.split("@")[0],
      picture: payload.picture || null,
      authProvider: "google",
      weightKg: 70,
      activity: "light",
      hot: false,
      wake: "07:00",
      sleep: "23:00",
      interval: 90,
      goalOverride: null,
      createdAt: Date.now(),
    };
    profiles.push(profile);
    saveProfiles();
    login(email);
    showToast("Conta criada com Google! Ajuste seu peso e atividade em Perfil.");
  } else {
    // mantém dados locais já configurados, só atualiza nome/foto vindos do Google
    profile.name = payload.name || profile.name;
    profile.picture = payload.picture || profile.picture;
    const idx = profiles.findIndex((p) => p.email === email);
    profiles[idx] = profile;
    saveProfiles();
    login(email);
  }
}

function tryInitGoogleSignIn(attempts) {
  attempts = attempts || 0;
  if (window.google && window.google.accounts) {
    initGoogleSignIn();
  } else if (attempts < 40) {
    setTimeout(() => tryInitGoogleSignIn(attempts + 1), 150);
  }
}

function initGoogleSignIn() {
  const configured = typeof GOOGLE_CLIENT_ID === "string" && GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith("COLE_SEU_CLIENT_ID");
  if (!configured || !window.google || !window.google.accounts) return;
  document.getElementById("google-signin-section").classList.remove("hidden");
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
  });
  google.accounts.id.renderButton(document.getElementById("google-signin-btn"), {
    theme: "filled_black",
    size: "large",
    shape: "pill",
    text: "continue_with",
    locale: "pt-BR",
  });
}

// ---------- eventos ----------
document.addEventListener("DOMContentLoaded", () => {
  loadProfiles();
  const savedCurrent = localStorage.getItem("hidrata_current");
  if (savedCurrent && profiles.find((p) => p.email === savedCurrent)) {
    login(savedCurrent);
  } else {
    renderAuthScreen();
  }

  tryInitGoogleSignIn();

  document.getElementById("btn-goto-create").addEventListener("click", () => {
    document.getElementById("profile-block").classList.add("hidden");
    document.getElementById("form-create").classList.remove("hidden");
  });
  document.getElementById("btn-goto-login").addEventListener("click", () => {
    renderAuthScreen();
  });

  document.getElementById("form-create").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("c-email").value.trim().toLowerCase();
    if (profiles.find((p) => p.email === email)) {
      alert("Já existe um perfil com esse e-mail neste aparelho. Escolha-o na lista para entrar.");
      return;
    }
    const profile = {
      email,
      name: document.getElementById("c-name").value.trim(),
      weightKg: Number(document.getElementById("c-weight").value),
      activity: document.getElementById("c-activity").value,
      hot: document.getElementById("c-hot").checked,
      wake: document.getElementById("c-wake").value,
      sleep: document.getElementById("c-sleep").value,
      interval: Number(document.getElementById("c-interval").value),
      goalOverride: null,
      createdAt: Date.now(),
    };
    profiles.push(profile);
    saveProfiles();
    login(email);
  });

  document.getElementById("btn-logout").addEventListener("click", logout);

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  document.querySelectorAll(".qa-btn[data-ml]").forEach((btn) => {
    btn.addEventListener("click", () => addWater(Number(btn.dataset.ml)));
  });
  document.getElementById("btn-custom").addEventListener("click", () => {
    const v = prompt("Quantos ml você bebeu?", "200");
    const n = Number(v);
    if (n > 0 && n < 5000) addWater(Math.round(n));
  });

  document.getElementById("btn-enable-notif").addEventListener("click", async () => {
    if (!window.Notification) {
      alert("Este navegador não suporta notificações.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      showToast("Notificações ativadas! 🔔");
      renderToday();
      fireNotification();
    }
  });

  document.getElementById("form-profile").addEventListener("submit", (e) => {
    e.preventDefault();
    currentProfile.name = document.getElementById("p-name").value.trim();
    currentProfile.weightKg = Number(document.getElementById("p-weight").value);
    currentProfile.activity = document.getElementById("p-activity").value;
    currentProfile.hot = document.getElementById("p-hot").checked;
    currentProfile.wake = document.getElementById("p-wake").value;
    currentProfile.sleep = document.getElementById("p-sleep").value;
    currentProfile.interval = Number(document.getElementById("p-interval").value);
    const override = document.getElementById("p-goal-override").value;
    currentProfile.goalOverride = override ? Number(override) : null;
    const idx = profiles.findIndex((p) => p.email === currentProfile.email);
    profiles[idx] = currentProfile;
    saveProfiles();
    document.getElementById("user-name").textContent = currentProfile.name.split(" ")[0];
    showToast("Perfil salvo!");
    renderToday();
  });

  document.getElementById("btn-reset-data").addEventListener("click", () => {
    if (confirm("Isso vai apagar todo o histórico e XP deste perfil. Continuar?")) {
      localStorage.removeItem("hidrata_data_" + currentEmail);
      currentData = loadData(currentEmail);
      saveData();
      renderToday();
      renderProgress();
      renderAlbum();
      showToast("Dados apagados.");
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
