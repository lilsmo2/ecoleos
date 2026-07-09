/**
 * ÉcoleOS Data Layer
 * Supports three modes: offline (localStorage), local server, cloud server.
 * In connected modes, localStorage remains the primary read source for instant UI,
 * with background sync to/from the server.
 */

const CONNECTION_KEY = "eos3_connection";
const SYNC_QUEUE_KEY = "eos3_sync_queue";

// ── Key-to-API endpoint mapping ──
function keyToEndpoint(k) {
  // Typed collections the server queries directly (login lookups, reports).
  const typed = k.match(/^eos3_(stu|stf|fin|bud|stup)_(.+)$/);
  if (typed) {
    const typeMap = {
      stu:  "students",
      stf:  "staff",
      fin:  "finances",
      bud:  "budgets",
      stup: "tuition-payments",   // student tuition payment receipts
    };
    return `/api/schools/${typed[2]}/${typeMap[typed[1]]}`;
  }
  if (k === "eos3_schools") return "/api/schools";
  // Every other per-school blob (classes, exams, incidents, cantine, books,
  // loans, payroll, timetable, grades, attendance, announcements, parent
  // access, tuition config, seating, logo) + the global super_payments list
  // round-trips through the generic key/value store.
  if (k === "eos3_super_payments") return "/api/store/eos3_super_payments";
  if (/^eos3_[a-z]+_.+$/.test(k)) return `/api/store/${k}`;
  return null;
}

// ── Connection config ──
function getConfig() {
  try {
    const raw = localStorage.getItem(CONNECTION_KEY);
    return raw ? JSON.parse(raw) : { mode: "offline", serverUrl: null, token: null, refreshToken: null };
  } catch {
    return { mode: "offline", serverUrl: null, token: null, refreshToken: null };
  }
}

function setConfig(cfg) {
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(cfg));
}

function isOnline() {
  const cfg = getConfig();
  return cfg.mode !== "offline" && cfg.serverUrl && navigator.onLine;
}

// ── API fetch helper ──
async function apiFetch(endpoint, options = {}) {
  const cfg = getConfig();
  if (!cfg.serverUrl) throw new Error("No server configured");

  const url = cfg.serverUrl.replace(/\/+$/, "") + endpoint;
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (cfg.token) headers["Authorization"] = `Bearer ${cfg.token}`;

  const res = await fetch(url, { ...options, headers });

  // Handle token refresh on 401
  if (res.status === 401 && cfg.refreshToken) {
    const refreshRes = await fetch(cfg.serverUrl.replace(/\/+$/, "") + "/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: cfg.refreshToken }),
    });
    if (refreshRes.ok) {
      const { token } = await refreshRes.json();
      setConfig({ ...cfg, token });
      headers["Authorization"] = `Bearer ${token}`;
      const retry = await fetch(url, { ...options, headers });
      return retry;
    }
  }

  return res;
}

// ── Sync queue ──
function getSyncQueue() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function addToSyncQueue(key, value) {
  const queue = getSyncQueue();
  // Replace existing entry for same key to avoid duplicates
  const idx = queue.findIndex(q => q.key === key);
  const entry = { key, value, timestamp: Date.now() };
  if (idx >= 0) queue[idx] = entry;
  else queue.push(entry);
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
}

async function processSyncQueue() {
  if (!isOnline()) return;

  const queue = getSyncQueue();
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    const endpoint = keyToEndpoint(item.key);
    if (!endpoint) { remaining.push(item); continue; }

    try {
      const res = await apiFetch("/api/sync/push", {
        method: "POST",
        body: JSON.stringify({
          key: item.key,
          endpoint,
          data: item.value,
          timestamp: item.timestamp,
        }),
      });
      if (!res.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }

  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(remaining));
}

