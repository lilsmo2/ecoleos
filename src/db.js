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
  // eos3_stu_<schoolId> → /api/schools/<schoolId>/students
  // eos3_stf_<schoolId> → /api/schools/<schoolId>/staff
  // eos3_fin_<schoolId> → /api/schools/<schoolId>/finances
  // eos3_bud_<schoolId> → /api/schools/<schoolId>/budgets
  // eos3_att_<schoolId> → /api/schools/<schoolId>/attendance
  // eos3_grd_<schoolId> → /api/schools/<schoolId>/grades
  // eos3_dsc_<schoolId> → /api/schools/<schoolId>/discipline
  // eos3_tmt_<schoolId> → /api/schools/<schoolId>/timetable
  // eos3_msg_<schoolId> → /api/schools/<schoolId>/announcements
  // eos3_par_<schoolId> → /api/schools/<schoolId>/parentaccess
  // eos3_schools         → /api/schools
  const match = k.match(/^eos3_(stu|stf|fin|bud|att|grd|dsc|tmt|msg|par)_(.+)$/);
  if (match) {
    const typeMap = {
      stu: "students",
      stf: "staff",
      fin: "finances",
      bud: "budgets",
      att: "attendance",
      grd: "grades",
      dsc: "discipline",
      tmt: "timetable",
      msg: "announcements",
      par: "parentaccess"
    };
    return `/api/schools/${match[2]}/${typeMap[match[1]]}`;
  }
  if (k === "eos3_schools") return "/api/schools";
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

      // Queue for sync if online
      if (isOnline()) {
        addToSyncQueue(k, v);
        processSyncQueue(); // fire-and-forget
      }
    } catch {
      // Storage error
    }
  },

  // Manual sync trigger
  async sync() {
    await processSyncQueue();
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
