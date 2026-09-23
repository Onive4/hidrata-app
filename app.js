/* Hidrata — app local (sem servidor). Dados ficam em localStorage neste aparelho/navegador. */

// Anti-clickjacking: o GitHub Pages não permite cabeçalho X-Frame-Options, então o app
// se recusa a rodar quando outro site tenta exibi-lo dentro de uma moldura (iframe).
if (window.top !== window.self && location.hostname !== "localhost") {
  document.documentElement.textContent = "";
  throw new Error("Hidrata não pode ser exibido dentro de outro site.");
}

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
  // comuns
  { id: "gota", emoji: "💧", label: "Gota", rarity: "comum", desc: "A mais básica de todas. Toda coleção começa aqui." },
  { id: "nuvem", emoji: "☁️", label: "Nuvem", rarity: "comum", desc: "Flutuando por aí, cheia de chuva guardada." },
  { id: "copo", emoji: "🥛", label: "Copo", rarity: "comum", desc: "Companheiro fiel de todo copo d'água." },
  { id: "folha", emoji: "🍃", label: "Folha", rarity: "comum", desc: "Carrega orvalho toda manhã." },
  { id: "bolha", emoji: "🫧", alt: "🔵", label: "Bolha", rarity: "comum", desc: "Sobe, sobe, sobe... e estoura." },
  { id: "chuva", emoji: "🌧️", label: "Chuva", rarity: "comum", desc: "Molhando tudo desde sempre." },
  { id: "poca", emoji: "💦", label: "Poça", rarity: "comum", desc: "Pisou e já era o tênis." },
  { id: "torneira", emoji: "🚰", label: "Torneira", rarity: "comum", desc: "A fonte mais próxima de água de verdade." },
  { id: "guardachuva", emoji: "☂️", label: "Guarda-chuva", rarity: "comum", desc: "Proteção contra a própria água." },
  { id: "redemoinho", emoji: "🌀", label: "Redemoinho", rarity: "comum", desc: "Gira, gira e some no ralo." },
  { id: "sabonete", emoji: "🧼", label: "Sabonete", rarity: "comum", desc: "Só funciona direito com água por perto." },
  { id: "balde", emoji: "🪣", alt: "🛢️", label: "Balde", rarity: "comum", desc: "Sempre pronto pra carregar mais água." },
  // raros
  { id: "onda", emoji: "🌊", label: "Onda", rarity: "raro", desc: "Vem de longe e quebra na praia." },
  { id: "concha", emoji: "🐚", label: "Concha", rarity: "raro", desc: "Encoste no ouvido e escute o mar." },
  { id: "peixinho", emoji: "🐠", label: "Peixinho", rarity: "raro", desc: "Vive 100% hidratado, o tempo todo." },
  { id: "arcoiris", emoji: "🌈", label: "Arco-íris", rarity: "raro", desc: "Só aparece depois da chuva." },
  { id: "cacto", emoji: "🌵", label: "Cacto Hidratado", rarity: "raro", desc: "Até quem guarda água merece um gole." },
  { id: "lua", emoji: "🌙", label: "Lua", rarity: "raro", desc: "Comanda as marés lá de cima." },
  { id: "praia", emoji: "🏖️", label: "Praia", rarity: "raro", desc: "Onde a água encontra a areia." },
  { id: "barco", emoji: "⛵", label: "Barco a Vela", rarity: "raro", desc: "Navegando tranquilo, vento e água a favor." },
  { id: "sol", emoji: "☀️", label: "Sol", rarity: "raro", desc: "Evapora a água pra chover de novo depois." },
  { id: "pinguim", emoji: "🐧", label: "Pinguim", rarity: "raro", desc: "Nada bem melhor do que anda." },
  { id: "foca", emoji: "🦭", alt: "🐟", label: "Foca", rarity: "raro", desc: "Mestra em mergulhos rápidos." },
  { id: "caranguejo", emoji: "🦀", label: "Caranguejo", rarity: "raro", desc: "Anda de lado, mas sempre perto da água." },
  // épicos
  { id: "cachoeira", emoji: "⛲", label: "Cachoeira", rarity: "epico", desc: "Água que nunca para de cair." },
  { id: "golfinho", emoji: "🐬", label: "Golfinho", rarity: "epico", desc: "O mais esperto de todo o oceano." },
  { id: "tartaruga", emoji: "🐢", label: "Tartaruga Marinha", rarity: "epico", desc: "Devagar, sempre, por décadas." },
  { id: "estrelamar", emoji: "⭐", label: "Estrela do Mar", rarity: "epico", desc: "Perde um braço e cresce outro. Resiliência pura." },
  { id: "iceberg", emoji: "🧊", label: "Iceberg", rarity: "epico", desc: "O que você vê é só a ponta." },
  { id: "polvo", emoji: "🐙", label: "Polvo", rarity: "epico", desc: "Oito braços, nenhum de fora d'água." },
  { id: "baleiajubarte", emoji: "🐳", label: "Baleia Jubarte", rarity: "epico", desc: "Canta debaixo d'água pra quem quiser ouvir." },
  { id: "geleira", emoji: "🏔️", label: "Geleira", rarity: "epico", desc: "Água guardada há milhares de anos." },
  { id: "tempestade", emoji: "⛈️", label: "Tempestade", rarity: "epico", desc: "Quando o céu decide despejar tudo de uma vez." },
  { id: "coral", emoji: "🪸", alt: "🌺", label: "Coral", rarity: "epico", desc: "Uma cidade inteira debaixo d'água." },
  // lendários
  { id: "sereia", emoji: "🧜‍♀️", label: "Sereia", rarity: "lendario", desc: "Diz a lenda que canta pra quem bebe água todo dia." },
  { id: "tridente", emoji: "🔱", label: "Tridente de Poseidon", rarity: "lendario", desc: "Comanda todos os oceanos com um só gesto." },
  { id: "baleia", emoji: "🐋", label: "Baleia Mística", rarity: "lendario", desc: "Poucos já viram. Menos ainda contam a história." },
  { id: "dragao", emoji: "🐉", label: "Dragão das Águas", rarity: "lendario", desc: "Guardião lendário das nascentes mais puras." },
  { id: "reidosmares", emoji: "🧜‍♂️", label: "Rei dos Mares", rarity: "lendario", desc: "Governa as profundezas há eras." },
  { id: "kraken", emoji: "🦑", label: "Kraken", rarity: "lendario", desc: "Emerge só pra quem já bebeu água suficiente hoje." },
  { id: "cisne", emoji: "🦢", label: "Cisne Encantado", rarity: "lendario", desc: "Elegância pura deslizando na superfície." },
  { id: "presagio", emoji: "🌌", label: "Presságio das Marés", rarity: "lendario", desc: "Um sinal raro de que grandes coisas estão por vir." },
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

