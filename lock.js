/* Bloqueio opcional por PIN: trava de tela local. NÃO criptografa os dados do aparelho. */

const LOCK_KEY = "hidrata_lock";
const LOCK_ATTEMPTS_KEY = "hidrata_lock_attempts";
const LOCK_AFTER_MS = 60000;
const PIN_RE = /^\d{4,6}$/;
const PBKDF2_ITER = 150000;

let lockHiddenAt = 0;

function readLock() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
  } catch {
    return null;
  }
}
function hasPin() {
  const l = readLock();
  return !!(l && l.salt && l.hash);
}

function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derivePinHash(pin, salt, iter) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

async function savePin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt, PBKDF2_ITER);
  localStorage.setItem(LOCK_KEY, JSON.stringify({ salt: bytesToB64(salt), hash: bytesToB64(hash), iter: PBKDF2_ITER }));
  localStorage.removeItem(LOCK_ATTEMPTS_KEY);
}

async function checkPin(pin) {
  const l = readLock();
  if (!l) return false;
  const hash = await derivePinHash(pin, b64ToBytes(l.salt), l.iter);
  const expected = b64ToBytes(l.hash);
  let diff = hash.length ^ expected.length;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ (expected[i] || 0);
  return diff === 0;
}

// Depois de 5 erros seguidos o app exige espera crescente (30s, 60s, 2min... até 15min).
function readAttempts() {
  try {
    return JSON.parse(localStorage.getItem(LOCK_ATTEMPTS_KEY) || '{"n":0,"until":0}');
  } catch {
    return { n: 0, until: 0 };
  }
}
function lockedOutSeconds() {
  return Math.max(0, Math.ceil((readAttempts().until - Date.now()) / 1000));
}
function registerPinFailure() {
  const a = readAttempts();
  a.n += 1;
  if (a.n >= 5) a.until = Date.now() + Math.min(900, 30 * 2 ** (a.n - 5)) * 1000;
  localStorage.setItem(LOCK_ATTEMPTS_KEY, JSON.stringify(a));
}

function showLockScreen() {
  if (!hasPin()) return;
  const el = document.getElementById("screen-lock");
  if (!el) return;
  el.classList.remove("hidden");
  const input = document.getElementById("lock-input");
  input.value = "";
  document.getElementById("lock-msg").textContent = "";
  setTimeout(() => input.focus(), 50);
}
function hideLockScreen() {
  document.getElementById("screen-lock").classList.add("hidden");
}

async function onUnlockSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("lock-input");
  const msg = document.getElementById("lock-msg");
  const wait = lockedOutSeconds();
  if (wait > 0) {
    msg.textContent = `Muitas tentativas. Tente de novo em ${wait}s.`;
    return;
  }
  const pin = input.value;
  input.value = "";
  if (await (PIN_RE.test(pin) ? checkPin(pin) : Promise.resolve(false))) {
    localStorage.removeItem(LOCK_ATTEMPTS_KEY);
    msg.textContent = "";
    hideLockScreen();
    return;
  }
  registerPinFailure();
  const w = lockedOutSeconds();
  msg.textContent = w > 0 ? `PIN incorreto. Tente de novo em ${w}s.` : "PIN incorreto.";
}

async function onForgotPin() {
  if (!confirm("Sem o PIN não dá para abrir o app. Para continuar, é preciso APAGAR todos os dados deste aparelho (perfis, histórico e sessões). O que estiver na nuvem continua lá. Apagar e recomeçar?")) return;
  try {
    if (typeof unsyncPushSubscription === "function") await unsyncPushSubscription();
  } catch {}
  localStorage.clear();
  location.reload();
}

// ---------- configuração no Perfil ----------
function updateLockUI() {
  const status = document.getElementById("lock-status");
  if (!status) return;
  const on = hasPin();
  status.textContent = on ? "🔒 PIN ativado neste aparelho." : "Desativado. Defina um PIN de 4 a 6 números.";
  document.getElementById("pin-current").classList.toggle("hidden", !on);
  document.getElementById("btn-pin-remove").classList.toggle("hidden", !on);
  document.getElementById("btn-pin-save").textContent = on ? "Alterar PIN" : "Salvar PIN";
}

async function verifyCurrentPinField() {
  const wait = lockedOutSeconds();
  if (wait > 0) {
    showToast(`⚠️ Muitas tentativas. Tente de novo em ${wait}s.`);
    return false;
  }
  const pin = document.getElementById("pin-current").value;
  if (PIN_RE.test(pin) && (await checkPin(pin))) return true;
  registerPinFailure();
  showToast("⚠️ PIN atual incorreto.");
  return false;
}

function clearPinFields() {
  for (const id of ["pin-current", "pin-new", "pin-confirm"]) document.getElementById(id).value = "";
}

async function onSavePin() {
  const next = document.getElementById("pin-new").value;
  const confirmPin = document.getElementById("pin-confirm").value;
  if (!PIN_RE.test(next)) {
    showToast("⚠️ O PIN precisa ter de 4 a 6 números.");
    return;
  }
  if (next !== confirmPin) {
    showToast("⚠️ Os dois PINs não são iguais.");
    return;
  }
  if (hasPin() && !(await verifyCurrentPinField())) return;
  await savePin(next);
  clearPinFields();
  updateLockUI();
  showToast("🔒 PIN salvo.");
}

async function onRemovePin() {
  if (!(await verifyCurrentPinField())) return;
  localStorage.removeItem(LOCK_KEY);
  localStorage.removeItem(LOCK_ATTEMPTS_KEY);
  clearPinFields();
  updateLockUI();
  showToast("PIN removido.");
}

// bloqueia já na carga (antes de qualquer interação) e ao voltar depois de 1 minuto fora
showLockScreen();

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("form-unlock").addEventListener("submit", onUnlockSubmit);
  document.getElementById("btn-forgot-pin").addEventListener("click", onForgotPin);
  document.getElementById("btn-pin-save").addEventListener("click", onSavePin);
  document.getElementById("btn-pin-remove").addEventListener("click", onRemovePin);
  updateLockUI();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    lockHiddenAt = Date.now();
  } else if (hasPin() && lockHiddenAt && Date.now() - lockHiddenAt > LOCK_AFTER_MS) {
    showLockScreen();
  }
});
