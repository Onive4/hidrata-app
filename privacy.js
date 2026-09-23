/* Privacidade: consentimento para a nuvem, política e exportação de dados. Depende de app.js e sync.js. */

const CONSENT_VERSION = 1;
const CREDENTIAL_MAX_AGE_MS = 50 * 60 * 1000;

// O token do Google só existe na hora do login: fica só na memória, nunca é salvo.
let pendingGoogleCredential = null;
let consentAskedFor = null;

function rememberGoogleCredential(token) {
  pendingGoogleCredential = { token, at: Date.now() };
}

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

function askCloudConsent() {
  if (!currentProfile || currentProfile.authProvider !== "google") {
    showToast("A sincronização só está disponível para contas Google.");
    return;
  }
  consentAskedFor = currentEmail;
  openModal("consent-modal");
}

// Chamado depois do login: pergunta uma vez por perfil, e só se o usuário nunca respondeu.
function maybeAskCloudConsent() {
  if (!currentProfile || consentAskedFor === currentEmail) return;
  if (currentProfile.authProvider === "google" && currentProfile.cloudSync === undefined) {
    setTimeout(() => {
      if (currentProfile && currentProfile.cloudSync === undefined && consentAskedFor !== currentEmail) askCloudConsent();
    }, 700);
  }
}

async function acceptCloudConsent() {
  closeModal("consent-modal");
  currentProfile.cloudSync = true;
  currentProfile.cloudConsentAt = Date.now();
  currentProfile.cloudConsentVersion = CONSENT_VERSION;
  saveProfiles();

  let hasSession = !!getSession(currentEmail);
  if (!hasSession && pendingGoogleCredential && Date.now() - pendingGoogleCredential.at < CREDENTIAL_MAX_AGE_MS) {
    hasSession = await establishSession(currentEmail, pendingGoogleCredential.token);
  }
  pendingGoogleCredential = null;

  if (hasSession) {
    showToast("☁️ Sincronização ativada");
    syncNow({ manual: true });
  } else {
    lastSyncError = "Para concluir, toque em \"Trocar de perfil\" e entre de novo com o Google.";
    showToast("⚠️ " + lastSyncError);
  }
  updateSyncUI();
}

function declineCloudConsent() {
  closeModal("consent-modal");
  currentProfile.cloudSync = false;
  saveProfiles();
  // o token continua só na memória (some em 50 min): se a pessoa quiser entrar num grupo logo depois, não precisa logar de novo
  updateSyncUI();
  showToast("Tudo bem: seus dados ficam só neste aparelho.");
}

// ---------- exportar meus dados ----------
function buildExport() {
  const p = currentProfile;
  const d = currentData;
  const historico = {};
  for (const date of Object.keys(d.logs || {}).sort()) {
    historico[date] = d.logs[date].map((e) => ({ hora: e.time, ml: e.ml }));
  }
  return {
    app: "Hidrata",
    formato: 1,
    exportadoEm: new Date().toISOString(),
    perfil: {
      nome: p.name,
      email: p.email,
      pesoKg: p.weightKg,
      atividade: p.activity,
      climaQuente: !!p.hot,
      acordaAs: p.wake,
      dormeAs: p.sleep,
      lembrarACadaMinutos: p.interval,
      lembreteDeSegurancaHoras: p.safetyHours === undefined ? 6 : p.safetyHours,
      metaManualMl: p.goalOverride || null,
      sincronizacaoNaNuvem: p.cloudSync === true,
      consentimentoEm: p.cloudConsentAt ? new Date(p.cloudConsentAt).toISOString() : null,
    },
    historicoDeAgua: historico,
    estatisticas: {
      xp: d.xp || 0,
      sequenciaAtual: d.streak || 0,
      melhorSequencia: d.bestStreak || 0,
      diasComMetaBatida: Object.keys(d.goalHit || {}).filter((k) => d.goalHit[k]).sort(),
    },
    conquistas: d.unlockedBadges || [],
    emblemas: d.emblemCounts || {},
    presentesRecebidos: d.giftIn || [],
    presentesEnviados: d.giftOut || [],
    grupo: p.groupPrefs
      ? {
          consentimento: p.groupPrefs.consent === true,
          apelido: p.groupPrefs.nick || null,
          apareceNoGrupo: p.groupPrefs.visible !== false,
          mostrarFoto: p.groupPrefs.showPhoto === true,
          receberAvisos: p.groupPrefs.pushOk !== false,
          estaEmGrupo: p.groupPrefs.inGroup === true,
        }
      : null,
  };
}

async function exportMyData() {
  const text = JSON.stringify(buildExport(), null, 2);
  const filename = `hidrata-meus-dados-${todayStr()}.json`;
  try {
    const file = new File([text], filename, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Meus dados do Hidrata" });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast("📦 Seus dados foram exportados.");
}

document.addEventListener("DOMContentLoaded", () => {
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  };
  on("btn-consent-accept", acceptCloudConsent);
  on("btn-consent-decline", declineCloudConsent);
  on("btn-consent-policy", () => openModal("privacy-modal"));
  on("btn-open-policy", () => openModal("privacy-modal"));
  on("btn-close-policy", () => closeModal("privacy-modal"));
  on("btn-export-data", exportMyData);
});