function dayHasTriple(dayLogs) {
  return dayLogs.length >= 3;
}
function dayHasEarlyAndLate(dayLogs) {
  return dayLogs.some((e) => hmToMinutes(e.time) < hmToMinutes("08:00")) && dayLogs.some((e) => hmToMinutes(e.time) >= hmToMinutes("22:00"));
}

const BADGES = [
  { id: "first_drop", emoji: "💧", label: "Primeira Gota", xp: 20, check: (d) => totalEntries(d) >= 1 },
  { id: "goal_day", emoji: "🎯", label: "Meta Batida", xp: 20, check: (d) => Object.values(d.goalHit || {}).some(Boolean) },
  { id: "goal5", emoji: "📅", label: "5 Dias de Meta", xp: 40, check: (d) => Object.values(d.goalHit || {}).filter(Boolean).length >= 5 },
  { id: "goal14", emoji: "🗓️", label: "Hábito Formado (14 dias de meta)", xp: 80, check: (d) => Object.values(d.goalHit || {}).filter(Boolean).length >= 14 },
  { id: "hydration_master", emoji: "🏅", label: "30 Dias de Meta no Total", xp: 150, check: (d) => Object.values(d.goalHit || {}).filter(Boolean).length >= 30 },
  { id: "streak3", emoji: "🔥", label: "3 Dias Seguidos", xp: 30, check: (d) => d.streak >= 3 || d.bestStreak >= 3 },
  { id: "streak7", emoji: "🏆", label: "7 Dias Seguidos", xp: 60, check: (d) => d.streak >= 7 || d.bestStreak >= 7 },
  { id: "streak30", emoji: "👑", label: "30 Dias — Lenda", xp: 150, check: (d) => d.streak >= 30 || d.bestStreak >= 30 },
  { id: "streak60", emoji: "🌟", label: "60 Dias sem Falhar", xp: 250, check: (d) => d.streak >= 60 || d.bestStreak >= 60 },
  { id: "streak100", emoji: "🎖️", label: "100 Dias — Imparável", xp: 400, check: (d) => d.streak >= 100 || d.bestStreak >= 100 },
  { id: "early_bird", emoji: "🌅", label: "Madrugador", xp: 15, check: (d) => (d.earlyLogs || 0) >= 1 },
  { id: "night_owl", emoji: "🌙", label: "Coruja Noturna", xp: 15, check: (d) => (d.nightLogs || 0) >= 1 },
  { id: "night_and_day", emoji: "🌗", label: "Do Amanhecer ao Anoitecer", xp: 25, check: (d) => Object.values(d.logs).some(dayHasEarlyAndLate) },
  { id: "triple_day", emoji: "🥤", label: "Maratona do Dia (3+ registros)", xp: 20, check: (d) => Object.values(d.logs).some(dayHasTriple) },
  { id: "overachiever", emoji: "🚀", label: "Além da Meta", xp: 25, check: (d) => (d.overGoalDays || 0) >= 1 },
  { id: "big_gulp", emoji: "🥛", label: "Gole Grande (750ml de uma vez)", xp: 20, check: (d) => Object.values(d.logs).some((arr) => arr.some((e) => e.ml >= 750)) },
  { id: "variety", emoji: "🎨", label: "Combo Completo", xp: 20, check: (d) => Object.values(d.logs).some(dayHasAllSizes) },
  { id: "hundred", emoji: "💯", label: "100 Copos Registrados", xp: 100, check: (d) => totalEntries(d) >= 100 },
  { id: "xp1000", emoji: "⭐", label: "1000 XP", xp: 50, check: (d) => d.xp >= 1000 },
];

