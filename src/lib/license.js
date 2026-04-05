/**
 * ÉcoleOS License Validation (Client-Side)
 * Uses Web Crypto API for HMAC verification in the browser.
 */

// Verification key (must match server's ECOLEOS_LICENSE_SECRET)
// Stored as char codes for basic obfuscation — update for production
const _VK = [101,99,111,108,101,111,115,95,108,105,99,101,110,115,101,95,115,101,99,114,101,116,95,99,104,97,110,103,101,95,109,101,95,105,110,95,112,114,111,100,117,99,116,105,111,110,95,50,48,50,53];
const getVK = () => String.fromCharCode(..._VK);

const PLAN_REVERSE = { "0": "essai", "1": "basique", "2": "standard", "3": "premium" };
const TYPE_REVERSE = { P: "permanent", S: "subscription" };
const GRACE_DAYS = 7;

function hexToAscii(hex) {
  let str = "";
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return str;
}

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Generate a device fingerprint
 */
export function getDeviceFingerprint() {
  const parts = [
    navigator.userAgent,
    screen.width + "x" + screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.hardwareConcurrency || 0,
  ];
  return parts.join("|");
}

async function hashFingerprint(fp) {
  const enc = new TextEncoder().encode(fp);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return bufToHex(buf).slice(0, 16).toLowerCase();
}

/**
 * Validate a license key
 * @returns {{ valid, school, plan, type, devices, expiry, isPermanent, error }}
 */
export async function validateLicenseKey(key) {
  if (!key || typeof key !== "string") {
    return { valid: false, error: "Clé de licence requise" };
  }

  key = key.trim().toUpperCase();

  if (!key.startsWith("ECOLEOS-")) {
    return { valid: false, error: "Format de clé invalide" };
  }

  const stripped = key.replace(/^ECOLEOS-/, "").replace(/-/g, "");
  if (stripped.length < 56) {
    return { valid: false, error: "Clé trop courte" };
  }

  // First 36 hex chars = payload, next 20 hex chars = HMAC signature
  const payloadHex = stripped.slice(0, 36);
  const sigFromKey = stripped.slice(36, 56);

  let payload;
  try {
    payload = hexToAscii(payloadHex);
  } catch {
    return { valid: false, error: "Encodage de clé invalide" };
  }

  if (payload.length !== 18) {
    return { valid: false, error: "Clé corrompue" };
  }

  // Parse fields: SCHOOL(6) + PLAN(1) + TYPE(1) + DEVICES(2) + EXPIRY(8)
  const schoolCode = payload.slice(0, 6).replace(/0+$/, "");
  const planCode = payload.slice(6, 7);
  const typeCode = payload.slice(7, 8);
  const deviceLimit = parseInt(payload.slice(8, 10), 10);
  const expiryRaw = payload.slice(10, 18);

  const plan = PLAN_REVERSE[planCode];
  const type = TYPE_REVERSE[typeCode];

  if (!plan || !type) {
    return { valid: false, error: "Clé invalide" };
  }

  // Verify HMAC-SHA256 signature using Web Crypto API
  try {
    const secret = getVK();
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBuf = await crypto.subtle.sign("HMAC", keyMaterial, encoder.encode(payload));
    const expectedSig = bufToHex(sigBuf).slice(0, 20);

    if (sigFromKey !== expectedSig) {
      return { valid: false, error: "Clé invalide ou falsifiée" };
    }
  } catch {
    return { valid: false, error: "Erreur de vérification" };
  }

  const expiryStr = `${expiryRaw.slice(0, 4)}-${expiryRaw.slice(4, 6)}-${expiryRaw.slice(6, 8)}`;
  const isPermanent = type === "permanent";

  return {
    valid: true,
    school: schoolCode,
    plan,
    type,
    devices: deviceLimit,
    expiry: isPermanent ? null : expiryStr,
    isPermanent,
  };
}

/**
 * Check subscription status with grace period
 */
