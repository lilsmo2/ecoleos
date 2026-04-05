#!/usr/bin/env node
/**
 * ÉcoleOS License Key Generator
 * Usage: node generate-license.js <school> <plan> <type> <devices> [expiry]
 *
 * Arguments:
 *   school   School code, max 6 chars (e.g. ECOLE1)
 *   plan     0=essai  1=basique  2=standard  3=premium
 *   type     P=permanent  S=subscription
 *   devices  Max number of devices (1-99)
 *   expiry   Expiry date YYYY-MM-DD (required if type=S)
 *
 * Examples:
 *   node generate-license.js TEST 3 P 3
 *   node generate-license.js ECOLE1 2 S 5 2027-12-31
 */

const crypto = require("crypto");

const SECRET = "ecoleos_license_secret_change_me_in_production_2025";
const PLAN_LABELS = { "0": "Essai", "1": "Basique", "2": "Standard", "3": "Premium" };

const [,, school, plan, type, devices, expiry] = process.argv;

if (!school || !plan || !type || !devices) {
  console.error("Usage: node generate-license.js <school> <plan> <type> <devices> [expiry]");
  process.exit(1);
}

if (!PLAN_LABELS[plan]) {
  console.error("Plan must be 0, 1, 2, or 3");
  process.exit(1);
}

if (type !== "P" && type !== "S") {
  console.error("Type must be P (permanent) or S (subscription)");
  process.exit(1);
}

if (type === "S" && !expiry) {
  console.error("Expiry date required for subscription type (YYYY-MM-DD)");
  process.exit(1);
}

const sc = school.toUpperCase().padEnd(6, "0").slice(0, 6);
const dev = String(Number(devices)).padStart(2, "0");
const exp = type === "P" ? "99991231" : expiry.replace(/-/g, "");
const payload = sc + plan + type + dev + exp;

if (payload.length !== 18) {
  console.error("Internal error: payload length is not 18");
  process.exit(1);
}

const payloadHex = Buffer.from(payload, "ascii").toString("hex").toUpperCase();
const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex").toUpperCase().slice(0, 20);
const full = payloadHex + sig;
const key = "ECOLEOS-" + full.match(/.{1,6}/g).join("-");

console.log("\n  ÉcoleOS License Key");
console.log("  ───────────────────────────────────────────────────");
console.log("  School  :", sc.replace(/0+$/, "") || school.toUpperCase());
console.log("  Plan    :", PLAN_LABELS[plan]);
console.log("  Type    :", type === "P" ? "Permanent" : "Subscription");
console.log("  Devices :", Number(devices));
console.log("  Expiry  :", type === "P" ? "Never" : expiry);
console.log("  ───────────────────────────────────────────────────");
console.log(" ", key);
console.log("");