// ---------- estado global em memória ----------
let profiles = [];
let currentEmail = null;
let currentProfile = null;
let currentData = null;
let reminderTimer = null;
let lastLevelNum = null;

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
  data.giftIn = data.giftIn || [];
  data.giftOut = data.giftOut || [];
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

function clampInterval(v) {
  const n = Math.round(Number(v) || 90);
  return Math.min(360, Math.max(15, n));
}

function clampSafetyHours(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return 6;
  if (n === 0) return 0;
  return Math.min(24, Math.max(2, n));
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
        fireNotification(t);
        break; // um por vez é suficiente
      }
    }
  }
  const nextEl = document.getElementById("next-reminder");
  if (nextEl) nextEl.textContent = nextReminderLabel();
}

const REMINDER_MESSAGES = {
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
  behind: [
    "⚠️ Você está bem atrás da meta hoje — bora recuperar?",
    "📉 Sua hidratação tá devendo hoje. Um copo agora já ajuda bastante.",
    "🚨 Hoje tá fraco em água. Que tal um gole agora mesmo?",
  ],
  ahead: [
    "🔥 Quase lá! Só um pouquinho mais pra bater a meta.",
    "💪 Reta final — falta pouco pra hoje ser 100% hidratado.",
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
};

function pickReminderMessage(t, times) {
  const goal = calcGoal(currentProfile);
  const total = getDayTotal(currentData, todayStr());
  const pct = goal > 0 ? total / goal : 0;
  let pool;
  if (t === times[0]) pool = REMINDER_MESSAGES.morning;
  else if (t === times[times.length - 1] && pct < 1) pool = REMINDER_MESSAGES.evening;
  else if (pct < 0.4 && hmToMinutes(t) >= hmToMinutes("12:00")) pool = REMINDER_MESSAGES.behind;
  else if (pct >= 0.85 && pct < 1) pool = REMINDER_MESSAGES.ahead;
  else pool = REMINDER_MESSAGES.general;
  return pool[Math.floor(Math.random() * pool.length)];
}

function showSystemNotification(body, options) {
  if (!(window.Notification && Notification.permission === "granted")) return;
  const opts = { body, icon: "icon-192.png", badge: "icon-192.png", vibrate: [80, 40, 80], ...options };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification("Hidrata", opts));
  } else {
    new Notification("Hidrata", opts);
  }
}

function fireNotification(t) {
  const times = computeReminderTimes(currentProfile);
  const message = pickReminderMessage(t || nowHM(), times);
  showToast(message);
  showSystemNotification(message);
}