// ── Main db object ──
export const db = {
  getConfig,
  setConfig,
  isOnline,

  async get(k) {
    try {
      // Always read from localStorage first (instant)
      const v = localStorage.getItem(k);
      const localData = v ? JSON.parse(v) : null;

      // If online, try fetching from server in background
      if (isOnline()) {
        const endpoint = keyToEndpoint(k);
        if (endpoint) {
          try {
            const res = await apiFetch(endpoint);
            if (res.ok) {
              const remote = await res.json();
              if (remote && remote.data !== undefined) {
                localStorage.setItem(k, JSON.stringify(remote.data));
                return remote.data;
              }
            }
          } catch {
            // Server unreachable — use local data
          }
        }
      }

      return localData;
    } catch {
      return null;
    }
  },

  async set(k, v) {
    try {
      const json = JSON.stringify(v);
      localStorage.setItem(k, json);

      // Queue for sync whenever a server is configured — even if we're
      // momentarily offline. The queue is flushed on reconnect (see the
      // "online" handler in App.jsx), so data created offline still uploads.
      const cfg = getConfig();
      if (cfg.mode !== "offline" && cfg.serverUrl && keyToEndpoint(k)) {
        addToSyncQueue(k, v);
        if (navigator.onLine) processSyncQueue(); // fire-and-forget
      }
    } catch {
      // Storage error
    }
  },

  // Manual sync trigger
  async sync() {
    await processSyncQueue();
  },

  // ── Server-backed auth (used in cloud/local mode) ──

  // Log a school user (admin/staff) in against the server. On success, stores
  // the JWT tokens and returns the authenticated user plus their school record.
  async serverLogin(schoolCode, username, password) {
    const cfg = getConfig();
    if (!cfg.serverUrl) return { ok: false, error: "Aucun serveur configuré" };
    const base = cfg.serverUrl.replace(/\/+$/, "");
    const res = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolCode, username, password }),
    });
    if (!res.ok) {
      let error = "Identifiant ou mot de passe incorrect";
      try { error = (await res.json()).error || error; } catch { /* noop */ }
      return { ok: false, error };
    }
    const { token, refreshToken, user } = await res.json();
    setConfig({ ...cfg, token, refreshToken });
    let school = null;
    try {
      const sres = await apiFetch("/api/schools/" + user.schoolId);
      if (sres.ok) {
        const j = await sres.json();
        school = j.data ? { ...j.data, id: j.data._id || j.data.id } : null;
      }
    } catch { /* school fetch failed; caller handles null */ }
    return { ok: true, user, school };
  },

  // Log the super admin in against the server.
  async superServerLogin(username, password) {
    const cfg = getConfig();
    if (!cfg.serverUrl) return { ok: false, error: "Aucun serveur configuré" };
    const base = cfg.serverUrl.replace(/\/+$/, "");
    const res = await fetch(base + "/api/auth/super-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      let error = "Identifiants incorrects";
      try { error = (await res.json()).error || error; } catch { /* noop */ }
      return { ok: false, error };
    }
    const { token, refreshToken, user } = await res.json();
    setConfig({ ...cfg, token, refreshToken });
    return { ok: true, user };
  },

  // Fetch the full schools list from the server (super admin only).
  async fetchSchools() {
    try {
      const res = await apiFetch("/api/schools");
      if (!res.ok) return null;
      const j = await res.json();
      return (j.data || []).map(sc => ({ ...sc, id: sc._id || sc.id }));
    } catch {
      return null;
    }
  },

  // Create/update a school on the server (super admin). Pass the plaintext
  // adminPass so the server can store a bcrypt hash for server-side login.
  async pushSchool(school, adminPass) {
    try {
      const body = {
        id: school.id,
        name: school.name,
        city: school.city,
        code: school.code,
        adminUser: school.adminUser,
        plan: school.plan,
        subEnd: school.subEnd,
        subStatus: school.subStatus,
      };
      if (adminPass) body.adminPass = adminPass;
      const res = await apiFetch("/api/schools", { method: "POST", body: JSON.stringify(body) });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Register/refresh a staff member's server login (bcrypt) so they can sign in
  // from any device. Pass the plaintext password entered in the staff form.
  async pushStaffCredential(schoolId, staffMember, password) {
    try {
      const res = await apiFetch(`/api/schools/${schoolId}/staff-credentials`, {
        method: "POST",
        body: JSON.stringify({
          id: staffMember.id,
          username: staffMember.username,
          name: staffMember.name,
          role: staffMember.role,
          password,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Get pending sync count
  getPendingSyncCount() {
    return getSyncQueue().length;
  },

  // Test server connection
  async testConnection(serverUrl) {
    try {
      const res = await fetch(serverUrl.replace(/\/+$/, "") + "/api/health", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
