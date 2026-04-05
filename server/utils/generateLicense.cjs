#!/usr/bin/env node
/**
 * ÉcoleOS License Key Generator
 *
 * Usage:
 *   node generateLicense.cjs --school LMB --plan standard --type permanent --devices 3
 *   node generateLicense.cjs --school CSE --plan premium --type subscription --expiry 2027-03-26 --devices 5
 */

const crypto = require("crypto");

const DEFAULT_SECRET = process.env.ECOLEOS_LICENSE_SECRET || "ecoleos_license_secret_change_me_in_production_2025";
const PLANS = ["essai", "basique", "standard", "premium"];
const TYPES = ["permanent", "subscription"];
const PLAN_MAP = { essai: "0", basique: "1", standard: "2", premium: "3" };
const TYPE_MAP = { permanent: "P", subscription: "S" };

function generateLicenseKey({ school, plan, type, devices, expiry, secret }) {
  secret = secret || DEFAULT_SECRET;

  if (!school || school.length < 2 || school.length > 6) {
    throw new Error("School code must be 2-6 characters");
  }
  if (!PLANS.includes(plan)) {
    throw new Error(`Plan must be one of: ${PLANS.join(", ")}`);
  }
  if (!TYPES.includes(type)) {
    throw new Error(`Type must be one of: ${TYPES.join(", ")}`);
  }

  const schoolCode = school.toUpperCase().padEnd(6, "0");
  const planCode = PLAN_MAP[plan];
  const typeCode = TYPE_MAP[type];
  const deviceLimit = String(Math.min(devices || 3, 99)).padStart(2, "0");

  let expiryDate;
  if (type === "permanent") {
    expiryDate = "99991231";
  } else if (expiry) {
    expiryDate = expiry.replace(/-/g, "");
  } else {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    expiryDate = d.toISOString().slice(0, 10).replace(/-/g, "");
  }

  // Payload: SCHOOL(6) + PLAN(1) + TYPE(1) + DEVICES(2) + EXPIRY(8) = 18 chars
  const payload = `${schoolCode}${planCode}${typeCode}${deviceLimit}${expiryDate}`;

  // HMAC-SHA256 signature (take first 10 bytes → 20 hex chars)
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex").toUpperCase().slice(0, 20);

  // Full payload hex (18 chars → 36 hex chars) + signature (20 hex chars) = 56 chars
  const payloadHex = Buffer.from(payload, "ascii").toString("hex").toUpperCase();
  const raw = payloadHex + hmac; // 36 + 20 = 56 chars

  // Format: ECOLEOS-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
  const groups = [];
  for (let i = 0; i < raw.length; i += 4) {
    groups.push(raw.slice(i, i + 4));
  }

  return "ECOLEOS-" + groups.join("-");
}

function decodeLicenseKey(key, secret) {
  secret = secret || DEFAULT_SECRET;

  const stripped = key.replace(/^ECOLEOS-/, "").replace(/-/g, "");
  if (stripped.length < 56) {
    return { valid: false, error: "Invalid key format" };
  }

  // First 36 hex chars = payload, next 20 hex chars = signature
  const payloadHex = stripped.slice(0, 36);
  const sigFromKey = stripped.slice(36, 56);

  let payload;
  try {
    payload = Buffer.from(payloadHex, "hex").toString("ascii");
  } catch {
    return { valid: false, error: "Invalid key encoding" };
  }

  if (payload.length !== 18) {
    return { valid: false, error: "Invalid payload length" };
  }

  const schoolCode = payload.slice(0, 6).replace(/0+$/, "");
  const planCode = payload.slice(6, 7);
  const typeCode = payload.slice(7, 8);
  const deviceLimit = parseInt(payload.slice(8, 10), 10);
  const expiryRaw = payload.slice(10, 18);

  const planReverse = { "0": "essai", "1": "basique", "2": "standard", "3": "premium" };
  const typeReverse = { P: "permanent", S: "subscription" };

  const plan = planReverse[planCode];
  const type = typeReverse[typeCode];

  if (!plan || !type) {
    return { valid: false, error: "Invalid plan or type in key" };
  }

  // Verify HMAC
  const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex").toUpperCase().slice(0, 20);
  if (sigFromKey !== expectedSig) {
    return { valid: false, error: "Invalid signature" };
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

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    opts[args[i].replace(/^--/, "")] = args[i + 1];
  }

  if (!opts.school || !opts.plan || !opts.type) {
    console.log("Usage: node generateLicense.cjs --school LMB --plan standard --type permanent [--devices 3] [--expiry 2027-03-26]");
    console.log("\n  --school   School code (2-6 chars)");
    console.log("  --plan     essai | basique | standard | premium");
    console.log("  --type     permanent | subscription");
    console.log("  --devices  Max activations (default: 3)");
    console.log("  --expiry   YYYY-MM-DD (subscription only, default: +1 year)");
    process.exit(1);
  }

  try {
    const key = generateLicenseKey({
      school: opts.school,
      plan: opts.plan,
      type: opts.type,
      devices: parseInt(opts.devices || "3", 10),
      expiry: opts.expiry,
      secret: opts.secret,
    });

    console.log("\n  License Key Generated");
    console.log("  " + "=".repeat(40));
    console.log(`  Key:     ${key}`);
    console.log(`  School:  ${opts.school.toUpperCase()}`);
    console.log(`  Plan:    ${opts.plan}`);
    console.log(`  Type:    ${opts.type}`);
    console.log(`  Devices: ${opts.devices || 3}`);
    if (opts.type === "subscription") {
      const expiry = opts.expiry || (() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); })();
      console.log(`  Expiry:  ${expiry}`);
    }
    console.log();

    const decoded = decodeLicenseKey(key, opts.secret);
    console.log("  Verification:", decoded.valid ? "OK" : "FAILED - " + decoded.error);
    if (decoded.valid) {
      console.log("  Decoded:", JSON.stringify(decoded, null, 2).split("\n").map(l => "  " + l).join("\n"));
    }
    console.log();
  } catch (err) {
    console.error("Error: " + err.message);
    process.exit(1);
  }
}

module.exports = { generateLicenseKey, decodeLicenseKey };