function fireGoalHitNotification() {
  const pool = [
    "🎉 Meta batida! Seu corpo agradece.",
    "🏆 Você bateu a meta de hoje. Mandou bem!",
    "✨ 100% hidratado hoje. Você é fera!",
  ];
  showSystemNotification(pool[Math.floor(Math.random() * pool.length)]);
}

function fireStreakNotification(n) {
  showSystemNotification(`🔥 ${n} dias seguidos cuidando da sua hidratação! Sequência incrível.`);
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
    showToast("🎉 Meta do dia batida! +50 XP");
    fireGoalHitNotification();
  }
  // conta no máximo uma vez por dia (antes somava a cada registro depois de 150%)
  if (total >= goal * 1.5 && currentData.overGoalDate !== date) {
    currentData.overGoalDate = date;
    currentData.overGoalDays = (currentData.overGoalDays || 0) + 1;
  }
  return justHit;
}

// ---------- dias seguidos ----------
// A sequência é derivada do histórico (não de um contador): assim zera quando o dia é perdido,
// corrige dias passados e fica igual em todos os aparelhos. Um dia conta a partir de X% da meta.
const DEFAULT_STREAK_MIN_PCT = 80;

function streakMinPct(profile) {
  const n = Number(profile && profile.streakMinPct);
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.max(10, Math.round(n))) : DEFAULT_STREAK_MIN_PCT;
}

function shiftDay(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function dayCountsForStreak(data, key, goal, pct) {
  const total = getDayTotal(data, key);
  return total > 0 && total >= (goal * pct) / 100;
}

function computeStreak(data, goal, pct, today) {
  const counted = (k) => dayCountsForStreak(data, k, goal, pct);
  const todayCounted = counted(today);
  // hoje ainda pode contar: enquanto o dia não acaba, a sequência de ontem continua viva
  const start = todayCounted ? today : shiftDay(today, -1);
  let current = 0;
  for (let k = start; counted(k) && current < 5000; k = shiftDay(k, -1)) current++;

  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of Object.keys(data.logs || {}).filter(counted).sort()) {
    run = prev && shiftDay(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { current, best, lastDay: current > 0 ? start : null, todayCounted };
}

function recomputeStreak() {
  const s = computeStreak(currentData, calcGoal(currentProfile), streakMinPct(currentProfile), todayStr());
  const before = [currentData.streak, currentData.bestStreak, currentData.lastStreakDate].join("|");
  currentData.streak = s.current;
  currentData.bestStreak = Math.max(currentData.bestStreak || 0, s.best, s.current);
  currentData.lastStreakDate = s.lastDay;
  if ([currentData.streak, currentData.bestStreak, currentData.lastStreakDate].join("|") !== before) saveData();
  return s;
}

// ---------- emblemas (sorteio aleatório + álbum) ----------
// Presentes de grupo: giftIn/giftOut guardam "emblema:idDoPresente" (só crescem, então sincronizam sem perda).
function giftCount(list, id) {
  return (list || []).filter((x) => typeof x === "string" && x.startsWith(id + ":")).length;
}
// Quantas cópias a pessoa tem: sorteadas + recebidas - dadas.
function emblemCopies(data, id) {
  const gin = giftCount(data.giftIn, id);
  const gout = giftCount(data.giftOut, id);
  const drawn = data.emblemCounts[id] !== undefined ? data.emblemCounts[id] : data.emblems.includes(id) && gin === 0 ? 1 : 0;
  return Math.max(0, drawn + gin - gout);
}

// Alguns aparelhos não desenham emojis recentes (aparece um quadrado vazio): detecta e usa uma alternativa.
const emojiDrawnCache = {};
function emojiIsDrawn(ch) {
  if (emojiDrawnCache[ch] !== undefined) return emojiDrawnCache[ch];
  let ok = true;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 40;
    const x = c.getContext("2d");
    x.font = "28px sans-serif";
    x.textBaseline = "top";
    const sig = (s) => { x.clearRect(0, 0, 40, 40); x.fillText(s, 2, 2); return c.toDataURL(); };
    const mine = sig(ch);
    ok = mine !== sig("\u{10FFFF}") && mine !== sig("");
  } catch {
    ok = true;
  }
  return (emojiDrawnCache[ch] = ok);
}
// devolve texto puro (emoji, alternativa ou a inicial do nome); nunca HTML
function emblemGlyph(e) {
  if (emojiIsDrawn(e.emoji)) return e.emoji;
  if (e.alt && emojiIsDrawn(e.alt)) return e.alt;
  return e.label.charAt(0);
}
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
    const base = currentData.emblemCounts[emblem.id] !== undefined ? currentData.emblemCounts[emblem.id] : giftCount(currentData.giftIn, emblem.id) > 0 ? 0 : 1;
    currentData.emblemCounts[emblem.id] = base + 1;
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
      fireStreakNotification(m.n);
    }
  }
}

