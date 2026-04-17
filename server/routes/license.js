import { Router } from "express";
import crypto from "crypto";

const router = Router();

const PLAN_REVERSE = { "0": "essai", "1": "basique", "2": "standard", "3": "premium" };
const TYPE_REVERSE = { P: "permanent", S: "subscription" };

function hexToAscii(hex) {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

// POST /api/license/verify
// Body: { key }
// Returns: { valid, school, plan, type, devices, expiry, isPermanent }
router.post("/verify", (req, res) => {
  const SECRET = process.env.ECOLEOS_LICENSE_SECRET;
  if (!SECRET || SECRET.length < 32) {
    return res.status(500).json({ valid: false, error: "License secret not configured" });
  }

  const raw = (req.body && req.body.key) || "";
  if (typeof raw !== "string") {
    return res.status(400).json({ valid: false, error: "Clé de licence requise" });
  }

  const key = raw.trim().toUpperCase();
  if (!key.startsWith("ECOLEOS-")) {
    return res.status(400).json({ valid: false, error: "Format de clé invalide" });
  }

  const stripped = key.replace(/^ECOLEOS-/, "").replace(/-/g, "");
  if (stripped.length < 56) {
    return res.status(400).json({ valid: false, error: "Clé trop courte" });
  }

  const payloadHex = stripped.slice(0, 36);
  const sigFromKey = stripped.slice(36, 56);

  let payload;
  try {
    payload = hexToAscii(payloadHex);
  } catch {
    return res.status(400).json({ valid: false, error: "Encodage de clé invalide" });
  }
  if (payload.length !== 18) {
    return res.status(400).json({ valid: false, error: "Clé corrompue" });
  }

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex")
    .toUpperCase()
    .slice(0, 20);

  // Constant-time comparison
  const a = Buffer.from(sigFromKey, "utf8");
  const b = Buffer.from(expected, "utf8");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    return res.status(401).json({ valid: false, error: "Clé invalide ou falsifiée" });
  }

  const schoolCode = payload.slice(0, 6).replace(/0+$/, "");
  const plan = PLAN_REVERSE[payload.slice(6, 7)];
  const type = TYPE_REVERSE[payload.slice(7, 8)];
  const devices = parseInt(payload.slice(8, 10), 10);
  const expiryRaw = payload.slice(10, 18);
  if (!plan || !type) {
    return res.status(400).json({ valid: false, error: "Clé invalide" });
  }

  const isPermanent = type === "permanent";
  const expiry = isPermanent
    ? null
    : `${expiryRaw.slice(0, 4)}-${expiryRaw.slice(4, 6)}-${expiryRaw.slice(6, 8)}`;

  res.json({
    valid: true,
    school: schoolCode,
    plan,
    type,
    devices,
    expiry,
    isPermanent,
  });
});

export default router;