export function checkSubscriptionStatus(expiryDate) {
  if (!expiryDate) return { active: true, inGrace: false, daysLeft: Infinity, expired: false };

  const now = new Date();
  const expiry = new Date(expiryDate);
  const graceEnd = new Date(expiry);
  graceEnd.setDate(graceEnd.getDate() + GRACE_DAYS);

  const daysLeft = Math.ceil((expiry - now) / 86400000);
  const graceDaysLeft = Math.ceil((graceEnd - now) / 86400000);

  if (daysLeft > 0) {
    return { active: true, inGrace: false, daysLeft, expired: false };
  }
  if (graceDaysLeft > 0) {
    return { active: true, inGrace: true, daysLeft: 0, graceDaysLeft, expired: false };
  }
  return { active: false, inGrace: false, daysLeft: 0, graceDaysLeft: 0, expired: true };
}

/**
 * Activate license: validate key, check device limit, store
 */
export async function activateLicense(key) {
  const result = await validateLicenseKey(key);
  if (!result.valid) {
    return { success: false, error: result.error };
  }

  const fp = getDeviceFingerprint();
  const fpHash = await hashFingerprint(fp);

  const stored = getLicenseData();
  if (stored && stored.key === key.trim().toUpperCase()) {
    if (stored.deviceHash === fpHash) {
      return { success: true, license: stored };
    }
    const deviceCount = (stored.devices || []).length;
    if (deviceCount >= result.devices) {
      return { success: false, error: `Limite d'appareils atteinte (${result.devices} max)` };
    }
  }

  const license = {
    key: key.trim().toUpperCase(),
    school: result.school,
    plan: result.plan,
    type: result.type,
    maxDevices: result.devices,
    expiry: result.expiry,
    isPermanent: result.isPermanent,
    activatedAt: new Date().toISOString(),
    deviceHash: fpHash,
    devices: stored?.key === key.trim().toUpperCase()
      ? [...new Set([...(stored.devices || []), fpHash])]
      : [fpHash],
  };

  localStorage.setItem("eos3_license", JSON.stringify(license));
  return { success: true, license };
}

/**
 * Get stored license data
 */
export function getLicenseData() {
  try {
    const raw = localStorage.getItem("eos3_license");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Verify stored license integrity on app load
 */
export async function verifyStoredLicense() {
  const license = getLicenseData();
  if (!license || !license.key) {
    return { valid: false, license: null, status: "none", error: "Aucune licence activée" };
  }

  const result = await validateLicenseKey(license.key);
  if (!result.valid) {
    localStorage.removeItem("eos3_license");
    return { valid: false, license: null, status: "tampered", error: "Licence corrompue ou falsifiée" };
  }

  const fp = getDeviceFingerprint();
  const fpHash = await hashFingerprint(fp);
  if (license.deviceHash !== fpHash) {
    if (license.devices && license.devices.includes(fpHash)) {
      license.deviceHash = fpHash;
      localStorage.setItem("eos3_license", JSON.stringify(license));
    } else if ((license.devices || []).length < (license.maxDevices || 3)) {
      license.devices = [...new Set([...(license.devices || []), fpHash])];
      license.deviceHash = fpHash;
      localStorage.setItem("eos3_license", JSON.stringify(license));
    } else {
      return { valid: false, license, status: "device_mismatch", error: "Appareil non autorisé" };
    }
  }

  if (!result.isPermanent) {
    const subStatus = checkSubscriptionStatus(result.expiry);
    if (subStatus.expired) {
      return { valid: false, license, status: "expired", error: "Abonnement expiré" };
    }
    if (subStatus.inGrace) {
      return { valid: true, license, status: "grace", graceDaysLeft: subStatus.graceDaysLeft };
    }
    return { valid: true, license, status: "active", daysLeft: subStatus.daysLeft };
  }

  return { valid: true, license, status: "active" };
}

/**
 * Remove license (for testing/admin)
 */
export function clearLicense() {
  localStorage.removeItem("eos3_license");
}