function checkBadges() {
  const newly = [];
  for (const b of BADGES) {
    if (!currentData.unlockedBadges.includes(b.id) && b.check(currentData)) {
      currentData.unlockedBadges.push(b.id);
      currentData.xp += b.xp || 0;
      newly.push(b);
    }
  }
  if (newly.length) {
    const totalXp = newly.reduce((s, b) => s + (b.xp || 0), 0);
    showToast("🏅 Nova conquista: " + newly.map((b) => b.label).join(", ") + ` (+${totalXp} XP)`);
  }
}

// ---------- ações ----------
function addWater(ml) {
  const date = todayStr();
  const time = nowHM();
  const countedBefore = dayCountsForStreak(currentData, date, calcGoal(currentProfile), streakMinPct(currentProfile));
  currentData.logs[date] = currentData.logs[date] || [];
  currentData.logs[date].push({ time, ml, id: randomId(), ts: Date.now() });
  currentData.xp += 10;
  if (hmToMinutes(time) < hmToMinutes("08:00")) currentData.earlyLogs = (currentData.earlyLogs || 0) + 1;
  if (hmToMinutes(time) >= hmToMinutes("22:00")) currentData.nightLogs = (currentData.nightLogs || 0) + 1;

  const goal = calcGoal(currentProfile);
  const justHitGoal = registerGoalProgress(goal);
  const streakInfo = recomputeStreak();
  if (!countedBefore && streakInfo.todayCounted && !justHitGoal) {
    showToast(`🔥 Hoje já conta! ${streakInfo.current} ${streakInfo.current === 1 ? "dia seguido" : "dias seguidos"}`);
  }
  checkStreakMilestones();

  if (Math.random() < 0.35) grantEmblemWithToast();
  if (justHitGoal) grantEmblemWithToast();

  checkBadges();
  saveData();
  scheduleSync();
  if (typeof scheduleGroupSnapshot === "function") scheduleGroupSnapshot();
  renderToday();
  renderProgress();
  renderAlbum();

  const ringCenter = document.querySelector(".ring-center");
  if (ringCenter) {
    ringCenter.classList.remove("pulse");
    void ringCenter.offsetWidth;
    ringCenter.classList.add("pulse");
  }
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
      const avatarHtml = safePictureUrl(p.picture)
        ? `<img class="avatar" src="${escapeHtml(safePictureUrl(p.picture))}" alt="" />`
        : `<span class="drop">💧</span>`;
      chip.innerHTML = `<div class="chip-info">${avatarHtml}<div><div class="name">${escapeHtml(p.name)}</div><div class="email">${escapeHtml(p.email)}</div></div></div><div>➜</div>`;
      chip.addEventListener("click", () => login(p.email));
      list.appendChild(chip);
    });
  }
}

// Só aceita foto de perfil vinda do domínio de imagens do Google, por HTTPS.
function safePictureUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && /(^|\.)googleusercontent\.com$/.test(x.hostname) ? x.href : null;
  } catch {
    return null;
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
  lastLevelNum = null;
  localStorage.setItem("hidrata_current", email);
  saveData();
  document.getElementById("screen-auth").classList.add("hidden");
  document.getElementById("screen-app").classList.remove("hidden");
  document.getElementById("user-name").textContent = p.name.split(" ")[0];
  const avatarEl = document.getElementById("user-avatar");
  if (safePictureUrl(p.picture)) {
    avatarEl.src = safePictureUrl(p.picture);
    avatarEl.classList.remove("hidden");
  } else {
    avatarEl.classList.add("hidden");
  }
  fillProfileForm();
  renderToday();
  renderProgress();
  renderAlbum();
  startReminderLoop();
  syncPushSubscription({ silent: true });
  resetSyncState();
  updateSyncUI();
  scheduleSync(800);
  maybeAskCloudConsent();
  if (typeof groupOnLogin === "function") groupOnLogin();
}

