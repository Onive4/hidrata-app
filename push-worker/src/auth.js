const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL_MS = 3600000;
const FORCED_REFRESH_MIN_MS = 60000;
const CLOCK_SKEW_MS = 60000;

let jwksCache = { keys: null, at: 0 };
let lastForcedRefresh = 0;

function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function loadJwks(fetchFn, force, nowMs) {
  if (!force && jwksCache.keys && nowMs - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  if (force && jwksCache.keys && nowMs - lastForcedRefresh < FORCED_REFRESH_MIN_MS) return jwksCache.keys;
  if (force) lastForcedRefresh = nowMs;
  const resp = await fetchFn(JWKS_URL);
  if (!resp.ok) throw new Error("chaves do Google indisponiveis");
  const body = await resp.json();
  if (!body || !Array.isArray(body.keys)) throw new Error("resposta de chaves invalida");
  jwksCache = { keys: body.keys, at: nowMs };
  return body.keys;
}

// Valida um ID token do Google (assinatura RS256, emissor, audiencia e validade).
// Devolve o payload; lanca Error se qualquer checagem falhar.
export async function verifyGoogleIdToken(token, { clientId, fetchFn = fetch, nowMs = Date.now() }) {
  if (typeof token !== "string" || token.length > 4096) throw new Error("token invalido");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("token malformado");

  let header, payload;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch {
    throw new Error("token malformado");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("algoritmo nao aceito");

  let keys = await loadJwks(fetchFn, false, nowMs);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await loadJwks(fetchFn, true, nowMs);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("chave desconhecida");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!valid) throw new Error("assinatura invalida");

  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new Error("emissor invalido");
  if (payload.aud !== clientId) throw new Error("audiencia invalida");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < nowMs - CLOCK_SKEW_MS) throw new Error("token expirado");
  if (typeof payload.iat === "number" && payload.iat * 1000 > nowMs + 5 * 60000) throw new Error("token do futuro");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("token sem sub");
  return payload;
}