function logout() {
  if (typeof groupOnLogout === "function") groupOnLogout();
  stopReminderLoop();
  currentEmail = null;
  currentProfile = null;
  currentData = null;
  localStorage.removeItem("hidrata_current");
  document.getElementById("screen-app").classList.add("hidden");
  document.getElementById("screen-auth").classList.remove("hidden");
  renderAuthScreen();
  tryInitGoogleSignIn();
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

  const streakInfo = recomputeStreak();
  document.getElementById("streak-num").textContent = streakInfo.current;
  const minPct = streakMinPct(currentProfile);
  const needMl = Math.max(0, Math.ceil((goal * minPct) / 100) - total);
  let hint;
  if (streakInfo.todayCounted) hint = "✅ Hoje já conta na sua sequência.";
  else if (streakInfo.current > 0) hint = `⏳ Faltam ${needMl} ml hoje para manter seus ${streakInfo.current} ${streakInfo.current === 1 ? "dia" : "dias"} seguidos.`;
  else hint = `Beba ${needMl} ml hoje (${minPct}% da meta) para começar uma sequência.`;
  document.getElementById("streak-hint").textContent = hint;
  document.getElementById("xp-num").textContent = currentData.xp || 0;
  document.getElementById("next-reminder").textContent = nextReminderLabel();

  const lvl = levelInfo(currentData.xp || 0);
  document.getElementById("level-name").textContent = lvl.name;
  document.getElementById("level-num").textContent = lvl.num;
  const levelBadgeEl = document.querySelector(".level-badge");
  if (lastLevelNum !== null && lvl.num > lastLevelNum) {
    levelBadgeEl.classList.remove("levelup");
    void levelBadgeEl.offsetWidth;
    levelBadgeEl.classList.add("levelup");
    showToast(`🎉 Subiu para o nível ${lvl.num}: ${lvl.name}!`);
  }
  lastLevelNum = lvl.num;

  const notifBtn = document.getElementById("btn-enable-notif");
  if (window.Notification && Notification.permission === "granted") {
    notifBtn.textContent = "🔄 Verificar notificações no servidor";
  } else {
    notifBtn.textContent = "🔔 Ativar notificações";
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
  BADGES.forEach((b, idx) => {
    const unlocked = currentData.unlockedBadges.includes(b.id);
    const el = document.createElement("div");
    el.className = "badge" + (unlocked ? " unlocked" : "");
    el.style.setProperty("--i", idx);
    el.innerHTML = `<span class="emoji">${b.emoji}</span><div class="label">${b.label}</div>`;
    grid.appendChild(el);
  });
}

function renderAlbum() {
  const grid = document.getElementById("album-grid");
  grid.innerHTML = "";
  EMBLEMS.forEach((e, idx) => {
    const owned = currentData.emblems.includes(e.id);
    const count = emblemCopies(currentData, e.id);
    const el = document.createElement("div");
    el.className = `emblem rarity-${e.rarity}` + (owned ? " owned" : "");
    el.style.setProperty("--i", idx);
    el.innerHTML = `
      ${owned && count > 1 ? `<div class="count">x${count}</div>` : ""}
      <span class="emoji">${escapeHtml(emblemGlyph(e))}</span>
      <div class="label">${owned ? e.label : "???"}</div>
      <div class="rarity-tag">${RARITY_LABELS[e.rarity]}</div>
      ${owned ? `<div class="emblem-desc">${e.desc}</div>` : ""}
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
  document.getElementById("p-safety").value = String(currentProfile.safetyHours === undefined ? 6 : currentProfile.safetyHours);
  document.getElementById("p-streak-min").value = String(streakMinPct(currentProfile));
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

// ---------- push real (funciona com o app fechado) ----------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function randomId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getOrCreateDeviceCreds() {
  let creds;
  try { creds = JSON.parse(localStorage.getItem("hidrata_push_device") || "null"); } catch { creds = null; }
  if (!creds || !creds.id || !creds.secret) {
    creds = { id: randomId(), secret: randomSecret() };
    localStorage.setItem("hidrata_push_device", JSON.stringify(creds));
  }
  return creds;
}

function pushConfigured() {
  return typeof PUSH_SERVER_URL === "string" && PUSH_SERVER_URL && typeof VAPID_PUBLIC_KEY === "string" && VAPID_PUBLIC_KEY;
}

async function syncPushSubscription(opts) {
  const silent = opts && opts.silent;
  if (!pushConfigured() || !currentProfile) return null;
  if (!window.Notification || Notification.permission !== "granted") return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const creds = getOrCreateDeviceCreds();
    const resp = await fetch(PUSH_SERVER_URL.replace(/\/$/, "") + "/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: creds.id,
        deviceSecret: creds.secret,
        subscription: sub.toJSON(),
        wake: currentProfile.wake,
        sleep: currentProfile.sleep,
        interval: Number(currentProfile.interval),
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
        safetyHours: currentProfile.safetyHours === undefined ? 6 : currentProfile.safetyHours,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("Falha ao registrar push no servidor:", resp.status, errText);
      if (!silent) showToast("⚠️ Não consegui confirmar o registro no servidor de notificações. Vai funcionar só com o app aberto.");
      return false;
    }
    if (!silent) showToast("✅ Notificações reais confirmadas no servidor (funcionam com o app fechado).");
    return true;
  } catch (e) {
    console.error("Erro ao sincronizar push:", e);
    if (!silent) showToast("⚠️ Sem conexão com o servidor de notificações agora. Tente de novo mais tarde.");
    return false;
  }
}

async function sendPushTest() {
  const creds = getOrCreateDeviceCreds();
  try {
    const resp = await fetch(PUSH_SERVER_URL.replace(/\/$/, "") + "/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: creds.id, deviceSecret: creds.secret }),
    });
    if (resp.ok) {
      showToast("📨 Push de teste enviado! Minimize o app: ele deve chegar em instantes.");
      return true;
    }
    const data = await resp.json().catch(() => ({}));
    console.error("Push de teste falhou:", resp.status, data);
    showToast("⚠️ O servidor não conseguiu enviar o teste: " + (data.error || "erro " + resp.status));
    return false;
  } catch (e) {
    console.error("Erro no push de teste:", e);
    showToast("⚠️ Sem conexão com o servidor de notificações agora.");
    return false;
  }
}

async function unsyncPushSubscription() {
  if (!pushConfigured()) return;
  let creds;
  try { creds = JSON.parse(localStorage.getItem("hidrata_push_device") || "null"); } catch { creds = null; }
  if (!creds) return;
  try {
    await fetch(PUSH_SERVER_URL.replace(/\/$/, "") + "/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: creds.id, deviceSecret: creds.secret }),
    });
  } catch {}
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
      picture: safePictureUrl(payload.picture),
      authProvider: "google",
      weightKg: 70,
      activity: "light",
      hot: false,
      wake: "07:00",
      sleep: "23:00",
      interval: 90,
      safetyHours: 6,
      goalOverride: null,
      settingsUpdatedAt: 0,
      createdAt: Date.now(),
    };
    profiles.push(profile);
    saveProfiles();
    login(email);
    showToast("Conta criada com Google! Ajuste seu peso e atividade em Perfil.");
  } else {
    // mantém dados locais já configurados, só atualiza nome/foto vindos do Google
    // e liga a conta à sincronização (o servidor valida o login antes de aceitar qualquer dado)
    profile.name = payload.name || profile.name;
    profile.picture = safePictureUrl(payload.picture) || safePictureUrl(profile.picture);
    profile.authProvider = "google";
    const idx = profiles.findIndex((p) => p.email === email);
    profiles[idx] = profile;
    saveProfiles();
    login(email);
  }
  startCloudSession(email, response.credential);
}

// A nuvem só é contatada com consentimento: sem ele, o token do Google fica só na memória
// até o usuário responder ao pedido de autorização.
function startCloudSession(email, credential) {
  rememberGoogleCredential(credential);
  const wantsCloud = currentProfile && (currentProfile.cloudSync === true || (currentProfile.groupPrefs && currentProfile.groupPrefs.consent === true));
  if (wantsCloud) {
    establishSession(email, credential).then((ok) => {
      updateSyncUI();
      if (ok && currentProfile && currentProfile.cloudSync === true) syncNow();
      if (ok && typeof groupOnSession === "function") groupOnSession();
    });
  } else {
    maybeAskCloudConsent();
  }
}

let googleScriptRequested = false;
let googleButtonReady = false;

function googleConfigured() {
  return typeof GOOGLE_CLIENT_ID === "string" && GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith("COLE_SEU_CLIENT_ID");
}

// O script do Google só é baixado quando a tela de login aparece: quem já está
// logado (ou usa só conta local) não envia nenhuma requisição ao Google.
function loadGoogleScript() {
  if (googleScriptRequested || (window.google && window.google.accounts)) return;
  googleScriptRequested = true;
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true;
  document.head.appendChild(s);
}

function tryInitGoogleSignIn(attempts) {
  if (googleButtonReady || !googleConfigured()) return;
  loadGoogleScript();
  attempts = attempts || 0;
  if (window.google && window.google.accounts) {
    initGoogleSignIn();
  } else if (attempts < 80) {
    setTimeout(() => tryInitGoogleSignIn(attempts + 1), 150);
  }
}

function initGoogleSignIn() {
  if (googleButtonReady || !googleConfigured() || !window.google || !window.google.accounts) return;
  googleButtonReady = true;
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
    tryInitGoogleSignIn();
  }

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
      interval: clampInterval(document.getElementById("c-interval").value),
      safetyHours: 6,
      goalOverride: null,
      settingsUpdatedAt: Date.now(),
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
      if (typeof groupOnTab === "function") groupOnTab(tab.dataset.tab);
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
    const alreadyGranted = Notification.permission === "granted";
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
    if (!alreadyGranted) {
      showToast("Notificações ativadas! 🔔");
      fireNotification();
    } else {
      showToast("🔄 Verificando registro no servidor...");
    }
    renderToday();
    const registered = await syncPushSubscription({ silent: true });
    if (registered) {
      await sendPushTest();
    } else {
      showToast("⚠️ Não consegui registrar seu aparelho no servidor de notificações. Vai funcionar só com o app aberto.");
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
    currentProfile.interval = clampInterval(document.getElementById("p-interval").value);
    currentProfile.safetyHours = clampSafetyHours(document.getElementById("p-safety").value);
    currentProfile.streakMinPct = streakMinPct({ streakMinPct: document.getElementById("p-streak-min").value });
    currentProfile.settingsUpdatedAt = Date.now();
    const override = document.getElementById("p-goal-override").value;
    currentProfile.goalOverride = override ? Number(override) : null;
    const idx = profiles.findIndex((p) => p.email === currentProfile.email);
    profiles[idx] = currentProfile;
    saveProfiles();
    document.getElementById("user-name").textContent = currentProfile.name.split(" ")[0];
    showToast("Perfil salvo!");
    renderToday();
    syncPushSubscription();
    scheduleSync(1000);
  });

  document.getElementById("btn-reset-data").addEventListener("click", () => {
    if (confirm("Isso vai apagar todo o histórico e XP deste perfil. Continuar?")) {
      localStorage.removeItem("hidrata_data_" + currentEmail);
      currentData = loadData(currentEmail);
      currentData.resetAt = Date.now();
      saveData();
      scheduleSync(1000);
      renderToday();
      renderProgress();
      renderAlbum();
      showToast("Dados apagados.");
    }
  });

  document.getElementById("btn-remove-profile").addEventListener("click", async () => {
    if (!confirm("Remover este perfil do aparelho? Apaga daqui o perfil, o histórico, a sessão e o registro de notificações. O que já está na nuvem continua lá (use \"Apagar meus dados da nuvem\" antes, se quiser apagar também).")) return;
    const email = currentEmail;
    await unsyncPushSubscription();
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
    localStorage.removeItem("hidrata_push_device");
    clearSession(email);
    localStorage.removeItem("hidrata_data_" + email);
    profiles = profiles.filter((p) => p.email !== email);
    saveProfiles();
    logout();
    showToast("🗑️ Perfil removido deste aparelho.");
  });

  document.getElementById("btn-disable-push").addEventListener("click", async () => {
    const btn = document.getElementById("btn-disable-push");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Desativando...";
    await unsyncPushSubscription();
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
    localStorage.removeItem("hidrata_push_device");
    btn.textContent = "✅ Desativado";
    showToast("🔕 Notificações remotas desativadas e apagadas do servidor.");
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 2500);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});

    let swRefreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swRefreshed) return;
      swRefreshed = true;
      window.location.reload();
    });
  }
});
