import { useState, useEffect, useCallback, useMemo } from "react";
import { activateLicense, verifyStoredLicense } from "./lib/license.js";
import { db } from "./db.js";

// ── Password hashing (SHA-256 based, client-side) ──
async function hashPassword(plain) {
  const enc = new TextEncoder().encode(plain + "::ecoleos_salt_2025");
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(plain, hash) {
  return (await hashPassword(plain)) === hash;
}

// ── ID generation ──
const genId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

// ── Constants (hoisted outside component) ──
const PLANS = {
  essai:    { name: "Essai",    priceMonth: 0,     priceYear: 0,      maxStudents: 30,   features: ["Jusqu'à 30 élèves", "Accès limité"] },
  basique:  { name: "Basique",  priceMonth: 15000, priceYear: 165000, maxStudents: 100,  features: ["Jusqu'à 100 élèves", "Toutes les fonctions de base"] },
  standard: { name: "Standard", priceMonth: 25000, priceYear: 250000, maxStudents: 300,  features: ["Jusqu'à 300 élèves", "Rapports avancés"] },
  premium:  { name: "Premium",  priceMonth: 35000, priceYear: 400000, maxStudents: null, features: ["Élèves illimités", "Support prioritaire"] },
};
const NIV = ["Petite Section", "Moyenne Section", "Grande Section", "CP", "CE1", "CE2", "CM1", "CM2", "6ème", "5ème", "4ème", "3ème", "Seconde", "Première", "Terminale"];
const ROLES = { admin: "Administrateur/Administratrice", directeur: "Directeur/Directrice", secretaire: "Secrétaire", enseignant: "Prof", titulaire: "Enseignant/Enseignante", comptable: "Comptable", autre: "Autre" };
const fmtCFA = n => new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
const FIN_CATEGORIES = {
  income: ["Frais de scolarité", "Frais d'inscription", "Cantine", "Transport", "Activités", "Autre revenu"],
  expense: ["Salaires", "Fournitures", "Maintenance", "Électricité / Eau", "Loyer", "Équipement", "Autre dépense"],
};
const FIN_MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
const BUDGET_CATEGORIES = {
  income: ["Frais de scolarité", "Frais d'inscription", "Cantine", "Transport", "Activités", "Subventions", "Autre revenu"],
  expense: ["Salaires", "Fournitures", "Maintenance", "Électricité / Eau", "Loyer", "Équipement", "Formation", "Autre dépense"],
};
const SUBJECTS = ["Mathématiques", "Français", "Sciences", "Histoire-Géo", "Anglais", "Physique-Chimie", "SVT", "EPS", "Arts", "Informatique", "Philosophie", "Autre"];
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const TERMS = ["1er Trimestre", "2ème Trimestre", "3ème Trimestre"];
const INCIDENT_TYPES = ["Absence injustifiée", "Retard répété", "Insolence", "Violence", "Triche", "Autre"];
const SANCTIONS = ["Avertissement", "Blâme", "Exclusion temporaire", "Convocation parents", "Renvoi définitif"];

const INIT_SCHOOLS = [
  { id: "sc1", name: "Lycée Mariama Bâ", city: "Dakar", code: "LMB", adminUser: "admin", adminPassHash: null, plan: "standard", subEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), subStatus: "actif" },
  { id: "sc2", name: "Collège Saint-Exupéry", city: "Abidjan", code: "CSE", adminUser: "admin", adminPassHash: null, plan: "essai", subEnd: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10), subStatus: "expiré" },
];

const SEED_STU = [
  { id: "s1", name: "Amara Diallo", grade: "Seconde", parent: "Mamadou Diallo", status: "actif" },
  { id: "s2", name: "Lucas Martin", grade: "Seconde", parent: "Sophie Martin", status: "actif" },
  { id: "s3", name: "Chloé Dubois", grade: "Première", parent: "Pierre Dubois", status: "actif" },
  { id: "s4", name: "Théo Bernard", grade: "Troisième", parent: "Claire Bernard", status: "actif" },
  { id: "s5", name: "Inès Moreau", grade: "Terminale", parent: "Karim Moreau", status: "actif" },
];

const NAV_PAGES = [
  { k: "dash", l: "Tableau de Bord", icon: "◈", roles: ["admin", "directeur", "secretaire", "enseignant", "comptable"] },
  { k: "stu", l: "Élèves", icon: "◎", roles: ["admin", "directeur", "secretaire"] },
  { k: "staff", l: "Personnel", icon: "◉", roles: ["admin", "secretaire"] },
  { k: "fin", l: "Finances", icon: "◆", roles: ["admin", "comptable"] },
  { k: "budget", l: "Budget", icon: "◇", roles: ["admin"] },
  { k: "cls", l: "Classes", icon: "⊞", roles: ["admin", "directeur", "secretaire"] },
  { k: "att", l: "Présences", icon: "✓", roles: ["admin", "directeur", "secretaire", "enseignant"] },
  { k: "grades", l: "Notes", icon: "✎", roles: ["admin", "directeur", "enseignant"] },
  { k: "tmt", l: "Emploi du temps", icon: "⊟", roles: ["admin", "directeur", "secretaire", "enseignant"] },
  { k: "exams", l: "Examens", icon: "⊗", roles: ["admin", "directeur", "secretaire", "enseignant"] },
  { k: "disc", l: "Discipline", icon: "⊘", roles: ["admin", "directeur", "secretaire"] },
  { k: "docs", l: "Documents", icon: "⊕", roles: ["admin", "secretaire"] },
  { k: "cant", l: "Cantine", icon: "⊙", roles: ["admin", "secretaire", "comptable"] },
  { k: "lib", l: "Bibliothèque", icon: "⊚", roles: ["admin", "secretaire"] },
  { k: "msg", l: "Annonces", icon: "⊛", roles: ["admin", "directeur", "secretaire", "enseignant", "comptable"] },
  { k: "pay", l: "Paiements", icon: "💳", roles: ["admin", "comptable", "secretaire", "directeur"] },
  { k: "sub", l: "Abonnement", icon: "◈", roles: ["admin"] },
];

// ── Styles (hoisted outside component) ──
const S = {
  page: { minHeight: "100vh", background: "#0F1117", color: "#E8EAF0", fontFamily: "'Segoe UI',system-ui,sans-serif" },
  center: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" },
  card: { background: "#161822", border: "1px solid #2A2E42", borderRadius: 16, padding: 40, width: 420, maxWidth: "90vw" },
  input: { width: "100%", padding: "10px 14px", background: "#1C1F2E", border: "1px solid #2A2E42", borderRadius: 6, color: "#E8EAF0", fontSize: 14, outline: "none", marginTop: 6, boxSizing: "border-box" },
  label: { fontSize: 12, color: "#636985", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 },
  btn: { padding: "10px 20px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14 },
  primary: { background: "#6C5CE7", color: "#fff" },
  ghost: { background: "transparent", color: "#9BA1B7", border: "1px solid #2A2E42" },
  danger: { background: "rgba(255,107,107,0.12)", color: "#FF6B6B" },
  success: { background: "rgba(0,184,148,0.12)", color: "#00B894" },
  err: { background: "rgba(255,107,107,0.12)", color: "#FF6B6B", padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16 },
  sidebar: { width: 260, background: "#161822", borderRight: "1px solid #2A2E42", position: "fixed", top: 0, left: 0, bottom: 0, display: "flex", flexDirection: "column", zIndex: 100, transition: "transform 0.3s ease" },
  sidebarHidden: { transform: "translateX(-260px)" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 99 },
  main: { marginLeft: 260, flex: 1, minHeight: "100vh", display: "flex", flexDirection: "column", transition: "margin-left 0.3s ease" },
  mainFull: { marginLeft: 0 },
  topbar: { height: 64, borderBottom: "1px solid #2A2E42", display: "flex", alignItems: "center", padding: "0 32px", background: "#0F1117", gap: 16 },
  content: { flex: 1, padding: "28px 32px" },
  navItem: (active) => ({ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 500, color: active ? "#A29BFE" : "#9BA1B7", background: active ? "rgba(108,92,231,0.12)" : "transparent", marginBottom: 2 }),
  badge: (color) => ({ display: "inline-flex", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: color === "green" ? "rgba(0,184,148,0.12)" : color === "red" ? "rgba(255,107,107,0.12)" : color === "amber" ? "rgba(253,203,110,0.12)" : "rgba(108,92,231,0.12)", color: color === "green" ? "#00B894" : color === "red" ? "#FF6B6B" : color === "amber" ? "#FDCB6E" : "#A29BFE" }),
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "12px 20px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "#636985", borderBottom: "1px solid #2A2E42", fontWeight: 600 },
  td: { padding: "12px 20px", fontSize: 13, borderBottom: "1px solid #2A2E42", color: "#9BA1B7" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 },
  modalCard: { background: "#161822", border: "1px solid #2A2E42", borderRadius: 12, width: "90%", maxWidth: 500, maxHeight: "85vh", overflow: "auto" },
  stat: { background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 20 },
  search: { display: "flex", alignItems: "center", gap: 8, background: "#1C1F2E", border: "1px solid #2A2E42", borderRadius: 6, padding: "6px 12px", flex: 1, maxWidth: 320 },
  searchInput: { background: "transparent", border: "none", outline: "none", color: "#E8EAF0", fontSize: 13, flex: 1 },
  empty: { textAlign: "center", padding: 48, color: "#636985" },
  spinner: { display: "inline-block", width: 20, height: 20, border: "2px solid #2A2E42", borderTopColor: "#6C5CE7", borderRadius: "50%", animation: "spin 0.6s linear infinite" },
};

// ── Shared components ──
const Field = ({ label, value, onChange, type, placeholder, style: s2, onKeyDown, disabled }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={S.label}>{label}</div>
    <input style={{ ...S.input, ...s2, opacity: disabled ? 0.5 : 1 }} type={type || "text"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} onKeyDown={onKeyDown} disabled={disabled} />
  </div>
);

const Btn = ({ children, variant, onClick, full, small, disabled, loading }) => (
  <button
    style={{
      ...S.btn,
      ...(variant === "ghost" ? S.ghost : variant === "danger" ? S.danger : variant === "success" ? S.success : S.primary),
      width: full ? "100%" : "auto",
      padding: small ? "6px 12px" : undefined,
      fontSize: small ? 12 : undefined,
      opacity: disabled || loading ? 0.6 : 1,
      pointerEvents: disabled || loading ? "none" : "auto",
    }}
    onClick={onClick}
    disabled={disabled || loading}
  >
    {loading ? "..." : children}
  </button>
);

const Modal2 = ({ title, onClose, children, footer }) => (
  <div style={S.modal} onClick={onClose}>
    <div style={S.modalCard} onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #2A2E42" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <button style={{ ...S.btn, ...S.ghost, padding: "4px 8px" }} onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
      {footer && <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 24px", borderTop: "1px solid #2A2E42" }}>{footer}</div>}
    </div>
  </div>
);

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
  <Modal2 title="Confirmation" onClose={onCancel} footer={
    <div style={{ display: "flex", gap: 8 }}>
      <Btn variant="ghost" onClick={onCancel}>Annuler</Btn>
      <Btn variant="danger" onClick={onConfirm}>Confirmer</Btn>
    </div>
  }>
    <p style={{ color: "#9BA1B7", lineHeight: 1.6, margin: 0, whiteSpace: "pre-line" }}>{message}</p>
  </Modal2>
);

const EmptyState = ({ icon, title, subtitle }) => (
  <div style={S.empty}>
    <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>{icon || "○"}</div>
    <div style={{ fontSize: 15, fontWeight: 500, color: "#9BA1B7", marginBottom: 6 }}>{title}</div>
    {subtitle && <div style={{ fontSize: 12, color: "#636985" }}>{subtitle}</div>}
  </div>
);

const SearchBar = ({ value, onChange, placeholder }) => (
  <div style={S.search}>
    <span style={{ color: "#636985", fontSize: 14 }}>⌕</span>
    <input style={S.searchInput} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || "Rechercher..."} />
    {value && <span style={{ color: "#636985", fontSize: 12, cursor: "pointer" }} onClick={() => onChange("")}>✕</span>}
  </div>
);

// ── CSS keyframes (injected once) ──
// eslint-disable-next-line no-unused-vars
const _injectStyles = typeof document !== "undefined" && (() => {
  const el = document.createElement("style");
  el.textContent = `
    html, body, #root {
      background: #0F1117 \!important;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 1024px) {
      .eos-card-grid { grid-template-columns: repeat(2, 1fr) \!important; }
      .eos-stat-grid { grid-template-columns: repeat(2, 1fr) \!important; }
      body { overflow-x: hidden \!important; }
    }
    @media (max-width: 768px) {
      .eos-sidebar { transform: translateX(-260px) \!important; }
      .eos-sidebar.open { transform: translateX(0) \!important; }
      .eos-main { margin-left: 0 \!important; }
      .eos-topbar { padding: 0 16px \!important; }
      .eos-content { padding: 16px \!important; overflow-x: hidden \!important; }
      .eos-super-grid { grid-template-columns: 1fr \!important; }
      .eos-plan-grid { grid-template-columns: 1fr \!important; }
      .eos-card-grid { grid-template-columns: 1fr \!important; }
      .eos-stat-grid { grid-template-columns: 1fr \!important; }
      .eos-table { display: block \!important; overflow-x: auto \!important; }
      .eos-table table { width: 100% \!important; }
      .eos-modal-card { width: 95% \!important; max-height: 90vh \!important; }
      body { overflow-x: hidden \!important; }
      * { max-width: 100% \!important; }
    }
    @media (max-width: 480px) {
      .eos-topbar { padding: 0 12px \!important; height: 56px \!important; }
      .eos-content { padding: 12px \!important; }
      .eos-plan-grid { grid-template-columns: 1fr \!important; }
      .eos-card { padding: 16px \!important; width: 100% \!important; max-width: 100% \!important; }
      input, button, select, textarea { font-size: 16px \!important; }
      .eos-modal-card { padding: 20px 16px \!important; }
      body { overflow-x: hidden \!important; }
    }
  `;
  document.head.appendChild(el);
  return el;
})();

// ══════════════════════════════════════════════════
export default function App() {
  const [step, setStep] = useState("license"); // starts with license check
  const [schools, setSchools] = useState([]);
  const [school, setSchool] = useState(null);
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dash");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // license
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseErr, setLicenseErr] = useState("");
  const [licenseInfo, setLicenseInfo] = useState(null); // { school, plan, type, status, graceDaysLeft }
  const [licenseGrace, setLicenseGrace] = useState(null); // grace period warning

  // login form
  const [code, setCode] = useState("");
  const [uid, setUid] = useState("");
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [superMode, setSuperMode] = useState(false);
  const [su, setSu] = useState("");
  const [sp, setSp] = useState("");
  const [superErr, setSuperErr] = useState("");

  // super admin
  const [createMode, setCreateMode] = useState(false);
  const [cf, setCf] = useState({ name: "", city: "", code: "", adminUser: "admin", adminPass: "", plan: "essai" });
  const [cErr, setCErr] = useState("");

  // school data
  const [students, setStudents] = useState([]);
  const [staff, setStaff] = useState([]);
  const [finances, setFinances] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());
  const [classes, setClasses] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [grades, setGrades] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [exams, setExams] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [cantine, setCantine] = useState([]);
  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [messages, setMessages] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [studentPayments, setStudentPayments] = useState([]);
  const [classTuition, setClassTuition] = useState({}); // { [grade]: amountDue }
  const [parentCodes, setParentCodes] = useState([]);

  // super admin finances
  const [superPayments, setSuperPayments] = useState([]);
  const [superFinPage, setSuperFinPage] = useState("schools"); // "schools" | "finances" | "licences"
  const [licForm, setLicForm] = useState({ school: "", plan: "3", type: "P", devices: "3", expiry: new Date(Date.now() + 365*86400000).toISOString().slice(0,10), generated: "", copied: false });

  // modals & forms
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [search, setSearch] = useState("");

  // connection
  const [connStatus, setConnStatus] = useState("offline"); // "offline" | "connected" | "syncing" | "error"
  const [connConfig, setConnConfig] = useState(db.getConfig());

  // responsive sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // ── Init: check license, then load schools ──
  useEffect(() => {
    (async () => {
      // 1. Check license first
      const licResult = await verifyStoredLicense();
      if (licResult.valid) {
        setLicenseInfo(licResult.license);
        if (licResult.status === "grace") {
          setLicenseGrace(licResult.graceDaysLeft);
        }
        setStep("login");
      } else if (licResult.status === "expired") {
        setLicenseInfo(licResult.license);
        setStep("license_expired");
        setLoading(false);
        return;
      } else {
        // No license or invalid — show activation screen
        setStep("license");
        setLoading(false);
        return;
      }

      // 2. Load schools data
      const saved = await db.get("eos3_schools");
      if (saved) {
        setSchools(saved);
      } else {
        const defaultHash = await hashPassword("admin123");
        const initialized = INIT_SCHOOLS.map(s => ({ ...s, adminPassHash: defaultHash }));
        setSchools(initialized);
        await db.set("eos3_schools", initialized);
      }
      const sp = await db.get("eos3_super_payments");
      if (sp) setSuperPayments(sp);

      // 3. Try to restore session from localStorage
      const saved_session = localStorage.getItem("eos3_session");
      if (saved_session) {
        try {
          const session = JSON.parse(saved_session);
          if (session.user && session.step === "app") {
            // Session found, restore it
            setUser(session.user);
            if (session.schoolId) {
              const school_to_restore = saved.find(s => s.id === session.schoolId);
              if (school_to_restore) {
                setSchool(school_to_restore);
                await loadSchool(session.schoolId);
                setStep("app");
                setPage("dash");
                setLoading(false);
                return;
              }
            }
          } else if (session.user && session.step === "super") {
            // Super admin session found
            setUser(session.user);
            setStep("super");
            setLoading(false);
            return;
          }
        } catch (e) {
          // Invalid session data, ignore and proceed to login
          localStorage.removeItem("eos3_session");
        }
      }

      setLoading(false);
    })();
  }, []);

  // ── License activation ──
  const doActivateLicense = useCallback(async () => {
    if (!licenseKey.trim()) { setLicenseErr("Entrez votre clé de licence"); return; }
    setLoading(true);
    setLicenseErr("");
    const result = await activateLicense(licenseKey);
    if (!result.success) {
      setLicenseErr(result.error);
      setLoading(false);
      return;
    }
    setLicenseInfo(result.license);
    // Now load schools
    const saved = await db.get("eos3_schools");
    if (saved) {
      setSchools(saved);
    } else {
      const defaultHash = await hashPassword("admin123");
      const initialized = INIT_SCHOOLS.map(s => ({ ...s, adminPassHash: defaultHash }));
      setSchools(initialized);
      await db.set("eos3_schools", initialized);
    }
    const sp = await db.get("eos3_super_payments");
    if (sp) setSuperPayments(sp);
    setStep("login");
    setLoading(false);
  }, [licenseKey]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const saveSchools = useCallback(async (list) => {
    setSaving(true);
    setSchools(list);
    await db.set("eos3_schools", list);
    setSaving(false);
  }, []);

  const sk = school ? school.id : "";

  const saveStu = useCallback(async (list) => {
    setSaving(true);
    setStudents(list);
    await db.set("eos3_stu_" + sk, list);
    setSaving(false);
  }, [sk]);

  const saveStaff = useCallback(async (list) => {
    setSaving(true);
    setStaff(list);
    await db.set("eos3_stf_" + sk, list);
    setSaving(false);
  }, [sk]);

  const saveFin = useCallback(async (list) => {
    setSaving(true);
    setFinances(list);
    await db.set("eos3_fin_" + sk, list);
    setSaving(false);
  }, [sk]);

  const saveBudgets = useCallback(async (list) => {
    setSaving(true);
    setBudgets(list);
    await db.set("eos3_bud_" + sk, list);
    setSaving(false);
  }, [sk]);
  const saveClasses = useCallback(async (list) => { setSaving(true); setClasses(list); await db.set("eos3_cls_" + sk, list); setSaving(false); }, [sk]);
  const saveAttendance = useCallback(async (list) => { setSaving(true); setAttendance(list); await db.set("eos3_att_" + sk, list); setSaving(false); }, [sk]);
  const saveGrades = useCallback(async (list) => { setSaving(true); setGrades(list); await db.set("eos3_grd_" + sk, list); setSaving(false); }, [sk]);
  const saveTimetable = useCallback(async (list) => { setSaving(true); setTimetable(list); await db.set("eos3_tmt_" + sk, list); setSaving(false); }, [sk]);
  const saveExams = useCallback(async (list) => { setSaving(true); setExams(list); await db.set("eos3_exm_" + sk, list); setSaving(false); }, [sk]);
  const saveIncidents = useCallback(async (list) => { setSaving(true); setIncidents(list); await db.set("eos3_inc_" + sk, list); setSaving(false); }, [sk]);
  const saveCantine = useCallback(async (list) => { setSaving(true); setCantine(list); await db.set("eos3_can_" + sk, list); setSaving(false); }, [sk]);
  const saveBooks = useCallback(async (list) => { setSaving(true); setBooks(list); await db.set("eos3_bks_" + sk, list); setSaving(false); }, [sk]);
  const saveLoans = useCallback(async (list) => { setSaving(true); setLoans(list); await db.set("eos3_lns_" + sk, list); setSaving(false); }, [sk]);
  const saveMessages = useCallback(async (list) => { setSaving(true); setMessages(list); await db.set("eos3_msg_" + sk, list); setSaving(false); }, [sk]);
  const savePayroll = useCallback(async (list) => { setSaving(true); setPayroll(list); await db.set("eos3_prl_" + sk, list); setSaving(false); }, [sk]);
  const saveStudentPayments = useCallback(async (list) => { setSaving(true); setStudentPayments(list); await db.set("eos3_stup_" + sk, list); setSaving(false); }, [sk]);
  const saveClassTuition = useCallback(async (obj) => { setSaving(true); setClassTuition(obj); await db.set("eos3_tuition_" + sk, obj); setSaving(false); }, [sk]);
  const saveParentCodes = useCallback(async (list) => { setSaving(true); setParentCodes(list); await db.set("eos3_par_" + sk, list); setSaving(false); }, [sk]);

  const saveSuperPayments = useCallback(async (list) => {
    setSaving(true);
    setSuperPayments(list);
    await db.set("eos3_super_payments", list);
    setSaving(false);
  }, []);

  const loadSchool = useCallback(async (id) => {
    setLoading(true);
    const s = await db.get("eos3_stu_" + id);
    setStudents(s || SEED_STU);
    const st = await db.get("eos3_stf_" + id);
    setStaff(st || []);
    const fn = await db.get("eos3_fin_" + id);
    setFinances(fn || []);
    const bd = await db.get("eos3_bud_" + id);
    setBudgets(bd || []);
    const cl = await db.get("eos3_cls_" + id); setClasses(cl || []);
    const at = await db.get("eos3_att_" + id); setAttendance(at || []);
    const gr = await db.get("eos3_grd_" + id); setGrades(gr || []);
    const tm = await db.get("eos3_tmt_" + id); setTimetable(tm || []);
    const ex = await db.get("eos3_exm_" + id); setExams(ex || []);
    const inc = await db.get("eos3_inc_" + id); setIncidents(inc || []);
    const can = await db.get("eos3_can_" + id); setCantine(can || []);
    const bks = await db.get("eos3_bks_" + id); setBooks(bks || []);
    const lns = await db.get("eos3_lns_" + id); setLoans(lns || []);
    const msg = await db.get("eos3_msg_" + id); setMessages(msg || []);
    const prl = await db.get("eos3_prl_" + id); setPayroll(prl || []);
    const stup = await db.get("eos3_stup_" + id); setStudentPayments(stup || []);
    const tuit = await db.get("eos3_tuition_" + id); setClassTuition(tuit || {});
    const par = await db.get("eos3_par_" + id); setParentCodes(par || []);
    setLoading(false);
  }, []);

  // ── Auth ──
  const doLogin = useCallback(async () => {
    if (!code || !uid || !pwd) { setErr("Remplissez tous les champs"); return; }
    setLoading(true);
    const sc = schools.find(s => s.code.toLowerCase() === code.trim().toLowerCase());
    if (!sc) { setErr("Code introuvable"); setLoading(false); return; }
    setSchool(sc);
    const dl = Math.ceil((new Date(sc.subEnd) - new Date()) / 86400000);
    const expired = dl <= 0 || sc.subStatus === "suspendu";

    // Admin login
    if (uid === sc.adminUser) {
      let match = false;
      try {
        if (sc.adminPassHash) {
          match = await verifyPassword(pwd, sc.adminPassHash);
        } else {
          // Legacy fallback: plaintext adminPass or default
          match = pwd === (sc.adminPass || "admin123");
        }
      } catch (e) {
        match = pwd === (sc.adminPass || "admin123");
      }
      if (match) {
        setUser({ name: "Administrateur", role: "admin" });
        if (expired) { setStep("blocked"); setLoading(false); return; }
        await loadSchool(sc.id);
        localStorage.setItem("eos3_session", JSON.stringify({ user: { name: "Administrateur", role: "admin" }, schoolId: sc.id, step: "app" }));
        setStep("app"); setPage("dash"); setLoading(false); return;
      }
    }

    // Staff login
    const stf = await db.get("eos3_stf_" + sc.id) || [];
    const m = stf.find(s => s.username === uid && s.status === "actif");
    if (m) {
      let match = false;
      try {
        match = m.passHash ? await verifyPassword(pwd, m.passHash) : pwd === m.password;
      } catch (e) {
        match = pwd === m.password;
      }
      if (match) {
        setUser({ name: m.name, role: m.role });
        if (expired) { setStep("blocked"); setLoading(false); return; }
        await loadSchool(sc.id);
        localStorage.setItem("eos3_session", JSON.stringify({ user: { name: m.name, role: m.role }, schoolId: sc.id, step: "app" }));
        setStep("app"); setPage("dash"); setLoading(false); return;
      }
    }
    setErr("Identifiant ou mot de passe incorrect");
    setLoading(false);
  }, [code, uid, pwd, schools, loadSchool]);

  const doSuper = useCallback(async () => {
    setLoading(true);
    // Check stored super hash, or verify against default
    const stored = await db.get("eos3_super_hash");
    if (stored) {
      const ok = await verifyPassword(sp, stored);
      if (su === "superadmin" && ok) { localStorage.setItem("eos3_session", JSON.stringify({ user: { name: "Super Admin", role: "super" }, schoolId: null, step: "super" })); setStep("super"); setLoading(false); return; }
    } else {
      // First time: accept default and store hash
      if (su === "superadmin" && sp === "super2025") {
        const h = await hashPassword("super2025");
        await db.set("eos3_super_hash", h);
        localStorage.setItem("eos3_session", JSON.stringify({ user: { name: "Super Admin", role: "super" }, schoolId: null, step: "super" }));
        setStep("super"); setLoading(false); return;
      }
    }
    setSuperErr("Identifiants incorrects");
    setLoading(false);
  }, [su, sp]);

  const logout = useCallback(() => {
    localStorage.removeItem("eos3_session");
    setStep("login"); setSchool(null); setUser(null); setErr(""); setCode(""); setUid(""); setPwd(""); setSearch("");
    setSu(""); setSp(""); setSuperMode(false); setSuperErr("");
  }, []);

  // ── Confirm helper ──
  const askConfirm = useCallback((message, action) => {
    setConfirm({ message, action });
  }, []);

  const runConfirm = useCallback(() => {
    if (confirm?.action) confirm.action();
    setConfirm(null);
  }, [confirm]);

  // ── Filtered lists (must be before early returns — hooks rules) ──
  const filteredStudents = useMemo(() => {
    if (!search) return students;
    const q = search.toLowerCase();
    return students.filter(s => s.name.toLowerCase().includes(q) || s.grade.toLowerCase().includes(q) || (s.parent || "").toLowerCase().includes(q));
  }, [students, search]);

  const filteredStaff = useMemo(() => {
    if (!search) return staff;
    const q = search.toLowerCase();
    return staff.filter(s => s.name.toLowerCase().includes(q) || s.username.toLowerCase().includes(q) || (ROLES[s.role] || "").toLowerCase().includes(q));
  }, [staff, search]);

  const filteredFinances = useMemo(() => {
    if (!search) return finances;
    const q = search.toLowerCase();
    return finances.filter(t => t.label.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.type.toLowerCase().includes(q));
  }, [finances, search]);

  const finTotals = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const income = finances.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
    const expense = finances.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);
    const monthIncome = finances.filter(t => t.type === "income" && t.date?.startsWith(thisMonth)).reduce((a, t) => a + t.amount, 0);
    const monthExpense = finances.filter(t => t.type === "expense" && t.date?.startsWith(thisMonth)).reduce((a, t) => a + t.amount, 0);
    return { income, expense, balance: income - expense, monthIncome, monthExpense, monthBalance: monthIncome - monthExpense };
  }, [finances]);

  const budgetData = useMemo(() => {
    const yearBudgets = budgets.filter(b => b.year === budgetYear);
    const plannedIncome = yearBudgets.filter(b => b.type === "income").reduce((a, b) => a + b.planned, 0);
    const plannedExpense = yearBudgets.filter(b => b.type === "expense").reduce((a, b) => a + b.planned, 0);
    const yearPrefix = String(budgetYear);
    const yearFinances = finances.filter(t => t.date?.startsWith(yearPrefix));
    const actualIncome = yearFinances.filter(t => t.type === "income").reduce((a, t) => a + t.amount, 0);
    const actualExpense = yearFinances.filter(t => t.type === "expense").reduce((a, t) => a + t.amount, 0);

    // Per-category budget vs actual
    const allCats = [...BUDGET_CATEGORIES.income, ...BUDGET_CATEGORIES.expense];
    const byCat = allCats.map(cat => {
      const type = BUDGET_CATEGORIES.income.includes(cat) ? "income" : "expense";
      const planned = yearBudgets.filter(b => b.category === cat).reduce((a, b) => a + b.planned, 0);
      const actual = yearFinances.filter(t => t.category === cat).reduce((a, t) => a + t.amount, 0);
      const diff = actual - planned;
      return { cat, type, planned, actual, diff, overBudget: type === "expense" ? diff > 0 && planned > 0 : false };
    }).filter(c => c.planned > 0 || c.actual > 0);

    const overBudgetItems = byCat.filter(c => c.overBudget);

    // Per-month breakdown
    const byMonth = FIN_MONTHS.map((m, i) => {
      const prefix = budgetYear + "-" + String(i + 1).padStart(2, "0");
      const mPlannedInc = yearBudgets.filter(b => b.month === prefix && b.type === "income").reduce((a, b) => a + b.planned, 0);
      const mPlannedExp = yearBudgets.filter(b => b.month === prefix && b.type === "expense").reduce((a, b) => a + b.planned, 0);
      const mActualInc = yearFinances.filter(t => t.type === "income" && t.date?.startsWith(prefix)).reduce((a, t) => a + t.amount, 0);
      const mActualExp = yearFinances.filter(t => t.type === "expense" && t.date?.startsWith(prefix)).reduce((a, t) => a + t.amount, 0);
      return { month: m, prefix, plannedInc: mPlannedInc, plannedExp: mPlannedExp, actualInc: mActualInc, actualExp: mActualExp };
    });

    return { plannedIncome, plannedExpense, plannedBalance: plannedIncome - plannedExpense, actualIncome, actualExpense, byCat, overBudgetItems, byMonth };
  }, [budgets, finances, budgetYear]);

  const filteredBudgets = useMemo(() => {
    const yearBuds = budgets.filter(b => b.year === budgetYear);
    if (!search) return yearBuds;
    const q = search.toLowerCase();
    return yearBuds.filter(b => b.category.toLowerCase().includes(q) || b.type.toLowerCase().includes(q) || (b.note || "").toLowerCase().includes(q) || (b.activity || "").toLowerCase().includes(q));
  }, [budgets, budgetYear, search]);

  // ── Export / Import ──
  const exportSchoolData = useCallback(() => {
    const data = {
      exportVersion: 1,
      exportDate: new Date().toISOString(),
      schoolId: school?.id,
      schoolName: school?.name,
      schoolCode: school?.code,
      data: {
        school: { ...school },
        students,
        staff: staff.map(s => ({ ...s, passHash: undefined, password: undefined })),
        finances,
        budgets,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ecoleos_${school?.code || "export"}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [school, students, staff, finances, budgets]);

  const importSchoolData = useCallback(async (file, mode) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.exportVersion || !data.data) {
        setErr("Fichier invalide : format non reconnu");
        return false;
      }
      const d = data.data;
      if (mode === "replace") {
        if (d.students) await saveStu(d.students);
        if (d.staff) await saveStaff(d.staff);
        if (d.finances) await saveFin(d.finances);
        if (d.budgets) await saveBudgets(d.budgets);
      } else {
        if (d.students) {
          const merged = [...students];
          for (const s of d.students) {
            const idx = merged.findIndex(x => x.id === s.id);
            if (idx >= 0) merged[idx] = { ...merged[idx], ...s };
            else merged.push(s);
          }
          await saveStu(merged);
        }
        if (d.staff) {
          const merged = [...staff];
          for (const s of d.staff) {
            const idx = merged.findIndex(x => x.id === s.id);
            if (idx >= 0) merged[idx] = { ...merged[idx], ...s };
            else merged.push(s);
          }
          await saveStaff(merged);
        }
        if (d.finances) {
          const merged = [...finances];
          for (const t of d.finances) {
            const idx = merged.findIndex(x => x.id === t.id);
            if (idx >= 0) merged[idx] = { ...merged[idx], ...t };
            else merged.push(t);
          }
          await saveFin(merged);
        }
        if (d.budgets) {
          const merged = [...budgets];
          for (const b of d.budgets) {
            const idx = merged.findIndex(x => x.id === b.id);
            if (idx >= 0) merged[idx] = { ...merged[idx], ...b };
            else merged.push(b);
          }
          await saveBudgets(merged);
        }
      }
      return true;
    } catch {
      return false;
    }
  }, [students, staff, finances, budgets, saveStu, saveStaff, saveFin, saveBudgets]);

  const handleImportFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.exportVersion || !data.data) {
          setForm({ importError: "Fichier invalide" });
          return;
        }
        const d = data.data;
        setForm({
          importFile: file,
          importData: data,
          importMode: "replace",
          importError: null,
          importSummary: {
            school: data.schoolName || "—",
            students: d.students?.length || 0,
            staff: d.staff?.length || 0,
            finances: d.finances?.length || 0,
            budgets: d.budgets?.length || 0,
          },
        });
        setModal("importData");
      } catch {
        setForm({ importError: "Fichier JSON invalide" });
        setModal("importData");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const doImport = useCallback(async () => {
    if (!form.importFile) return;
    setSaving(true);
    const ok = await importSchoolData(form.importFile, form.importMode);
    setSaving(false);
    if (ok) {
      setModal(null);
    } else {
      setForm(f => ({ ...f, importError: "Erreur lors de l'importation" }));
    }
  }, [form, importSchoolData]);

  // ── Connection management ──
  const saveConnection = useCallback(async (cfg) => {
    db.setConfig(cfg);
    setConnConfig(cfg);
    if (cfg.mode === "offline") {
      setConnStatus("offline");
    } else {
      setConnStatus("syncing");
      const ok = await db.testConnection(cfg.serverUrl);
      setConnStatus(ok ? "connected" : "error");
    }
    setModal(null);
  }, []);

  const testServerConnection = useCallback(async () => {
    if (!form.serverUrl) return;
    setForm(f => ({ ...f, testResult: "testing" }));
    const ok = await db.testConnection(form.serverUrl);
    setForm(f => ({ ...f, testResult: ok ? "ok" : "fail" }));
  }, [form.serverUrl]);

  useEffect(() => {
    const cfg = db.getConfig();
    if (cfg.mode !== "offline" && cfg.serverUrl) {
      db.testConnection(cfg.serverUrl).then(ok => setConnStatus(ok ? "connected" : "error"));
    }
    const goOnline = () => {
      const c = db.getConfig();
      if (c.mode !== "offline" && c.serverUrl) {
        setConnStatus("syncing");
        db.sync().then(() => db.testConnection(c.serverUrl)).then(ok => setConnStatus(ok ? "connected" : "error"));
      }
    };
    const goOffline = () => {
      if (db.getConfig().mode !== "offline") setConnStatus("error");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // ══════════════ LOADING SCREEN ══════════════
  if (loading && (step === "license" || (step === "login" && schools.length === 0))) {
    return (
      <div style={{ ...S.page, ...S.center }}>
        <div style={{ textAlign: "center" }}>
          <div style={S.spinner} />
          <div style={{ marginTop: 16, color: "#636985", fontSize: 13 }}>Chargement...</div>
        </div>
      </div>
    );
  }

  // ══════════════ LICENSE ACTIVATION ══════════════
  if (step === "license") {
    const enterLicense = e => { if (e.key === "Enter") doActivateLicense(); };
    return (
      <div style={{ ...S.page, ...S.center }}>
        <div style={S.card}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg,#6C5CE7,#a29bfe)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 26, color: "#fff" }}>É</div>
            <h1 style={{ fontSize: 24, marginBottom: 4 }}>ÉcoleOS</h1>
            <div style={{ fontSize: 14, color: "#636985" }}>Activation de la licence</div>
          </div>
          {licenseErr && <div style={S.err}>{licenseErr}</div>}
          <div style={{ marginBottom: 16 }}>
            <div style={S.label}>Clé de Licence</div>
            <input
              style={{ ...S.input, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600, textAlign: "center", fontSize: 14, fontFamily: "monospace" }}
              value={licenseKey}
              onChange={e => { setLicenseKey(e.target.value); setLicenseErr(""); }}
              placeholder="ECOLEOS-XXXX-XXXX-XXXX-XXXX-XXXX"
              onKeyDown={enterLicense}
            />
          </div>
          <Btn full onClick={doActivateLicense} loading={loading}>Activer</Btn>
          <div style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: "#636985" }}>
            Contactez votre fournisseur pour obtenir une clé de licence.
          </div>
        </div>
      </div>
    );
  }

  // ══════════════ LICENSE EXPIRED ══════════════
  if (step === "license_expired") {
    return (
      <div style={{ ...S.page, ...S.center }}>
        <div style={{ ...S.card, width: 520, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 50, background: "rgba(255,107,107,0.12)", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🔒</div>
          <h1 style={{ color: "#FF6B6B", marginBottom: 8 }}>Licence Expirée</h1>
          <p style={{ color: "#9BA1B7", lineHeight: 1.6, marginBottom: 8 }}>
            Votre abonnement ÉcoleOS a expiré{licenseInfo?.expiry ? ` le ${licenseInfo.expiry}` : ""}.
          </p>
          <p style={{ color: "#636985", fontSize: 13, marginBottom: 24 }}>
            La période de grâce de 7 jours est terminée. Contactez votre fournisseur pour renouveler.
          </p>
          <Btn variant="ghost" full onClick={() => { setStep("license"); setLicenseKey(""); setLicenseErr(""); }}>Entrer une nouvelle clé</Btn>
        </div>
      </div>
    );
  }

  // ══════════════ LOGIN ══════════════
  if (step === "login") {
    const enterLogin = e => { if (e.key === "Enter") doLogin(); };
    return (
      <div style={{ ...S.page, ...S.center }}>
        <div style={S.card}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg,#6C5CE7,#a29bfe)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 26, color: "#fff" }}>É</div>
            <h1 style={{ fontSize: 24, marginBottom: 4 }}>ÉcoleOS</h1>
            <div style={{ fontSize: 14, color: "#636985" }}>Plateforme de gestion scolaire</div>
          </div>
          {err && <div style={S.err}>{err}</div>}
          <Field label="Code Établissement" value={code} onChange={v => { setCode(v.toUpperCase()); setErr(""); }} placeholder="Ex : LMB" style={{ textTransform: "uppercase", letterSpacing: 2, fontWeight: 600, textAlign: "center", fontSize: 16 }} onKeyDown={enterLogin} />
          <Field label="Identifiant" value={uid} onChange={v => { setUid(v); setErr(""); }} placeholder="Votre identifiant" onKeyDown={enterLogin} />
          <div style={{ marginBottom: 16 }}>
            <div style={S.label}>Mot de passe</div>
            <input style={S.input} type="password" value={pwd} onChange={e => { setPwd(e.target.value); setErr(""); }} placeholder="••••••" onKeyDown={enterLogin} />
          </div>
          <Btn full onClick={doLogin} loading={loading}>Se Connecter</Btn>
          <div style={{ marginTop: 24, borderTop: "1px solid #2A2E42", paddingTop: 14 }}>
            {!superMode ? (
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: 11, color: "#636985", cursor: "pointer", opacity: 0.6 }} onClick={() => setSuperMode(true)}>Administration plateforme</span>
              </div>
            ) : (
              <div style={{ padding: 14, background: "#1C1F2E", borderRadius: 8, border: "1px solid #2A2E42" }}>
                {superErr && <div style={S.err}>{superErr}</div>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Identifiant" value={su} onChange={setSu} />
                  <div style={{ marginBottom: 16 }}>
                    <div style={S.label}>Mot de passe</div>
                    <input style={S.input} type="password" value={sp} onChange={e => setSp(e.target.value)} placeholder="••••••" onKeyDown={e => { if (e.key === "Enter") doSuper(); }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn variant="ghost" full onClick={() => { setSuperMode(false); setSuperErr(""); }}>Annuler</Btn>
                  <Btn full onClick={doSuper} loading={loading}>Connexion</Btn>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ══════════════ BLOCKED ══════════════
  if (step === "blocked") {
    return (
      <div style={{ ...S.page, ...S.center }}>
        <div style={{ ...S.card, width: 520, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 50, background: "rgba(255,107,107,0.12)", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🔒</div>
          <h1 style={{ color: "#FF6B6B", marginBottom: 8 }}>Abonnement Expiré</h1>
          <p style={{ color: "#9BA1B7", lineHeight: 1.6, marginBottom: 24 }}>L'abonnement de <strong>{school?.name}</strong> a expiré. Contactez l'administrateur de la plateforme pour renouveler.</p>
          <Btn variant="ghost" full onClick={logout}>← Retour</Btn>
        </div>
      </div>
    );
  }

  // ══════════════ SUPER ADMIN ══════════════
  if (step === "super") {
    const createSchool = async () => {
      if (!cf.name || !cf.city || !cf.adminUser || !cf.adminPass) { setCErr("Tous les champs sont requis"); return; }
      if (cf.adminPass.length < 6) { setCErr("Le mot de passe doit contenir au moins 6 caractères"); return; }
      const c = cf.code || cf.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 4);
      if (schools.find(s => s.code.toLowerCase() === c.toLowerCase())) { setCErr("Code déjà utilisé"); return; }
      setSaving(true);
      const dur = cf.plan === "essai" ? 14 : 30;
      const passHash = await hashPassword(cf.adminPass);
      const ns = { id: genId(), name: cf.name, city: cf.city, code: c, adminUser: cf.adminUser, adminPassHash: passHash, plan: cf.plan, subEnd: new Date(Date.now() + dur * 86400000).toISOString().slice(0, 10), subStatus: "actif" };
      await saveSchools([...schools, ns]);
      setCreateMode(false); setCErr("");
      setSaving(false);
    };

    const toggleSub = async (id) => {
      const u = schools.map(s => {
        if (s.id !== id) return s;
        const active = s.subEnd && new Date(s.subEnd) > new Date();
        return active
          ? { ...s, subStatus: "suspendu", subEnd: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }
          : { ...s, subStatus: "actif", subEnd: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) };
      });
      await saveSchools(u);
    };

    const delSchool = (id) => {
      const sc = schools.find(s => s.id === id);
      askConfirm(`Supprimer définitivement « ${sc?.name} » et toutes ses données ?`, async () => {
        await saveSchools(schools.filter(s => s.id !== id));
      });
    };

    const filteredSchools = schools.filter(s =>
      !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase()) || s.city.toLowerCase().includes(search.toLowerCase())
    );

    const active = schools.filter(s => s.subEnd && new Date(s.subEnd) > new Date()).length;
    const revenue = schools.reduce((a, s) => a + (PLANS[s.plan]?.price || 0), 0);

    // Super payments CRUD
    const addSuperPayment = async () => {
      if (!form.schoolId || !form.amount || isNaN(Number(form.amount))) return;
      const sc = schools.find(s => s.id === form.schoolId);
      await saveSuperPayments([...superPayments, {
        id: genId(), schoolId: form.schoolId, schoolName: sc?.name || "—", schoolCode: sc?.code || "—",
        amount: Number(form.amount), date: form.date || new Date().toISOString().slice(0, 10),
        period: form.period || "mensuel", method: form.method || "Virement", note: form.note || "",
      }]);
      setModal(null);
    };

    const delSuperPayment = (id) => {
      const p = superPayments.find(x => x.id === id);
      askConfirm(`Supprimer le paiement de « ${p?.schoolName} » ?`, async () => {
        await saveSuperPayments(superPayments.filter(x => x.id !== id));
      });
    };

    const totalCollected = superPayments.reduce((a, p) => a + p.amount, 0);
    const thisMonth = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");
    const monthCollected = superPayments.filter(p => p.date?.startsWith(thisMonth)).reduce((a, p) => a + p.amount, 0);
    const unpaidSchools = schools.filter(sc => {
      const hasPaidThisMonth = superPayments.some(p => p.schoolId === sc.id && p.date?.startsWith(thisMonth));
      return !hasPaidThisMonth && PLANS[sc.plan]?.price > 0;
    });

    const filteredPayments = superPayments.filter(p =>
      !search || p.schoolName.toLowerCase().includes(search.toLowerCase()) || p.schoolCode.toLowerCase().includes(search.toLowerCase()) || p.method.toLowerCase().includes(search.toLowerCase())
    );

    const tabStyle = (isActive) => ({
      padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600,
      borderTop: "none", borderLeft: "none", borderRight: "none",
      borderBottomWidth: 2, borderBottomStyle: "solid", borderBottomColor: isActive ? "#6C5CE7" : "transparent",
      color: isActive ? "#A29BFE" : "#636985", background: "transparent",
    });

    return (
      <div style={{ ...S.page, padding: "32px 24px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <Btn variant="ghost" small onClick={() => { setStep("login"); setSearch(""); setSuperFinPage("schools"); }}>← Retour</Btn>
            <h1 style={{ fontSize: 24, marginTop: 8 }}>Super Administration</h1>
            <div style={{ fontSize: 13, color: "#636985" }}>Gestion des abonnements et établissements</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {saving && <div style={S.spinner} />}
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#FF6B6B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>SA</div>
          </div>
        </div>

        {/* Tab navigation */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #2A2E42", marginBottom: 24 }}>
          <button style={tabStyle(superFinPage === "schools")} onClick={() => { setSuperFinPage("schools"); setSearch(""); }}>Établissements</button>
          <button style={tabStyle(superFinPage === "finances")} onClick={() => { setSuperFinPage("finances"); setSearch(""); }}>Finances Plateforme</button>
          <button style={tabStyle(superFinPage === "licences")} onClick={() => { setSuperFinPage("licences"); setSearch(""); }}>Licences</button>
        </div>

        {/* ── Schools Tab ── */}
        {superFinPage === "schools" && (<>
          <div className="eos-super-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 28 }}>
            <div style={S.stat}><div style={S.label}>Établissements</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{schools.length}</div><div style={{ fontSize: 12, color: "#9BA1B7", marginTop: 4 }}>{active} actifs</div></div>
            <div style={S.stat}><div style={S.label}>Revenu Mensuel</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{fmtCFA(revenue)}</div></div>
            <div style={S.stat}><div style={S.label}>Expirés / Suspendus</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: "#FF6B6B" }}>{schools.length - active}</div></div>
          </div>

          <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #2A2E42", flexWrap: "wrap", gap: 12 }}>
              <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un établissement..." />
              <Btn onClick={() => { setCf({ name: "", city: "", code: "", adminUser: "admin", adminPass: "", plan: "essai" }); setCreateMode(true); setCErr(""); }}>+ Nouvel Établissement</Btn>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead><tr><th style={S.th}>École</th><th style={S.th}>Code</th><th style={S.th}>Forfait</th><th style={S.th}>Prix</th><th style={S.th}>Échéance</th><th style={S.th}>Statut</th><th style={S.th}>Actions</th></tr></thead>
                <tbody>
                  {filteredSchools.map(s => {
                    const p = PLANS[s.plan];
                    const dl = s.subEnd ? Math.ceil((new Date(s.subEnd) - new Date()) / 86400000) : 0;
                    const isActive = dl > 0 && s.subStatus !== "suspendu";
                    const badgeColor = s.subStatus === "suspendu" ? "red" : dl <= 0 ? "red" : dl <= 7 ? "amber" : "green";
                    const badgeText = s.subStatus === "suspendu" ? "Suspendu" : dl <= 0 ? "Expiré" : dl <= 7 ? dl + "j restants" : "Actif (" + dl + "j)";
                    return (
                      <tr key={s.id}>
                        <td style={{ ...S.td, fontWeight: 500, color: "#E8EAF0" }}>{s.name}<div style={{ fontSize: 11, color: "#636985" }}>{s.city}</div></td>
                        <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 600 }}>{s.code}</td>
                        <td style={S.td}><span style={S.badge("purple")}>{p?.name || "—"}</span></td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{fmtCFA(p?.price || 0)}</td>
                        <td style={S.td}>{s.subEnd || "—"}</td>
                        <td style={S.td}><span style={S.badge(badgeColor)}>{badgeText}</span></td>
                        <td style={S.td}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Btn variant={isActive ? "danger" : "success"} small onClick={() => toggleSub(s.id)}>{isActive ? "Suspendre" : "Réactiver"}</Btn>
                            <Btn variant="danger" small onClick={() => delSchool(s.id)}>Suppr.</Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredSchools.length === 0 && (
                    <tr><td colSpan={7}><EmptyState icon="⌕" title={search ? "Aucun résultat" : "Aucun établissement"} subtitle={search ? "Essayez un autre terme de recherche" : "Créez votre premier établissement"} /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {createMode && (
            <Modal2 title="Nouvel Établissement" onClose={() => setCreateMode(false)} footer={
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="ghost" onClick={() => setCreateMode(false)}>Annuler</Btn>
                <Btn onClick={createSchool} loading={saving}>Créer</Btn>
              </div>
            }>
              {cErr && <div style={S.err}>{cErr}</div>}
              <Field label="Nom de l'école" value={cf.name} onChange={v => setCf({ ...cf, name: v })} placeholder="Lycée Victor Hugo" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Ville" value={cf.city} onChange={v => setCf({ ...cf, city: v })} placeholder="Dakar" />
                <Field label="Code (auto si vide)" value={cf.code} onChange={v => setCf({ ...cf, code: v.toUpperCase() })} placeholder="LVH" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={S.label}>Forfait</div>
                <select style={S.input} value={cf.plan} onChange={e => setCf({ ...cf, plan: e.target.value })}>
                  {Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v.name} — {v.price === 0 ? "Gratuit" : fmtCFA(v.price)}</option>)}
                </select>
              </div>
              <div style={{ borderTop: "1px solid #2A2E42", paddingTop: 12, marginTop: 8 }}>
                <div style={{ ...S.label, marginBottom: 10 }}>Compte Admin de l'école</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Identifiant" value={cf.adminUser} onChange={v => setCf({ ...cf, adminUser: v })} />
                  <Field label="Mot de passe" value={cf.adminPass} onChange={v => setCf({ ...cf, adminPass: v })} type="password" placeholder="Min. 6 caractères" />
                </div>
              </div>
            </Modal2>
          )}
        </>)}

        {/* ── Platform Finances Tab ── */}
        {superFinPage === "finances" && (<>
          {/* Summary cards */}
          <div className="eos-super-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
            <div style={S.stat}>
              <div style={S.label}>Revenu Attendu / mois</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#A29BFE" }}>{fmtCFA(revenue)}</div>
              <div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{schools.filter(s => PLANS[s.plan]?.price > 0).length} abonnements payants</div>
            </div>
            <div style={S.stat}>
              <div style={S.label}>Encaissé ce mois</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{fmtCFA(monthCollected)}</div>
              <div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{superPayments.filter(p => p.date?.startsWith(thisMonth)).length} paiements</div>
            </div>
            <div style={S.stat}>
              <div style={S.label}>Total Encaissé</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{fmtCFA(totalCollected)}</div>
              <div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{superPayments.length} paiements total</div>
            </div>
            <div style={S.stat}>
              <div style={S.label}>Impayés ce mois</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: unpaidSchools.length > 0 ? "#FF6B6B" : "#00B894" }}>{unpaidSchools.length}</div>
              <div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{unpaidSchools.length > 0 ? unpaidSchools.map(s => s.code).join(", ") : "Tous à jour"}</div>
            </div>
          </div>

          {/* Revenue per school breakdown */}
          <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Revenus par Établissement</h3></div>
            <div style={{ padding: 20 }}>
              {schools.filter(s => PLANS[s.plan]?.price > 0).length === 0 ? (
                <div style={{ textAlign: "center", padding: 20, color: "#636985", fontSize: 13 }}>Aucun abonnement payant</div>
              ) : (
                schools.filter(s => PLANS[s.plan]?.price > 0).map(sc => {
                  const paid = superPayments.filter(p => p.schoolId === sc.id).reduce((a, p) => a + p.amount, 0);
                  const expected = PLANS[sc.plan]?.price || 0;
                  const paidThisMonth = superPayments.some(p => p.schoolId === sc.id && p.date?.startsWith(thisMonth));
                  return (
                    <div key={sc.id} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, padding: "8px 0", borderBottom: "1px solid #1C1F2E" }}>
                      <span style={{ width: 50, fontFamily: "monospace", fontWeight: 600, fontSize: 12, color: "#A29BFE" }}>{sc.code}</span>
                      <span style={{ flex: 1, fontSize: 13, color: "#E8EAF0" }}>{sc.name}</span>
                      <span style={{ fontSize: 12, color: "#636985" }}>{fmtCFA(expected)}/mois</span>
                      <span style={S.badge(paidThisMonth ? "green" : "red")}>{paidThisMonth ? "Payé" : "Impayé"}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#00B894", minWidth: 100, textAlign: "right" }}>{fmtCFA(paid)} total</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Payments history table */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un paiement..." />
            <Btn onClick={() => { setForm({ schoolId: schools[0]?.id || "", amount: "", date: new Date().toISOString().slice(0, 10), period: "mensuel", method: "Virement", note: "" }); setModal("addSuperPay"); }}>+ Enregistrer un Paiement</Btn>
          </div>
          <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={S.table}>
                <thead><tr><th style={S.th}>Date</th><th style={S.th}>École</th><th style={S.th}>Montant</th><th style={S.th}>Période</th><th style={S.th}>Méthode</th><th style={S.th}>Note</th><th style={S.th}>Actions</th></tr></thead>
                <tbody>
                  {[...filteredPayments].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(p => (
                    <tr key={p.id}>
                      <td style={S.td}>{p.date}</td>
                      <td style={{ ...S.td, fontWeight: 500, color: "#E8EAF0" }}>{p.schoolName} <span style={{ fontFamily: "monospace", fontSize: 11, color: "#636985" }}>{p.schoolCode}</span></td>
                      <td style={{ ...S.td, fontWeight: 600, color: "#00B894" }}>+{fmtCFA(p.amount)}</td>
                      <td style={S.td}><span style={S.badge("purple")}>{p.period}</span></td>
                      <td style={S.td}>{p.method}</td>
                      <td style={{ ...S.td, fontSize: 12, color: "#636985" }}>{p.note || "—"}</td>
                      <td style={S.td}><Btn variant="danger" small onClick={() => delSuperPayment(p.id)}>Suppr.</Btn></td>
                    </tr>
                  ))}
                  {filteredPayments.length === 0 && (
                    <tr><td colSpan={7}><EmptyState icon="◆" title={search ? "Aucun résultat" : "Aucun paiement enregistré"} subtitle={search ? "Essayez un autre terme" : "Enregistrez le premier paiement d'un établissement"} /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Add payment modal */}
          {modal === "addSuperPay" && (
            <Modal2 title="Enregistrer un Paiement" onClose={() => setModal(null)} footer={
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
                <Btn onClick={addSuperPayment} loading={saving}>Enregistrer</Btn>
              </div>
            }>
              <div style={{ marginBottom: 16 }}>
                <div style={S.label}>Établissement</div>
                <select style={S.input} value={form.schoolId || ""} onChange={e => setForm({ ...form, schoolId: e.target.value })}>
                  {schools.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code}) — {PLANS[s.plan]?.name}</option>)}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Montant (FCFA)" value={form.amount || ""} onChange={v => setForm({ ...form, amount: v.replace(/[^0-9]/g, "") })} placeholder="50000" />
                <Field label="Date" value={form.date || ""} onChange={v => setForm({ ...form, date: v })} type="date" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ marginBottom: 16 }}>
                  <div style={S.label}>Période</div>
                  <select style={S.input} value={form.period || "mensuel"} onChange={e => setForm({ ...form, period: e.target.value })}>
                    <option value="mensuel">Mensuel</option>
                    <option value="trimestriel">Trimestriel</option>
                    <option value="semestriel">Semestriel</option>
                    <option value="annuel">Annuel</option>
                  </select>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={S.label}>Méthode</div>
                  <select style={S.input} value={form.method || "Virement"} onChange={e => setForm({ ...form, method: e.target.value })}>
                    <option>Virement</option>
                    <option>Espèces</option>
                    <option>Mobile Money</option>
                    <option>Chèque</option>
                  </select>
                </div>
              </div>
              <Field label="Note (optionnel)" value={form.note || ""} onChange={v => setForm({ ...form, note: v })} placeholder="Référence, détails..." />
            </Modal2>
          )}
        </>)}

        {superFinPage === "licences" && (() => {
          const PLAN_LABELS = { "0": "Essai", "1": "Basique", "2": "Standard", "3": "Premium" };
          const generateKey = async () => {
            const sc = (licForm.school.toUpperCase().padEnd(6, "0")).slice(0, 6);
            const payload = sc + licForm.plan + licForm.type + String(Number(licForm.devices)).padStart(2, "0") + (licForm.type === "P" ? "99991231" : licForm.expiry.replace(/-/g, ""));
            if (payload.length !== 18) return;
            const secret = "ecoleos_license_secret_change_me_in_production_2025";
            const enc = new TextEncoder();
            const keyMat = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
            const sigBuf = await crypto.subtle.sign("HMAC", keyMat, enc.encode(payload));
            const toHex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,"0")).join("").toUpperCase();
            const payloadHex = Array.from(enc.encode(payload)).map(b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
            const sig = toHex(sigBuf).slice(0, 20);
            const full = payloadHex + sig;
            const key = "ECOLEOS-" + full.match(/.{1,6}/g).join("-");
            setLicForm(f => ({ ...f, generated: key, copied: false }));
          };
          return (
            <div style={{ maxWidth: 560 }}>
              <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 24, marginBottom: 20 }}>
                <h3 style={{ marginBottom: 20, fontSize: 16 }}>Générer une Clé de Licence</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={S.label}>Code École (max 6 car.)</div>
                    <input style={S.input} value={licForm.school} onChange={e => setLicForm(f => ({ ...f, school: e.target.value.toUpperCase().slice(0,6), generated: "", copied: false }))} placeholder="ECOLE1" />
                  </div>
                  <div>
                    <div style={S.label}>Appareils max</div>
                    <input style={S.input} type="number" min="1" max="99" value={licForm.devices} onChange={e => setLicForm(f => ({ ...f, devices: e.target.value, generated: "", copied: false }))} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={S.label}>Forfait</div>
                    <select style={S.input} value={licForm.plan} onChange={e => setLicForm(f => ({ ...f, plan: e.target.value, generated: "", copied: false }))}>
                      {Object.entries(PLAN_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={S.label}>Type</div>
                    <select style={S.input} value={licForm.type} onChange={e => setLicForm(f => ({ ...f, type: e.target.value, generated: "", copied: false }))}>
                      <option value="P">Permanent</option>
                      <option value="S">Abonnement</option>
                    </select>
                  </div>
                </div>
                {licForm.type === "S" && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={S.label}>Date d'expiration</div>
                    <input style={S.input} type="date" value={licForm.expiry} onChange={e => setLicForm(f => ({ ...f, expiry: e.target.value, generated: "", copied: false }))} />
                  </div>
                )}
                <Btn onClick={generateKey} disabled={!licForm.school.trim()}>Générer la clé</Btn>
              </div>
              {licForm.generated ? (
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 20 }}>
                  <div style={S.label}>Clé générée</div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, color: "#A29BFE", wordBreak: "break-all", padding: "12px 0", letterSpacing: 1 }}>{licForm.generated}</div>
                  <Btn variant={licForm.copied ? "ghost" : "primary"} small onClick={() => { navigator.clipboard.writeText(licForm.generated); setLicForm(f => ({ ...f, copied: true })); }}>
                    {licForm.copied ? "Copié ✓" : "Copier"}
                  </Btn>
                </div>
              ) : null}
            </div>
          );
        })()}

        {confirm && <ConfirmModal message={confirm.message} onConfirm={runConfirm} onCancel={() => setConfirm(null)} />}
      </div>
    );
  }

  // ══════════════ MAIN APP ══════════════
  const role = user?.role || "admin";
  const dl = school?.subEnd ? Math.ceil((new Date(school.subEnd) - new Date()) / 86400000) : 999;
  const visiblePages = NAV_PAGES.filter(p => p.roles.includes(role));

  // ── Student CRUD ──
  const addStudent = async () => {
    if (!form.name) return;
    await saveStu([...students, { id: genId(), ...form, status: "actif" }]);
    setModal(null);
  };

  const editStudent = async () => {
    if (!form.name) return;
    await saveStu(students.map(s => s.id === form.id ? { ...s, ...form } : s));
    setModal(null);
  };

  const delStudent = (id) => {
    const stu = students.find(s => s.id === id);
    askConfirm(`Supprimer définitivement « ${stu?.name} » ?\n\nToutes ses notes, présences et données associées seront perdues. Cette action est irréversible.`, async () => {
      await saveStu(students.filter(s => s.id !== id));
    });
  };

  const toggleStudentStatus = async (id) => {
    await saveStu(students.map(s => s.id === id ? { ...s, status: s.status === "actif" ? "inactif" : "actif" } : s));
  };

  const generateParentCode = async (studentId, studentName, parentName, parentPhone) => {
    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const id = "par_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const record = {
      id,
      schoolId: school.id,
      studentId,
      studentName,
      parentName: parentName || "Parent",
      parentPhone: parentPhone || "",
      accessCode: code,
      status: "actif",
      createdAt: new Date().toISOString()
    };
    const existing = [...parentCodes];
    existing.push(record);
    await saveParentCodes(existing);
    return record;
  };

  // ── Staff CRUD ──
  const addStaffMember = async () => {
    if (!form.name || !form.username || !form.password) return;
    if (form.password.length < 6) return;
    const passHash = await hashPassword(form.password);
    await saveStaff([...staff, { id: genId(), name: form.name, username: form.username, passHash, role: form.role, customRole: form.customRole || "", subject: form.subject || "", status: "actif" }]);
    setModal(null);
  };

  const editStaffMember = async () => {
    if (!form.name || !form.username) return;
    const updated = staff.map(s => {
      if (s.id !== form.id) return s;
      const u = { ...s, name: form.name, username: form.username, role: form.role, customRole: form.customRole || "", subject: form.subject || "", salaryType: form.salaryType || "monthly", salaryAmount: form.salaryAmount || "", hourlyRate: form.hourlyRate || "" };
      if (form.password) u.passHash = null; // will be set below
      return u;
    });
    if (form.password) {
      const hash = await hashPassword(form.password);
      const idx = updated.findIndex(s => s.id === form.id);
      if (idx >= 0) updated[idx].passHash = hash;
    }
    await saveStaff(updated);
    setModal(null);
  };

  const delStaffMember = (id) => {
    const m = staff.find(s => s.id === id);
    askConfirm(`Supprimer le compte « ${m?.name} » ?`, async () => {
      await saveStaff(staff.filter(s => s.id !== id));
    });
  };

  const toggleStaffStatus = async (id) => {
    await saveStaff(staff.map(s => s.id === id ? { ...s, status: s.status === "actif" ? "inactif" : "actif" } : s));
  };

  // ── Finance CRUD ──
  const addTransaction = async () => {
    if (!form.label || !form.amount || isNaN(Number(form.amount))) return;
    const cat = (form.category === "Autre revenu" || form.category === "Autre dépense") && form.categoryCustom ? form.categoryCustom : (form.category || FIN_CATEGORIES.income[0]);
    await saveFin([...finances, { id: genId(), label: form.label, amount: Number(form.amount), type: form.type || "income", category: cat, date: form.date || new Date().toISOString().slice(0, 10), note: form.note || "" }]);
    setModal(null);
  };

  const editTransaction = async () => {
    if (!form.label || !form.amount || isNaN(Number(form.amount))) return;
    const cat = (form.category === "Autre revenu" || form.category === "Autre dépense") && form.categoryCustom ? form.categoryCustom : form.category;
    await saveFin(finances.map(t => t.id === form.id ? { ...t, label: form.label, amount: Number(form.amount), type: form.type, category: cat, date: form.date, note: form.note || "" } : t));
    setModal(null);
  };

  const delTransaction = (id) => {
    const t = finances.find(f => f.id === id);
    askConfirm(`Supprimer la transaction « ${t?.label} » ?`, async () => {
      await saveFin(finances.filter(f => f.id !== id));
    });
  };

  // ── Budget CRUD ──
  const addBudgetEntry = async () => {
    if (!form.category || !form.planned || isNaN(Number(form.planned))) return;
    const scope = form.scope || "monthly";
    let month = null, year = budgetYear;
    if (scope === "monthly") {
      month = form.month || (budgetYear + "-" + String(new Date().getMonth() + 1).padStart(2, "0"));
      year = Number(month.split("-")[0]);
    }
    const cat = (form.category === "Autre revenu" || form.category === "Autre dépense") && form.budgetCatCustom ? form.budgetCatCustom : form.category;
    const entry = { id: genId(), category: cat, type: form.type || "expense", planned: Number(form.planned), scope, month, year, note: form.note || "" };
    if (scope === "activity") entry.activity = form.activity || "";
    await saveBudgets([...budgets, entry]);
    setModal(null);
  };

  const editBudgetEntry = async () => {
    if (!form.category || !form.planned || isNaN(Number(form.planned))) return;
    const scope = form.scope || "monthly";
    let month = null, year = budgetYear;
    if (scope === "monthly") {
      month = form.month || (budgetYear + "-" + String(new Date().getMonth() + 1).padStart(2, "0"));
      year = Number(month.split("-")[0]);
    }
    const cat = (form.category === "Autre revenu" || form.category === "Autre dépense") && form.budgetCatCustom ? form.budgetCatCustom : form.category;
    await saveBudgets(budgets.map(b => b.id === form.id ? { ...b, category: cat, type: form.type, planned: Number(form.planned), scope, month, year, activity: scope === "activity" ? (form.activity || "") : undefined, note: form.note || "" } : b));
    setModal(null);
  };

  const delBudgetEntry = (id) => {
    const b = budgets.find(x => x.id === id);
    askConfirm(`Supprimer le budget « ${b?.category} » ?`, async () => {
      await saveBudgets(budgets.filter(x => x.id !== id));
    });
  };

  const copyBudgetMonth = async () => {
    if (!form.fromMonth || !form.toMonth || form.fromMonth === form.toMonth) return;
    const src = budgets.filter(b => b.month === form.fromMonth);
    if (src.length === 0) return;
    const copies = src.map(b => ({ ...b, id: genId(), month: form.toMonth, year: Number(form.toMonth.split("-")[0]) }));
    await saveBudgets([...budgets, ...copies]);
    setModal(null);
  };

  // filteredStudents/filteredStaff/filteredFinances/finTotals/export/import/connection are defined above early returns (hooks rules)

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div style={S.page}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* Mobile overlay */}
        {isMobile && sidebarOpen && <div style={S.overlay} onClick={closeSidebar} />}

        {/* Sidebar */}
        <aside className={`eos-sidebar${sidebarOpen ? " open" : ""}`} style={{ ...S.sidebar, ...(isMobile && !sidebarOpen ? S.sidebarHidden : {}) }}>
          <div style={{ padding: 20, borderBottom: "1px solid #2A2E42", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#6C5CE7,#a29bfe)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, color: "#fff" }}>{(school?.code || "ÉO").slice(0, 2)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{school?.name || "—"}</div>
              <div style={{ fontSize: 11, color: "#636985" }}>{school?.city || ""} · {PLANS[school?.plan]?.name || "—"}</div>
            </div>
          </div>
          {dl <= 7 && dl > 0 && <div style={{ padding: "8px 16px", background: "rgba(253,203,110,0.12)", fontSize: 11, color: "#FDCB6E", textAlign: "center", borderBottom: "1px solid rgba(253,203,110,0.2)" }}>Expire dans {dl}j</div>}
          <nav style={{ flex: 1, padding: "16px 12px", overflow: "auto" }}>
            {visiblePages.map(p => (
              <div key={p.k} style={S.navItem(page === p.k)} onClick={() => { if (p.k === "pay") { window.open("/admin-payments.html", "_blank"); return; } setPage(p.k); setSearch(""); if (isMobile) closeSidebar(); }}>
                <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{p.icon}</span>
                {p.l}
              </div>
            ))}
          </nav>
          <div style={{ padding: "12px 20px", borderTop: "1px solid #2A2E42" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: "#636985", marginBottom: 8 }}>{ROLES[role] || role}</div>
            <Btn variant="ghost" full small onClick={logout}>Déconnexion</Btn>
          </div>
        </aside>

        {/* Main */}
        <main className="eos-main" style={{ ...S.main, ...(isMobile ? S.mainFull : {}) }}>
          <header className="eos-topbar" style={S.topbar}>
            {isMobile && <button style={{ ...S.btn, ...S.ghost, padding: "4px 10px", fontSize: 18 }} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>}
            <h2 style={{ fontSize: 20, flex: 1 }}>{visiblePages.find(p => p.k === page)?.l || "—"}</h2>
            {saving && <div style={S.spinner} />}
            {/* Connection status */}
            <div
              style={{ display: "flex", alignItems: "center", gap: 6, cursor: role === "admin" ? "pointer" : "default", fontSize: 11, color: "#636985" }}
              onClick={() => {
                if (role !== "admin") return;
                setForm({ serverUrl: connConfig.serverUrl || "", mode: connConfig.mode || "offline", testResult: null });
                setModal("connection");
              }}
              title={connStatus === "connected" ? "Connecté au serveur" : connStatus === "syncing" ? "Synchronisation..." : connStatus === "error" ? "Serveur injoignable" : "Hors ligne"}
            >
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: connStatus === "connected" ? "#00B894" : connStatus === "syncing" ? "#FDCB6E" : connStatus === "error" ? "#FF6B6B" : "#636985" }} />
              {connConfig.mode !== "offline" && <span>{connStatus === "connected" ? "En ligne" : connStatus === "syncing" ? "Sync..." : connStatus === "error" ? "Déconnecté" : ""}</span>}
            </div>
            {role === "admin" && (
              <button
                style={{ ...S.btn, ...S.ghost, padding: "4px 10px", fontSize: 16 }}
                onClick={() => {
                  setForm({ serverUrl: connConfig.serverUrl || "", mode: connConfig.mode || "offline", testResult: null });
                  setModal("connection");
                }}
                title="Paramètres de connexion"
              >⚙</button>
            )}
          </header>
          {licenseGrace && (
            <div style={{ padding: "8px 32px", background: "rgba(253,203,110,0.12)", fontSize: 13, color: "#FDCB6E", textAlign: "center", borderBottom: "1px solid rgba(253,203,110,0.2)" }}>
              Votre licence expire bientôt — {licenseGrace} jour{licenseGrace > 1 ? "s" : ""} de grâce restant{licenseGrace > 1 ? "s" : ""}. Contactez votre fournisseur pour renouveler.
            </div>
          )}
          <div className="eos-content" style={S.content}>

            {/* Dashboard */}
                        {page === "dash" && (() => {
              // ══════════════════════════════════════════════════════════════
              // ADMIN DASHBOARD — Comprehensive overview
              // ══════════════════════════════════════════════════════════════
              if (role === "admin") {
                return (
                  <div>
                    {/* Stats Grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                      <div style={S.stat}><div style={S.label}>Élèves</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{students.filter(s => s.status === "actif").length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{students.length} total</div></div>
                      <div style={S.stat}><div style={S.label}>Personnel</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{staff.filter(s => s.status === "actif").length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{staff.length} total</div></div>
                      <div style={S.stat}><div style={S.label}>Forfait</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 8, color: "#A29BFE" }}>{PLANS[school?.plan]?.name || "—"}</div></div>
                      <div style={S.stat}><div style={S.label}>Jours restants</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: dl <= 7 ? "#FDCB6E" : "#00B894" }}>{dl}</div></div>
                    </div>

                    {/* Grade Distribution Chart */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Répartition par Niveau</h3></div>
                      <div style={{ padding: 20 }}>
                        {NIV.map(n => {
                          const c = students.filter(s => s.grade === n && s.status === "actif").length;
                          const max = Math.max(...NIV.map(nn => students.filter(s => s.grade === nn && s.status === "actif").length), 1);
                          return (
                            <div key={n} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                              <span style={{ width: 90, fontSize: 13, color: "#9BA1B7" }}>{n}</span>
                              <div style={{ flex: 1, height: 24, background: "#1C1F2E", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ width: `${(c / max) * 100}%`, height: "100%", background: "linear-gradient(90deg,#6C5CE7,#A29BFE)", borderRadius: 4, transition: "width 0.3s ease" }} />
                              </div>
                              <span style={{ width: 28, fontSize: 13, fontWeight: 600, textAlign: "right" }}>{c}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Data Management */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}>
                        <h3>Données de l'établissement</h3>
                      </div>
                      <div style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Btn variant="ghost" onClick={exportSchoolData}>↓ Exporter les données</Btn>
                        <label>
                          <input type="file" accept=".json" onChange={handleImportFile} style={{ display: "none" }} />
                          <span style={{ ...S.btn, ...S.ghost, display: "inline-block", cursor: "pointer" }}>↑ Importer des données</span>
                        </label>
                      </div>
                    </div>

                    {/* Budget Summary */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20, cursor: "pointer" }} onClick={() => { setPage("budget"); setSearch(""); }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3>Budget {new Date().getFullYear()}</h3>
                        <span style={{ fontSize: 12, color: "#636985" }}>Voir détails →</span>
                      </div>
                      <div style={{ padding: 20, display: "flex", gap: 20, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 11, color: "#636985", textTransform: "uppercase", letterSpacing: 0.5 }}>Dépenses réelles / prévues</div>
                          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: budgetData.actualExpense <= budgetData.plannedExpense || budgetData.plannedExpense === 0 ? "#00B894" : "#FF6B6B" }}>
                            {budgetData.plannedExpense > 0 ? Math.round((budgetData.actualExpense / budgetData.plannedExpense) * 100) + "%" : "—"}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#636985", textTransform: "uppercase", letterSpacing: 0.5 }}>Catégories en dépassement</div>
                          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: budgetData.overBudgetItems.length > 0 ? "#FF6B6B" : "#00B894" }}>
                            {budgetData.overBudgetItems.length}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: "#636985", textTransform: "uppercase", letterSpacing: 0.5 }}>Statut</div>
                          <div style={{ marginTop: 6 }}>
                            <span style={S.badge(budgetData.overBudgetItems.length > 0 ? "red" : "green")}>
                              {budgetData.overBudgetItems.length > 0 ? "Dépassement" : budgetData.plannedExpense > 0 ? "En bonne voie" : "Non défini"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Quick Links */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}>
                        <h3>Accès rapide</h3>
                      </div>
                      <div style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Btn onClick={() => { setPage("stu"); setSearch(""); }}>◎ Élèves</Btn>
                        <Btn onClick={() => { setPage("staff"); setSearch(""); }}>◉ Personnel</Btn>
                        <Btn onClick={() => { setPage("fin"); setSearch(""); }}>◆ Finances</Btn>
                        <Btn onClick={() => { setPage("budget"); setSearch(""); }}>◇ Budget</Btn>
                        <Btn onClick={() => { setPage("cls"); setSearch(""); }}>⊞ Classes</Btn>
                        <Btn onClick={() => { setPage("att"); setSearch(""); }}>✓ Présences</Btn>
                        <Btn onClick={() => { setPage("grades"); setSearch(""); }}>✎ Notes</Btn>
                        <Btn onClick={() => { setPage("disc"); setSearch(""); }}>⊘ Discipline</Btn>
                      </div>
                    </div>
                  </div>
                );
              }

              // ══════════════════════════════════════════════════════════════
              // DIRECTEUR (DIRECTOR) DASHBOARD
              // ══════════════════════════════════════════════════════════════
              if (role === "directeur") {
                const todayIncidents = incidents.filter(inc => inc.date === new Date().toISOString().slice(0, 10)).slice(0, 5);
                const presentToday = attendance.filter(a => a.date === new Date().toISOString().slice(0, 10) && a.status === "présent").length;
                const absentToday = attendance.filter(a => a.date === new Date().toISOString().slice(0, 10) && a.status === "absent").length;
                
                return (
                  <div>
                    {/* Stats */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                      <div style={S.stat}><div style={S.label}>Élèves</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{students.filter(s => s.status === "actif").length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{students.length} total</div></div>
                      <div style={S.stat}><div style={S.label}>Personnel</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{staff.filter(s => s.status === "actif").length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{staff.length} total</div></div>
                      <div style={S.stat}><div style={S.label}>Présents aujourd'hui</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{presentToday}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{absentToday} absents</div></div>
                    </div>

                    {/* Grade Distribution */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Répartition par Niveau</h3></div>
                      <div style={{ padding: 20 }}>
                        {NIV.map(n => {
                          const c = students.filter(s => s.grade === n && s.status === "actif").length;
                          const max = Math.max(...NIV.map(nn => students.filter(s => s.grade === nn && s.status === "actif").length), 1);
                          return (
                            <div key={n} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                              <span style={{ width: 90, fontSize: 13, color: "#9BA1B7" }}>{n}</span>
                              <div style={{ flex: 1, height: 24, background: "#1C1F2E", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ width: `${(c / max) * 100}%`, height: "100%", background: "linear-gradient(90deg,#6C5CE7,#A29BFE)", borderRadius: 4, transition: "width 0.3s ease" }} />
                              </div>
                              <span style={{ width: 28, fontSize: 13, fontWeight: 600, textAlign: "right" }}>{c}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Recent Discipline Incidents */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3>Incidents récents</h3>
                        <span style={{ fontSize: 12, color: "#636985" }}>Aujourd'hui: {todayIncidents.length}</span>
                      </div>
                      <div style={{ padding: 20 }}>
                        {todayIncidents.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "#636985", fontSize: 13 }}>Aucun incident aujourd'hui</div>
                        ) : (
                          todayIncidents.map(inc => {
                            const student = students.find(s => s.id === inc.studentId);
                            return (
                              <div key={inc.id} style={{ padding: "12px 0", borderBottom: "1px solid #1C1F2E", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 500, color: "#E8EAF0" }}>{student?.name || "Élève"}</div>
                                  <div style={{ fontSize: 11, color: "#636985", marginTop: 2 }}>{inc.type}</div>
                                </div>
                                <span style={S.badge("red")}>{inc.sanction || "—"}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Quick Links */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}>
                        <h3>Accès rapide</h3>
                      </div>
                      <div style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Btn onClick={() => { setPage("cls"); setSearch(""); }}>⊞ Classes</Btn>
                        <Btn onClick={() => { setPage("att"); setSearch(""); }}>✓ Présences</Btn>
                        <Btn onClick={() => { setPage("grades"); setSearch(""); }}>✎ Notes</Btn>
                        <Btn onClick={() => { setPage("disc"); setSearch(""); }}>⊘ Discipline</Btn>
                      </div>
                    </div>
                  </div>
                );
              }

              // ══════════════════════════════════════════════════════════════
              // SECRÉTAIRE (SECRETARY) DASHBOARD
              // ══════════════════════════════════════════════════════════════
              if (role === "secretaire") {
                const thisMonth = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");
                const newEnrollmentsThisMonth = students.filter(s => s.enrollYear && s.enrollYear.startsWith(thisMonth.split("-")[0]) && s.id).length;
                
                return (
                  <div>
                    {/* Stats */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                      <div style={S.stat}><div style={S.label}>Élèves</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{students.filter(s => s.status === "actif").length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{newEnrollmentsThisMonth} inscriptions cette année</div></div>
                      <div style={S.stat}><div style={S.label}>Personnel</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{staff.filter(s => s.status === "actif").length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{staff.length} total</div></div>
                      <div style={S.stat}><div style={S.label}>Classes</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{classes.length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{students.filter(s => s.status === "actif").length} élèves</div></div>
                    </div>

                    {/* Classes Overview */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Aperçu des Classes</h3></div>
                      <div style={{ padding: 20 }}>
                        {classes.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "#636985", fontSize: 13 }}>Aucune classe créée</div>
                        ) : (
                          classes.slice(0, 8).map(c => {
                            const studentCount = students.filter(s => s.classId === c.id && s.status === "actif").length;
                            return (
                              <div key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid #1C1F2E", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: "#E8EAF0" }}>
                                  {c.name}
                                  {c.section && <span style={{ fontSize: 11, color: "#636985", marginLeft: 8 }}>({c.section})</span>}
                                </div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#A29BFE" }}>{studentCount} élèves</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Quick Links */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}>
                        <h3>Accès rapide</h3>
                      </div>
                      <div style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Btn onClick={() => { setPage("stu"); setSearch(""); }}>◎ Élèves</Btn>
                        <Btn onClick={() => { setPage("staff"); setSearch(""); }}>◉ Personnel</Btn>
                        <Btn onClick={() => { setPage("cls"); setSearch(""); }}>⊞ Classes</Btn>
                        <Btn onClick={() => { setPage("docs"); setSearch(""); }}>⊕ Documents</Btn>
                      </div>
                    </div>
                  </div>
                );
              }

              // ══════════════════════════════════════════════════════════════
              // ENSEIGNANT / TITULAIRE (TEACHER) DASHBOARD
              // ══════════════════════════════════════════════════════════════
              if (role === "enseignant" || role === "titulaire") {
                const today = new Date().toISOString().slice(0, 10);
                const todayAttendance = attendance.filter(a => a.date === today).slice(0, 10);
                const recentGrades = grades.filter(g => g.studentId).slice(-5);
                const userClasses = timetable.filter(t => t.teacherId === user?.id).map(t => t.classId).filter((v, i, a) => a.indexOf(v) === i);
                
                return (
                  <div>
                    {/* Stats */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                      <div style={S.stat}><div style={S.label}>Mes Classes</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{userClasses.length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>Emploi du temps</div></div>
                      <div style={S.stat}><div style={S.label}>Présences aujourd'hui</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{todayAttendance.length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>Élèves marqués</div></div>
                      <div style={S.stat}><div style={S.label}>Notes entrées</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{recentGrades.length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>Récemment</div></div>
                    </div>

                    {/* My Classes */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Mes Classes</h3></div>
                      <div style={{ padding: 20 }}>
                        {userClasses.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "#636985", fontSize: 13 }}>Aucune classe assignée</div>
                        ) : (
                          userClasses.map(classId => {
                            const cls = classes.find(c => c.id === classId);
                            const studentCount = students.filter(s => s.classId === classId && s.status === "actif").length;
                            return (
                              <div key={classId} style={{ padding: "10px 0", borderBottom: "1px solid #1C1F2E", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: "#E8EAF0" }}>
                                  {cls?.name || "Classe"}
                                  {cls?.section && <span style={{ fontSize: 11, color: "#636985", marginLeft: 8 }}>({cls.section})</span>}
                                </div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#A29BFE" }}>{studentCount} élèves</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Recent Grades */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Notes récentes</h3></div>
                      <div style={{ padding: 20 }}>
                        {recentGrades.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "#636985", fontSize: 13 }}>Aucune note entrée</div>
                        ) : (
                          recentGrades.map(g => {
                            const student = students.find(s => s.id === g.studentId);
                            return (
                              <div key={g.id} style={{ padding: "10px 0", borderBottom: "1px solid #1C1F2E", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 500, color: "#E8EAF0" }}>{student?.name || "Élève"}</div>
                                  <div style={{ fontSize: 11, color: "#636985", marginTop: 2 }}>{g.subject || "Sujet"}</div>
                                </div>
                                <span style={{ fontSize: 14, fontWeight: 700, color: "#A29BFE" }}>{g.score}/20</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Quick Links */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}>
                        <h3>Accès rapide</h3>
                      </div>
                      <div style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Btn onClick={() => { setPage("att"); setSearch(""); }}>✓ Présences</Btn>
                        <Btn onClick={() => { setPage("grades"); setSearch(""); }}>✎ Notes</Btn>
                        <Btn onClick={() => { setPage("tmt"); setSearch(""); }}>⊟ Emploi du temps</Btn>
                      </div>
                    </div>
                  </div>
                );
              }

              // ══════════════════════════════════════════════════════════════
              // COMPTABLE (ACCOUNTANT) DASHBOARD
              // ══════════════════════════════════════════════════════════════
              if (role === "comptable") {
                const totalIncome = finances.filter(f => f.type === "income").reduce((a, f) => a + Number(f.amount || 0), 0);
                const totalExpense = finances.filter(f => f.type === "expense").reduce((a, f) => a + Number(f.amount || 0), 0);
                const balance = totalIncome - totalExpense;
                const recentTransactions = finances.slice(-5);
                const budgetYear = new Date().getFullYear();
                const yearBudgets = budgets.filter(b => b.year === budgetYear);
                
                return (
                  <div>
                    {/* Financial Overview */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                      <div style={S.stat}><div style={S.label}>Revenu Total</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{fmtCFA(totalIncome)}</div></div>
                      <div style={S.stat}><div style={S.label}>Dépenses Totales</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#FF6B6B" }}>-{fmtCFA(totalExpense)}</div></div>
                      <div style={S.stat}><div style={S.label}>Solde</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: balance >= 0 ? "#00B894" : "#FF6B6B" }}>{fmtCFA(balance)}</div></div>
                      <div style={S.stat}><div style={S.label}>Transactions</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{finances.length}</div><div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>Total enregistrées</div></div>
                    </div>

                    {/* Budget Summary */}
                    {yearBudgets.length > 0 && (
                      <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                        <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Exécution du Budget {budgetYear}</h3></div>
                        <div style={{ padding: 20 }}>
                          {yearBudgets.slice(0, 5).map(b => {
                            const spent = finances.filter(f => f.category === b.category && f.type === "expense").reduce((a, f) => a + Number(f.amount || 0), 0);
                            const progress = b.amount > 0 ? Math.min((spent / b.amount) * 100, 100) : 0;
                            const isOverBudget = spent > b.amount;
                            return (
                              <div key={b.id} style={{ marginBottom: 16 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                  <span style={{ fontSize: 13, fontWeight: 500, color: "#E8EAF0" }}>{b.category}</span>
                                  <span style={{ fontSize: 12, color: isOverBudget ? "#FF6B6B" : "#636985" }}>
                                    {fmtCFA(spent)} / {fmtCFA(b.amount)}
                                  </span>
                                </div>
                                <div style={{ height: 8, background: "#1C1F2E", borderRadius: 4, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${progress}%`, background: isOverBudget ? "#FF6B6B" : "#6C5CE7", transition: "width 0.3s ease" }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Recent Transactions */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Transactions Récentes</h3></div>
                      <div style={{ padding: 20 }}>
                        {recentTransactions.length === 0 ? (
                          <div style={{ textAlign: "center", padding: "20px", color: "#636985", fontSize: 13 }}>Aucune transaction</div>
                        ) : (
                          recentTransactions.map(t => (
                            <div key={t.id} style={{ padding: "10px 0", borderBottom: "1px solid #1C1F2E", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 500, color: "#E8EAF0" }}>{t.category}</div>
                                <div style={{ fontSize: 11, color: "#636985", marginTop: 2 }}>{t.date || "—"}</div>
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 600, color: t.type === "income" ? "#00B894" : "#FF6B6B" }}>
                                {t.type === "income" ? "+" : "-"}{fmtCFA(Number(t.amount || 0))}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Quick Links */}
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}>
                        <h3>Accès rapide</h3>
                      </div>
                      <div style={{ padding: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <Btn onClick={() => { setPage("fin"); setSearch(""); }}>◆ Finances</Btn>
                        <Btn onClick={() => { setPage("budget"); setSearch(""); }}>◇ Budget</Btn>
                        <Btn onClick={() => { setPage("cant"); setSearch(""); }}>⊙ Cantine</Btn>
                      </div>
                    </div>
                  </div>
                );
              }

              // ══════════════════════════════════════════════════════════════
              // DEFAULT (AUTRE / OTHER)
              // ══════════════════════════════════════════════════════════════
              return (
                <div>
                  <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 32, textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Bienvenue</div>
                    <div style={{ color: "#636985", marginBottom: 20 }}>Rôle: {ROLES[role] || role}</div>
                    <Btn onClick={() => { setPage("msg"); setSearch(""); }}>⊛ Annonces</Btn>
                  </div>
                </div>
              );
            })()}


            {/* Students */}
            {page === "stu" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                  <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un élève..." />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="ghost" onClick={() => setModal("classTuition")}>⚙ Frais par niveau</Btn>
                    <Btn onClick={() => { setForm({ name: "", grade: NIV[0], gender: "", dob: "", birthPlace: "", nationality: "", classId: "", prevSchool: "", enrollYear: String(new Date().getFullYear()), parent: "", parentRel: "", parentPhone: "", parentEmail: "", address: "", bloodType: "", allergies: "", notes: "" }); setModal("addStu"); }}>+ Ajouter un élève</Btn>
                  </div>
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr><th style={S.th}>Nom</th><th style={S.th}>Niveau</th><th style={S.th}>Parent</th><th style={S.th}>Paiement</th><th style={S.th}>Statut</th><th style={S.th}>Actions</th></tr></thead>
                      <tbody>
                        {filteredStudents.map(s => {
                          const amountDue = Number(classTuition[s.grade] || 0);
                          const paid = studentPayments.filter(p => p.studentId === s.id).reduce((a, p) => a + Number(p.amount || 0), 0);
                          const payBadge = amountDue === 0 ? null : paid >= amountDue ? { color: "green", label: "Payé" } : paid > 0 ? { color: "amber", label: `Partiel — Reste ${fmtCFA(amountDue - paid)}` } : { color: "red", label: "Impayé" };
                          return (
                          <tr key={s.id}>
                            <td style={{ ...S.td, fontWeight: 500, color: "#7C6BFF", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setForm({ profileId: s.id }); setModal("stuProfile"); }}>{s.name}</td>
                            <td style={S.td}>{s.grade}</td>
                            <td style={S.td}>{s.parent || "—"}</td>
                            <td style={S.td}>
                              {payBadge ? <span style={S.badge(payBadge.color)}>{payBadge.label}</span> : <span style={{ color: "#636985", fontSize: 12 }}>—</span>}
                            </td>
                            <td style={S.td}>
                              <span style={{ ...S.badge(s.status === "actif" ? "green" : "red"), cursor: "pointer" }} onClick={() => toggleStudentStatus(s.id)}>
                                {s.status}
                              </span>
                            </td>
                            <td style={S.td}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <Btn variant="ghost" small onClick={() => { setForm({ ...s }); setModal("editStu"); }}>Modifier</Btn>
                                <Btn variant="ghost" small onClick={() => { setForm({ payStudentId: s.id, payStudentName: s.name, payAmount: "", payDate: new Date().toISOString().slice(0,10), payNote: "" }); setModal("stuPayments"); }}>💰</Btn>
                                {payBadge && payBadge.color !== "green" && s.parentPhone && (
                                  <button title="Envoyer rappel WhatsApp" style={{ ...S.btn, ...S.ghost, padding: "4px 8px", fontSize: 14 }} onClick={() => {
                                    const phone = s.parentPhone.replace(/[\s\-\+\(\)]/g, "");
                                    const rest = amountDue > 0 ? fmtCFA(amountDue - paid) : "";
                                    const msg = encodeURIComponent(`Bonjour ${s.parent || ""},\n\nCeci est un rappel concernant les frais de scolarité de ${s.name} (${s.grade}).\nMontant restant : ${rest}.\n\nMerci de régulariser votre situation.\n— ${school?.name || ""}`);
                                    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank");
                                  }}>📲</button>
                                )}
                                <Btn variant="danger" small onClick={() => delStudent(s.id)}>Suppr.</Btn>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                        {filteredStudents.length === 0 && (
                          <tr><td colSpan={6}><EmptyState icon="◎" title={search ? "Aucun résultat" : "Aucun élève inscrit"} subtitle={search ? "Essayez un autre terme" : "Ajoutez votre premier élève"} /></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {(modal === "addStu" || modal === "editStu") && (
                  <Modal2
                    title={modal === "editStu" ? "Modifier l'Élève" : "Inscription — Nouvel Élève"}
                    onClose={() => setModal(null)}
                    footer={
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
                        <Btn onClick={modal === "editStu" ? editStudent : addStudent} loading={saving}>Enregistrer</Btn>
                      </div>
                    }
                  >
                    {/* ── Identité ── */}
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#7C6BFF", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Identité de l'élève</div>
                    <Field label="Nom complet *" value={form.name || ""} onChange={v => setForm({ ...form, name: v })} placeholder="Prénom Nom" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Sexe</div>
                        <select style={S.input} value={form.gender || ""} onChange={e => setForm({ ...form, gender: e.target.value })}>
                          <option value="">— Choisir —</option>
                          <option value="M">Masculin</option>
                          <option value="F">Féminin</option>
                        </select>
                      </div>
                      <Field label="Date de naissance" value={form.dob || ""} onChange={v => setForm({ ...form, dob: v })} placeholder="JJ/MM/AAAA" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Lieu de naissance" value={form.birthPlace || ""} onChange={v => setForm({ ...form, birthPlace: v })} placeholder="Ville, Pays" />
                      <Field label="Nationalité" value={form.nationality || ""} onChange={v => setForm({ ...form, nationality: v })} placeholder="Ex: Camerounaise" />
                    </div>

                    {/* ── Scolarité ── */}
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#7C6BFF", textTransform: "uppercase", letterSpacing: 1, margin: "8px 0 10px" }}>Scolarité</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Niveau *</div>
                        <select style={S.input} value={form.grade || NIV[0]} onChange={e => setForm({ ...form, grade: e.target.value })}>
                          {NIV.map(n => <option key={n}>{n}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Classe</div>
                        <select style={S.input} value={form.classId || ""} onChange={e => setForm({ ...form, classId: e.target.value })}>
                          <option value="">— Non assigné —</option>
                          {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` (${c.section})` : ""}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="École précédente" value={form.prevSchool || ""} onChange={v => setForm({ ...form, prevSchool: v })} placeholder="Nom de l'école" />
                      <Field label="Année d'entrée" value={form.enrollYear || ""} onChange={v => setForm({ ...form, enrollYear: v })} placeholder={String(new Date().getFullYear())} />
                    </div>

                    {/* ── Parent / Tuteur ── */}
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#7C6BFF", textTransform: "uppercase", letterSpacing: 1, margin: "8px 0 10px" }}>Parent / Tuteur</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Nom complet" value={form.parent || ""} onChange={v => setForm({ ...form, parent: v })} placeholder="Prénom Nom" />
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Lien de parenté</div>
                        <select style={S.input} value={form.parentRel || ""} onChange={e => setForm({ ...form, parentRel: e.target.value })}>
                          <option value="">— Choisir —</option>
                          <option value="Père">Père</option>
                          <option value="Mère">Mère</option>
                          <option value="Tuteur">Tuteur légal</option>
                          <option value="Autre">Autre</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Téléphone" value={form.parentPhone || ""} onChange={v => setForm({ ...form, parentPhone: v })} placeholder="+237 6XX XXX XXX" />
                      <Field label="Email" value={form.parentEmail || ""} onChange={v => setForm({ ...form, parentEmail: v })} placeholder="email@exemple.com" />
                    </div>
                    <Field label="Adresse" value={form.address || ""} onChange={v => setForm({ ...form, address: v })} placeholder="Quartier, Ville" />

                    {/* ── Santé ── */}
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#7C6BFF", textTransform: "uppercase", letterSpacing: 1, margin: "8px 0 10px" }}>Santé (optionnel)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Groupe sanguin</div>
                        <select style={S.input} value={form.bloodType || ""} onChange={e => setForm({ ...form, bloodType: e.target.value })}>
                          <option value="">— Inconnu —</option>
                          {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <Field label="Allergies / Conditions" value={form.allergies || ""} onChange={v => setForm({ ...form, allergies: v })} placeholder="Ex: Asthme, pénicilline…" />
                    </div>
                    <Field label="Notes complémentaires" value={form.notes || ""} onChange={v => setForm({ ...form, notes: v })} placeholder="Informations supplémentaires…" />
                  </Modal2>
                )}
                {modal === "stuProfile" && (() => {
                  const s = students.find(x => x.id === form.profileId);
                  if (!s) return null;
                  const cls = classes.find(c => c.id === s.classId);
                  const teacher = cls ? staff.find(t => t.id === cls.teacherId) : null;
                  const stuAtt = attendance.filter(a => a.studentId === s.id);
                  const absences = stuAtt.filter(a => a.status === "absent").length;
                  const retards = stuAtt.filter(a => a.status === "retard").length;
                  const stuGrades = grades.filter(g => g.studentId === s.id);
                  return (
                    <Modal2 title="Fiche Élève" onClose={() => setModal(null)}
                      footer={<Btn variant="ghost" onClick={() => setModal(null)}>Fermer</Btn>}>
                      {/* Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 700, color: "#E8EAF0" }}>{s.name}</div>
                          <div style={{ fontSize: 13, color: "#636985", marginTop: 4 }}>{s.grade}{cls ? ` · ${cls.name}` : ""}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={S.badge(s.status === "actif" ? "green" : "red")}>{s.status}</span>
                          <span
                            style={{ ...S.badge(s.tuitionPaid ? "green" : "red"), cursor: "pointer" }}
                            title="Cliquer pour basculer"
                            onClick={async () => { await saveStu(students.map(x => x.id === s.id ? { ...x, tuitionPaid: !x.tuitionPaid } : x)); }}
                          >{s.tuitionPaid ? "Scolarité réglée" : "Scolarité impayée"}</span>
                        </div>
                      </div>
                      {/* Info grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                        {[
                          ["Sexe", s.gender === "M" ? "Masculin" : s.gender === "F" ? "Féminin" : "—"],
                          ["Date de naissance", s.dob || "—"],
                          ["Lieu de naissance", s.birthPlace || "—"],
                          ["Nationalité", s.nationality || "—"],
                          ["Classe", cls ? `${cls.name}${cls.section ? ` (${cls.section})` : ""}` : "Non assigné"],
                          ["Prof principal", teacher ? teacher.name : "—"],
                          ["École précédente", s.prevSchool || "—"],
                          ["Année d'entrée", s.enrollYear || "—"],
                          ["Parent / Tuteur", s.parent ? `${s.parent}${s.parentRel ? ` (${s.parentRel})` : ""}` : "—"],
                          ["Téléphone", s.parentPhone || "—"],
                          ["Email parent", s.parentEmail || "—"],
                          ["Adresse", s.address || "—"],
                          ["Groupe sanguin", s.bloodType || "—"],
                        ].map(([label, val]) => (
                          <div key={label} style={{ background: "#0F1117", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 11, color: "#636985", marginBottom: 3 }}>{label}</div>
                            <div style={{ fontSize: 13, color: "#E8EAF0" }}>{val}</div>
                          </div>
                        ))}
                        <div style={{ background: "#0F1117", borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 11, color: "#636985", marginBottom: 3 }}>Présences</div>
                          <div style={{ fontSize: 13 }}>
                            <span style={{ color: "#FF6B6B" }}>{absences} absence{absences !== 1 ? "s" : ""}</span>
                            <span style={{ color: "#636985", margin: "0 6px" }}>·</span>
                            <span style={{ color: "#FDCB6E" }}>{retards} retard{retards !== 1 ? "s" : ""}</span>
                          </div>
                        </div>
                        {s.allergies && (
                          <div style={{ background: "#0F1117", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 11, color: "#FDCB6E", marginBottom: 3 }}>⚕ Allergies / Santé</div>
                            <div style={{ fontSize: 13, color: "#E8EAF0" }}>{s.allergies}</div>
                          </div>
                        )}
                      </div>
                      {s.notes && <div style={{ background: "#0F1117", borderRadius: 8, padding: "10px 12px", marginBottom: 16, fontSize: 13, color: "#9BA1B7" }}><span style={{ color: "#636985", fontSize: 11 }}>Notes · </span>{s.notes}</div>}
                      {/* Grades by term */}
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#9BA1B7", marginBottom: 10 }}>Notes par trimestre</div>
                      {stuGrades.length === 0
                        ? <div style={{ fontSize: 13, color: "#636985", textAlign: "center", padding: 16 }}>Aucune note enregistrée</div>
                        : TERMS.map(term => {
                          const tg = stuGrades.filter(g => g.term === term);
                          if (tg.length === 0) return null;
                          const avg = (tg.reduce((a, g) => a + (g.score / g.maxScore) * 20, 0) / tg.length).toFixed(2);
                          return (
                            <div key={term} style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 12, color: "#7C6BFF", fontWeight: 600, marginBottom: 6 }}>{term}</div>
                              <div style={{ background: "#0F1117", borderRadius: 8, overflow: "hidden" }}>
                                {tg.map(g => (
                                  <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #1C1F2E" }}>
                                    <span style={{ fontSize: 12, color: "#9BA1B7" }}>{g.subject}</span>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: (g.score / g.maxScore) >= 0.5 ? "#00B894" : "#FF6B6B" }}>{g.score}/{g.maxScore}</span>
                                  </div>
                                ))}
                                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", fontSize: 12, fontWeight: 700 }}>
                                  <span style={{ color: "#636985" }}>Moyenne</span>
                                  <span style={{ color: Number(avg) >= 10 ? "#00B894" : "#FF6B6B" }}>{avg}/20</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      }
                      {/* Parent Access Code Section */}
                      {user?.role === "admin" && (
                        (() => {
                          const parCode = parentCodes.find(p => p.studentId === s.id);
                          return (
                            <div style={{ marginTop: 24, marginBottom: 16 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "#9BA1B7", marginBottom: 12 }}>🔗 Accès Portail Parent</div>
                              {parCode ? (
                                <div style={{ background: "#0F1117", borderRadius: 8, padding: 16, border: "1px solid #2A2E42" }}>
                                  <div style={{ marginBottom: 12 }}>
                                    <div style={{ fontSize: 11, color: "#636985", marginBottom: 4 }}>Code d'accès</div>
                                    <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "monospace", color: "#7C6BFF", letterSpacing: 2, textAlign: "center", padding: "12px", background: "#161822", borderRadius: 6, marginBottom: 12 }}>{parCode.accessCode}</div>
                                  </div>
                                  {parCode.parentPhone && (
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: 11, color: "#636985", marginBottom: 4 }}>Téléphone parent</div>
                                      <div style={{ fontSize: 13, color: "#E8EAF0" }}>{parCode.parentPhone}</div>
                                    </div>
                                  )}
                                  {parCode.parentName && (
                                    <div style={{ marginBottom: 12 }}>
                                      <div style={{ fontSize: 11, color: "#636985", marginBottom: 4 }}>Nom du parent</div>
                                      <div style={{ fontSize: 13, color: "#E8EAF0" }}>{parCode.parentName}</div>
                                    </div>
                                  )}
                                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                                    <Btn small variant="ghost" onClick={() => {
                                      navigator.clipboard.writeText(parCode.accessCode);
                                      alert("Code copié dans le presse-papiers");
                                    }}>📋 Copier le code</Btn>
                                    <Btn small variant="ghost" onClick={async () => {
                                      const newCode = await generateParentCode(s.id, s.name, s.parent || parCode.parentName, s.parentPhone || parCode.parentPhone);
                                      setForm({ profileId: s.id });
                                    }}>🔄 Régénérer</Btn>
                                    <Btn small variant="danger" onClick={async () => {
                                      await saveParentCodes(parentCodes.filter(p => p.id  !== parCode.id));
                                      setForm({ profileId: s.id });
                                    }}>⊗ Désactiver</Btn>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ background: "#0F1117", borderRadius: 8, padding: 16, border: "1px solid #2A2E42", textAlign: "center" }}>
                                  <div style={{ fontSize: 13, color: "#9BA1B7", marginBottom: 12 }}>Aucun code d'accès généré pour ce parent</div>
                                  <Btn onClick={async () => {
                                    await generateParentCode(s.id, s.name, s.parent || "Parent", s.parentPhone || "");
                                    setForm({ profileId: s.id });
                                  }}>+ Générer un code parent</Btn>
                                </div>
                              )}
                            </div>
                          );
                        })()
                      )}
                    </Modal2>
                  );
                })()}

                {/* ── Student Payments Modal ── */}
                {modal === "stuPayments" && (() => {
                  const stuPays = studentPayments.filter(p => p.studentId === form.payStudentId);
                  const totalPaid = stuPays.reduce((a, p) => a + Number(p.amount || 0), 0);
                  const amountDue = Number(classTuition[students.find(s => s.id === form.payStudentId)?.grade] || 0);
                  return (
                    <Modal2 title={`Paiements — ${form.payStudentName}`} onClose={() => setModal(null)}
                      footer={<Btn variant="ghost" onClick={() => setModal(null)}>Fermer</Btn>}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                        {[["Montant dû", fmtCFA(amountDue)],["Payé", fmtCFA(totalPaid)],["Reste", fmtCFA(Math.max(0, amountDue - totalPaid))]].map(([l,v]) => (
                          <div key={l} style={{ background: "#1C1F2E", borderRadius: 8, padding: "12px 16px" }}>
                            <div style={{ fontSize: 11, color: "#636985", textTransform: "uppercase", marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "#E8EAF0" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#636985", marginBottom: 8 }}>Historique des paiements</div>
                        {stuPays.length === 0 && <div style={{ fontSize: 13, color: "#636985" }}>Aucun paiement enregistré.</div>}
                        {stuPays.map(p => (
                          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #2A2E42", fontSize: 13 }}>
                            <span>{p.date} {p.note ? `— ${p.note}` : ""}</span>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ fontWeight: 600, color: "#00B894" }}>{fmtCFA(Number(p.amount))}</span>
                              <Btn variant="danger" small onClick={async () => await saveStudentPayments(studentPayments.filter(x => x.id !== p.id))}>✕</Btn>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ borderTop: "1px solid #2A2E42", paddingTop: 16 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#636985", marginBottom: 10 }}>Enregistrer un paiement</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          <div><div style={S.label}>Montant (FCFA)</div><input style={{ ...S.input, marginTop: 6 }} type="number" placeholder="50000" value={form.payAmount || ""} onChange={e => setForm({ ...form, payAmount: e.target.value })} /></div>
                          <div><div style={S.label}>Date</div><input style={{ ...S.input, marginTop: 6 }} type="date" value={form.payDate || ""} onChange={e => setForm({ ...form, payDate: e.target.value })} /></div>
                        </div>
                        <div style={{ marginBottom: 10 }}><div style={S.label}>Note</div><input style={{ ...S.input, marginTop: 6 }} placeholder="Reçu n°, mode de paiement…" value={form.payNote || ""} onChange={e => setForm({ ...form, payNote: e.target.value })} /></div>
                        <Btn loading={saving} onClick={async () => {
                          if (!form.payAmount || isNaN(Number(form.payAmount))) return;
                          await saveStudentPayments([...studentPayments, { id: genId(), studentId: form.payStudentId, amount: Number(form.payAmount), date: form.payDate || new Date().toISOString().slice(0,10), note: form.payNote || "" }]);
                          setForm({ ...form, payAmount: "", payNote: "" });
                        }}>+ Ajouter le paiement</Btn>
                      </div>
                    </Modal2>
                  );
                })()}

                {/* ── Class Tuition Config Modal ── */}
                {modal === "classTuition" && (
                  <Modal2 title="Frais de scolarité par niveau" onClose={() => setModal(null)}
                    footer={<Btn variant="ghost" onClick={() => setModal(null)}>Fermer</Btn>}>
                    <div style={{ fontSize: 12, color: "#636985", marginBottom: 16 }}>Définissez le montant annuel dû par niveau. Laissez vide pour ne pas suivre ce niveau.</div>
                    {NIV.map(n => (
                      <div key={n} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontSize: 13, color: "#E8EAF0" }}>{n}</div>
                        <input style={{ ...S.input, marginTop: 0 }} type="number" placeholder="0" value={classTuition[n] || ""} onChange={async e => {
                          const updated = { ...classTuition, [n]: e.target.value ? Number(e.target.value) : 0 };
                          await saveClassTuition(updated);
                        }} />
                      </div>
                    ))}
                  </Modal2>
                )}
              </div>
            )}

            {/* Staff */}
            {page === "staff" && (role === "admin" || role === "secretaire") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                  <SearchBar value={search} onChange={setSearch} placeholder="Rechercher du personnel..." />
                  {role === "admin" && <Btn onClick={() => { setForm({ name: "", username: "", password: "", role: "secretaire" }); setModal("addStaff"); }}>+ Créer un compte</Btn>}
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr><th style={S.th}>Nom</th><th style={S.th}>Matière / Classe</th><th style={S.th}>Rôle</th><th style={S.th}>Statut</th>{role === "admin" && <th style={S.th}>Actions</th>}</tr></thead>
                      <tbody>
                        {filteredStaff.map(s => {
                          const taughtClass = (s.role === "enseignant" || s.role === "titulaire") ? classes.find(c => c.teacherId === s.id) : null;
                          const classLabel = taughtClass ? `${taughtClass.name}${taughtClass.section ? ` — ${taughtClass.section}` : ""}` : null;
                          return (
                          <tr key={s.id}>
                            <td style={{ ...S.td, fontWeight: 500, color: "#E8EAF0" }}>{s.name}</td>
                            <td style={S.td}>{(s.role === "enseignant" || s.role === "titulaire") ? <span>{s.subject || "—"}{classLabel ? <span style={{ color: "#636985", fontSize: 12 }}> · {classLabel}</span> : null}</span> : "—"}</td>
                            <td style={S.td}><span style={S.badge("purple")}>{s.role === "autre" && s.customRole ? s.customRole : (ROLES[s.role] || s.role)}</span></td>
                            <td style={S.td}>
                              <span style={{ ...S.badge(s.status === "actif" ? "green" : "red"), cursor: role === "admin" ? "pointer" : "default" }} onClick={() => role === "admin" && toggleStaffStatus(s.id)}>
                                {s.status}
                              </span>
                            </td>
                            {role === "admin" && (
                              <td style={S.td}>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <Btn variant="ghost" small onClick={() => { setForm({ ...s, password: "" }); setModal("editStaff"); }}>Modifier</Btn>
                                  <Btn variant="danger" small onClick={() => delStaffMember(s.id)}>Suppr.</Btn>
                                </div>
                              </td>
                            )}
                          </tr>
                        ); })}
                        {filteredStaff.length === 0 && (
                          <tr><td colSpan={role === "admin" ? 5 : 4}><EmptyState icon="◉" title={search ? "Aucun résultat" : "Aucun compte créé"} subtitle={search ? "Essayez un autre terme" : role === "admin" ? "Créez votre premier compte personnel" : "Aucun personnel enregistré"} /></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {(modal === "addStaff" || modal === "editStaff") && (
                  <Modal2
                    title={modal === "editStaff" ? "Modifier le Compte" : "Créer un Compte"}
                    onClose={() => setModal(null)}
                    footer={
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
                        <Btn onClick={modal === "editStaff" ? editStaffMember : addStaffMember} loading={saving}>Enregistrer</Btn>
                      </div>
                    }
                  >
                    <Field label="Nom complet" value={form.name || ""} onChange={v => setForm({ ...form, name: v })} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Identifiant" value={form.username || ""} onChange={v => setForm({ ...form, username: v })} />
                      <Field label={modal === "editStaff" ? "Nouveau mot de passe (vide = inchangé)" : "Mot de passe"} value={form.password || ""} onChange={v => setForm({ ...form, password: v })} type="password" placeholder={modal === "editStaff" ? "Laisser vide" : "Min. 6 caractères"} />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <div style={S.label}>Rôle</div>
                      <select style={S.input} value={form.role || "secretaire"} onChange={e => setForm({ ...form, role: e.target.value, customRole: "" })}>
                        {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      {form.role === "autre" && (
                        <input style={{ ...S.input, marginTop: 8 }} placeholder="Précisez le rôle…" value={form.customRole || ""} onChange={e => setForm({ ...form, customRole: e.target.value })} />
                      )}
                    </div>
                    {(form.role === "enseignant" || form.role === "titulaire") && (
                      <Field label="Matière enseignée" value={form.subject || ""} onChange={v => setForm({ ...form, subject: v })} placeholder="Ex: Mathématiques, Français…" />
                    )}
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#7C6BFF", textTransform: "uppercase", letterSpacing: 1, margin: "4px 0 10px" }}>Rémunération</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Type de paie</div>
                        <select style={S.input} value={form.salaryType || "monthly"} onChange={e => setForm({ ...form, salaryType: e.target.value })}>
                          <option value="monthly">Salaire mensuel</option>
                          <option value="hourly">Taux horaire</option>
                        </select>
                      </div>
                      {(form.salaryType || "monthly") === "monthly"
                        ? <Field label="Salaire mensuel (FCFA)" value={form.salaryAmount || ""} onChange={v => setForm({ ...form, salaryAmount: v.replace(/[^0-9]/g, "") })} placeholder="150000" />
                        : <Field label="Taux horaire (FCFA/h)" value={form.hourlyRate || ""} onChange={v => setForm({ ...form, hourlyRate: v.replace(/[^0-9]/g, "") })} placeholder="5000" />
                      }
                    </div>
                  </Modal2>
                )}
              </div>
            )}

            {/* Finances */}
            {page === "fin" && (role === "admin" || role === "comptable") && (
              <div>
                {/* Sub-tabs */}
                <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#161822", border: "1px solid #2A2E42", borderRadius: 8, padding: 4, width: "fit-content" }}>
                  {[["txn", "Transactions"], ["payroll", "Paie du Personnel"], ["rapports", "Rapports"]].map(([k, l]) => (
                    <button key={k} onClick={() => setForm({ ...form, finTab: k })} style={{ padding: "6px 18px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: (form.finTab || "txn") === k ? "#7C6BFF" : "transparent", color: (form.finTab || "txn") === k ? "#fff" : "#636985", transition: "all 0.15s" }}>{l}</button>
                  ))}
                </div>

                {/* ── Payroll tab ── */}
                {(form.finTab || "txn") === "payroll" && (() => {
                  const now = new Date();
                  const payrollMonth = form.payrollMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                  const activeStaff = staff.filter(s => s.status === "actif");
                  const monthPayroll = payroll.filter(p => p.month === payrollMonth);
                  const totalDue = activeStaff.reduce((sum, s) => {
                    if (s.salaryType === "hourly") {
                      const rec = monthPayroll.find(p => p.staffId === s.id);
                      return sum + (Number(rec?.hours || 0) * Number(s.hourlyRate || 0));
                    }
                    return sum + Number(s.salaryAmount || 0);
                  }, 0);
                  const totalPaid = monthPayroll.filter(p => p.paid).reduce((sum, p) => sum + (p.amount || 0), 0);
                  return (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <h2 style={{ margin: 0 }}>Paie du Personnel</h2>
                          <input type="month" style={{ ...S.input, width: "auto", marginTop: 0 }} value={payrollMonth} onChange={e => setForm({ ...form, payrollMonth: e.target.value })} />
                        </div>
                        <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                          <span style={{ color: "#636985" }}>Total dû: <strong style={{ color: "#E8EAF0" }}>{fmtCFA(totalDue)}</strong></span>
                          <span style={{ color: "#636985" }}>Payé: <strong style={{ color: "#00B894" }}>{fmtCFA(totalPaid)}</strong></span>
                          <span style={{ color: "#636985" }}>Reste: <strong style={{ color: totalDue - totalPaid > 0 ? "#FF6B6B" : "#00B894" }}>{fmtCFA(totalDue - totalPaid)}</strong></span>
                        </div>
                      </div>
                      {activeStaff.length === 0
                        ? <EmptyState icon="◉" title="Aucun personnel actif" subtitle="Ajoutez du personnel depuis l'onglet Personnel" />
                        : (
                          <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                            <table style={S.table}>
                              <thead><tr>
                                <th style={S.th}>Nom</th>
                                <th style={S.th}>Rôle</th>
                                <th style={S.th}>Type</th>
                                <th style={S.th}>Heures / Montant</th>
                                <th style={S.th}>À payer</th>
                                <th style={S.th}>Statut</th>
                              </tr></thead>
                              <tbody>
                                {activeStaff.map(s => {
                                  const rec = monthPayroll.find(p => p.staffId === s.id);
                                  const isHourly = s.salaryType === "hourly";
                                  const hours = rec?.hours ?? "";
                                  const due = isHourly ? Number(hours || 0) * Number(s.hourlyRate || 0) : Number(s.salaryAmount || 0);
                                  const updateRec = async (patch) => {
                                    const updated = payroll.filter(p => !(p.staffId === s.id && p.month === payrollMonth));
                                    const base = rec || { id: genId(), staffId: s.id, staffName: s.name, month: payrollMonth };
                                    const newRec = { ...base, ...patch };
                                    if (!newRec.amount) newRec.amount = due;
                                    const newList = [...updated, newRec];
                                    await savePayroll(newList);
                                    if (patch.paid && !rec?.paid) {
                                      await saveFin([...finances, { id: genId(), label: `Salaire — ${s.name}`, amount: newRec.amount, type: "expense", category: "Salaires", date: new Date().toISOString().slice(0, 10), note: `${payrollMonth}${isHourly ? ` · ${hours}h` : ""}` }]);
                                    }
                                  };
                                  return (
                                    <tr key={s.id}>
                                      <td style={{ ...S.td, fontWeight: 500, color: "#E8EAF0" }}>{s.name}</td>
                                      <td style={S.td}><span style={S.badge("purple")}>{s.role === "autre" && s.customRole ? s.customRole : (ROLES[s.role] || s.role)}</span></td>
                                      <td style={S.td}><span style={S.badge(isHourly ? "blue" : "green")}>{isHourly ? "Horaire" : "Mensuel"}</span></td>
                                      <td style={S.td}>
                                        {isHourly
                                          ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <input type="number" min="0" disabled={rec?.paid} style={{ ...S.input, width: 70, marginTop: 0, padding: "4px 8px" }} value={hours} placeholder="0" onChange={e => updateRec({ hours: e.target.value, amount: Number(e.target.value) * Number(s.hourlyRate || 0) })} />
                                              <span style={{ fontSize: 11, color: "#636985" }}>h × {fmtCFA(Number(s.hourlyRate || 0))}</span>
                                            </div>
                                          : <span style={{ fontSize: 13 }}>{s.salaryAmount ? fmtCFA(Number(s.salaryAmount)) : <span style={{ color: "#636985" }}>—</span>}</span>
                                        }
                                      </td>
                                      <td style={{ ...S.td, fontWeight: 600, color: "#E8EAF0" }}>{due > 0 ? fmtCFA(due) : "—"}</td>
                                      <td style={S.td}>
                                        <span style={{ ...S.badge(rec?.paid ? "green" : "red"), cursor: rec?.paid ? "default" : "pointer" }}
                                          onClick={() => { if (!rec?.paid) updateRec({ paid: true, amount: due, paidDate: new Date().toISOString().slice(0, 10) }); }}>
                                          {rec?.paid ? `Payé ${rec.paidDate || ""}` : "Impayé"}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )
                      }
                    </div>
                  );
                })()}

                {/* ── Transactions tab ── */}
                {(form.finTab || "txn") === "txn" && <>
                {/* Summary cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                  <div style={S.stat}>
                    <div style={S.label}>Solde Total</div>
                    <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: finTotals.balance >= 0 ? "#00B894" : "#FF6B6B" }}>{fmtCFA(finTotals.balance)}</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.label}>Revenus (total)</div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{fmtCFA(finTotals.income)}</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.label}>Dépenses (total)</div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#FF6B6B" }}>{fmtCFA(finTotals.expense)}</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.label}>Ce mois</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8, color: finTotals.monthBalance >= 0 ? "#00B894" : "#FF6B6B" }}>{finTotals.monthBalance >= 0 ? "+" : ""}{fmtCFA(finTotals.monthBalance)}</div>
                    <div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>+{fmtCFA(finTotals.monthIncome)} / -{fmtCFA(finTotals.monthExpense)}</div>
                  </div>
                </div>

                {/* Monthly bar chart */}
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Aperçu Mensuel ({new Date().getFullYear()})</h3></div>
                  <div style={{ padding: 20 }}>
                    {(() => {
                      const year = new Date().getFullYear();
                      const monthData = FIN_MONTHS.map((m, i) => {
                        const prefix = year + "-" + String(i + 1).padStart(2, "0");
                        const inc = finances.filter(t => t.type === "income" && t.date?.startsWith(prefix)).reduce((a, t) => a + t.amount, 0);
                        const exp = finances.filter(t => t.type === "expense" && t.date?.startsWith(prefix)).reduce((a, t) => a + t.amount, 0);
                        return { m, inc, exp };
                      });
                      const maxVal = Math.max(...monthData.map(d => Math.max(d.inc, d.exp)), 1);
                      return (
                        <div style={{ display: "flex", gap: 8, alignItems: "end", height: 120 }}>
                          {monthData.map((d, i) => (
                            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <div style={{ display: "flex", gap: 2, alignItems: "end", height: 100, width: "100%" }}>
                                <div style={{ flex: 1, background: "#00B894", borderRadius: "3px 3px 0 0", height: `${(d.inc / maxVal) * 100}%`, minHeight: d.inc > 0 ? 4 : 0, transition: "height 0.3s" }} title={`Revenus: ${fmtCFA(d.inc)}`} />
                                <div style={{ flex: 1, background: "#FF6B6B", borderRadius: "3px 3px 0 0", height: `${(d.exp / maxVal) * 100}%`, minHeight: d.exp > 0 ? 4 : 0, transition: "height 0.3s" }} title={`Dépenses: ${fmtCFA(d.exp)}`} />
                              </div>
                              <div style={{ fontSize: 10, color: "#636985" }}>{d.m}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9BA1B7" }}><div style={{ width: 10, height: 10, borderRadius: 2, background: "#00B894" }} /> Revenus</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9BA1B7" }}><div style={{ width: 10, height: 10, borderRadius: 2, background: "#FF6B6B" }} /> Dépenses</div>
                    </div>
                  </div>
                </div>

                {/* Transactions table */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                  <SearchBar value={search} onChange={setSearch} placeholder="Rechercher une transaction..." />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="success" onClick={() => { setForm({ label: "", amount: "", type: "income", category: FIN_CATEGORIES.income[0], date: new Date().toISOString().slice(0, 10), note: "" }); setModal("addFin"); }}>+ Revenu</Btn>
                    <Btn variant="danger" onClick={() => { setForm({ label: "", amount: "", type: "expense", category: FIN_CATEGORIES.expense[0], date: new Date().toISOString().slice(0, 10), note: "" }); setModal("addFin"); }}>+ Dépense</Btn>
                  </div>
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr><th style={S.th}>Date</th><th style={S.th}>Libellé</th><th style={S.th}>Catégorie</th><th style={S.th}>Montant</th><th style={S.th}>Actions</th></tr></thead>
                      <tbody>
                        {[...filteredFinances].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(t => (
                          <tr key={t.id}>
                            <td style={S.td}>{t.date}</td>
                            <td style={{ ...S.td, fontWeight: 500, color: "#E8EAF0" }}>{t.label}{t.note && <div style={{ fontSize: 11, color: "#636985" }}>{t.note}</div>}</td>
                            <td style={S.td}><span style={S.badge(t.type === "income" ? "green" : "red")}>{t.category}</span></td>
                            <td style={{ ...S.td, fontWeight: 600, color: t.type === "income" ? "#00B894" : "#FF6B6B" }}>{t.type === "income" ? "+" : "-"}{fmtCFA(t.amount)}</td>
                            <td style={S.td}>
                              <div style={{ display: "flex", gap: 6 }}>
                                {(role === "admin" || role === "comptable") && <Btn variant="ghost" small onClick={() => { setForm({ ...t }); setModal("editFin"); }}>Modifier</Btn>}
                                {role === "admin" && <Btn variant="danger" small onClick={() => delTransaction(t.id)}>Suppr.</Btn>}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredFinances.length === 0 && (
                          <tr><td colSpan={5}><EmptyState icon="◆" title={search ? "Aucun résultat" : "Aucune transaction"} subtitle={search ? "Essayez un autre terme" : "Ajoutez un revenu ou une dépense"} /></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Add/Edit transaction modal */}
                {(modal === "addFin" || modal === "editFin") && (
                  <Modal2
                    title={modal === "editFin" ? "Modifier la Transaction" : (form.type === "income" ? "Nouveau Revenu" : "Nouvelle Dépense")}
                    onClose={() => setModal(null)}
                    footer={
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
                        <Btn onClick={modal === "editFin" ? editTransaction : addTransaction} loading={saving}>Enregistrer</Btn>
                      </div>
                    }
                  >
                    <Field label="Libellé" value={form.label || ""} onChange={v => setForm({ ...form, label: v })} placeholder="Ex: Frais de scolarité - Diallo" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Montant (FCFA)" value={form.amount || ""} onChange={v => setForm({ ...form, amount: v.replace(/[^0-9]/g, "") })} placeholder="50000" />
                      <Field label="Date" value={form.date || ""} onChange={v => setForm({ ...form, date: v })} type="date" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Type</div>
                        <select style={S.input} value={form.type || "income"} onChange={e => setForm({ ...form, type: e.target.value, category: FIN_CATEGORIES[e.target.value]?.[0] || "" })}>
                          <option value="income">Revenu</option>
                          <option value="expense">Dépense</option>
                        </select>
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Catégorie</div>
                        <select style={S.input} value={form.category || ""} onChange={e => setForm({ ...form, category: e.target.value, categoryCustom: "" })}>
                          {(FIN_CATEGORIES[form.type] || FIN_CATEGORIES.income).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {(form.category === "Autre revenu" || form.category === "Autre dépense") && (
                          <input style={{ ...S.input, marginTop: 6 }} placeholder="Précisez la catégorie…" value={form.categoryCustom || ""} onChange={e => setForm({ ...form, categoryCustom: e.target.value })} />
                        )}
                      </div>
                    </div>
                    <Field label="Note (optionnel)" value={form.note || ""} onChange={v => setForm({ ...form, note: v })} placeholder="Détails supplémentaires" />
                  </Modal2>
                )}
                </>}

                {/* ── Rapports tab ── */}
                {form.finTab === "rapports" && (() => {
                  const period = form.rapportPeriod || "mensuel";
                  const now = new Date();
                  const getTrimester = (dateStr) => {
                    const m = new Date(dateStr).getMonth() + 1; // 1-12
                    if (m >= 10 || m <= 12) return "T1";
                    if (m >= 1 && m <= 3) return "T2";
                    if (m >= 4 && m <= 6) return "T3";
                    return null;
                  };
                  const currentTrimester = getTrimester(now.toISOString());
                  const selectedTrimester = form.rapportTrimester || currentTrimester || "T1";
                  const selectedMonth = form.rapportMonth || now.toISOString().slice(0, 7);
                  const selectedWeek = form.rapportWeek || now.toISOString().slice(0, 10);
                  const selectedDay = form.rapportDay || now.toISOString().slice(0, 10);

                  const inPeriod = (dateStr) => {
                    if (!dateStr) return false;
                    if (period === "journalier") return dateStr === selectedDay;
                    if (period === "hebdomadaire") {
                      const d = new Date(dateStr), ref = new Date(selectedWeek);
                      const startOfWeek = new Date(ref); startOfWeek.setDate(ref.getDate() - ref.getDay() + 1);
                      const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
                      return d >= startOfWeek && d <= endOfWeek;
                    }
                    if (period === "mensuel") return dateStr.startsWith(selectedMonth);
                    if (period === "trimestriel") return getTrimester(dateStr) === selectedTrimester;
                    return false;
                  };

                  const finRows = finances.filter(t => inPeriod(t.date)).map(t => ({ ...t, source: "txn" }));
                  const payRows = studentPayments.filter(p => inPeriod(p.date)).map(p => {
                    const stu = students.find(s => s.id === p.studentId);
                    return { id: p.id, date: p.date, label: stu ? `Paiement — ${stu.name}` : "Paiement élève", amount: p.amount, type: "income", category: "Frais de scolarité", note: p.note, source: "pay" };
                  });
                  const allRows = [...finRows, ...payRows].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                  const totalIn = allRows.filter(r => r.type === "income").reduce((a, r) => a + Number(r.amount), 0);
                  const totalOut = allRows.filter(r => r.type === "expense").reduce((a, r) => a + Number(r.amount), 0);

                  return (
                    <div>
                      {/* Controls */}
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
                        <div style={{ display: "flex", gap: 4, background: "#161822", border: "1px solid #2A2E42", borderRadius: 8, padding: 4 }}>
                          {[["journalier","Jour"],["hebdomadaire","Semaine"],["mensuel","Mois"],["trimestriel","Trimestre"]].map(([k,l]) => (
                            <button key={k} onClick={() => setForm({ ...form, rapportPeriod: k })} style={{ padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: period === k ? "#7C6BFF" : "transparent", color: period === k ? "#fff" : "#636985" }}>{l}</button>
                          ))}
                        </div>
                        {period === "journalier" && <input type="date" style={{ ...S.input, width: "auto", marginTop: 0 }} value={selectedDay} onChange={e => setForm({ ...form, rapportDay: e.target.value })} />}
                        {period === "hebdomadaire" && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#9BA1B7" }}><span>Semaine du</span><input type="date" style={{ ...S.input, width: "auto", marginTop: 0 }} value={selectedWeek} onChange={e => setForm({ ...form, rapportWeek: e.target.value })} /></div>}
                        {period === "mensuel" && <input type="month" style={{ ...S.input, width: "auto", marginTop: 0 }} value={selectedMonth} onChange={e => setForm({ ...form, rapportMonth: e.target.value })} />}
                        {period === "trimestriel" && (
                          <select style={{ ...S.input, width: "auto", marginTop: 0 }} value={selectedTrimester} onChange={e => setForm({ ...form, rapportTrimester: e.target.value })}>
                            <option value="T1">T1 (Oct–Déc)</option>
                            <option value="T2">T2 (Jan–Mar)</option>
                            <option value="T3">T3 (Avr–Juin)</option>
                          </select>
                        )}
                      </div>
                      {/* Summary cards */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 24 }}>
                        {[["Encaissé", fmtCFA(totalIn), "green"],["Dépensé", fmtCFA(totalOut), "red"],["Solde", fmtCFA(totalIn - totalOut), totalIn - totalOut >= 0 ? "green" : "red"]].map(([l,v,c]) => (
                          <div key={l} style={{ ...S.stat, borderColor: c === "green" ? "rgba(0,184,148,0.2)" : "rgba(255,107,107,0.2)" }}>
                            <div style={{ fontSize: 11, color: "#636985", textTransform: "uppercase", marginBottom: 6 }}>{l}</div>
                            <div style={{ fontSize: 20, fontWeight: 700, color: c === "green" ? "#00B894" : "#FF6B6B" }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {/* Table */}
                      <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                        <div style={{ overflowX: "auto" }}>
                          <table style={S.table}>
                            <thead><tr><th style={S.th}>Date</th><th style={S.th}>Libellé</th><th style={S.th}>Catégorie</th><th style={S.th}>Type</th><th style={S.th}>Montant</th></tr></thead>
                            <tbody>
                              {allRows.map(r => (
                                <tr key={r.id + r.source}>
                                  <td style={S.td}>{r.date}</td>
                                  <td style={{ ...S.td, color: "#E8EAF0" }}>{r.label}</td>
                                  <td style={S.td}>{r.category}</td>
                                  <td style={S.td}><span style={S.badge(r.type === "income" ? "green" : "red")}>{r.type === "income" ? "Revenu" : "Dépense"}</span></td>
                                  <td style={{ ...S.td, fontWeight: 600, color: r.type === "income" ? "#00B894" : "#FF6B6B" }}>{fmtCFA(Number(r.amount))}</td>
                                </tr>
                              ))}
                              {allRows.length === 0 && <tr><td colSpan={5}><EmptyState icon="◆" title="Aucune transaction" subtitle="Pour la période sélectionnée" /></td></tr>}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Budget */}
            {page === "budget" && role === "admin" && (
              <div>
                {/* Year selector */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Btn variant="ghost" small onClick={() => setBudgetYear(y => y - 1)}>←</Btn>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>{budgetYear}</span>
                    <Btn variant="ghost" small onClick={() => setBudgetYear(y => y + 1)}>→</Btn>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="ghost" small onClick={() => {
                      const months = FIN_MONTHS.map((_, i) => budgetYear + "-" + String(i + 1).padStart(2, "0"));
                      const occupied = budgets.filter(b => b.year === budgetYear).map(b => b.month);
                      const available = months.filter(m => !occupied.includes(m) || true);
                      setForm({ fromMonth: available[0] || months[0], toMonth: months[1] || months[0] });
                      setModal("copyBudget");
                    }}>⤻ Copier un mois</Btn>
                    <Btn onClick={() => {
                      const defMonth = budgetYear + "-" + String(new Date().getMonth() + 1).padStart(2, "0");
                      setForm({ category: BUDGET_CATEGORIES.expense[0], type: "expense", planned: "", month: defMonth, scope: "monthly", activity: "", note: "" });
                      setModal("addBudget");
                    }}>+ Ajouter un budget</Btn>
                  </div>
                </div>

                {/* Over-budget alerts */}
                {budgetData.overBudgetItems.length > 0 && (
                  <div style={{ background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 10, padding: 16, marginBottom: 20 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#FF6B6B", marginBottom: 8 }}>Alertes dépassement de budget</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {budgetData.overBudgetItems.map(c => (
                        <span key={c.cat} style={{ ...S.badge("red"), fontSize: 12 }}>
                          {c.cat}: +{fmtCFA(c.diff)} au-dessus
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                  <div style={S.stat}>
                    <div style={S.label}>Budget Annuel Net</div>
                    <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: budgetData.plannedBalance >= 0 ? "#00B894" : "#FF6B6B" }}>{fmtCFA(budgetData.plannedBalance)}</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.label}>Budget Revenus</div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#00B894" }}>{fmtCFA(budgetData.plannedIncome)}</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.label}>Budget Dépenses</div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: "#FF6B6B" }}>{fmtCFA(budgetData.plannedExpense)}</div>
                  </div>
                  <div style={S.stat}>
                    <div style={S.label}>Réel vs Budget (dépenses)</div>
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 8, color: budgetData.actualExpense <= budgetData.plannedExpense ? "#00B894" : "#FF6B6B" }}>
                      {budgetData.plannedExpense > 0 ? Math.round((budgetData.actualExpense / budgetData.plannedExpense) * 100) : 0}%
                    </div>
                    <div style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>{fmtCFA(budgetData.actualExpense)} / {fmtCFA(budgetData.plannedExpense)}</div>
                  </div>
                </div>

                {/* Monthly budget vs actual chart */}
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Budget vs Réel par Mois ({budgetYear})</h3></div>
                  <div style={{ padding: 20 }}>
                    {(() => {
                      const maxVal = Math.max(...budgetData.byMonth.map(d => Math.max(d.plannedExp, d.actualExp, d.plannedInc, d.actualInc)), 1);
                      return (
                        <div style={{ display: "flex", gap: 6, alignItems: "end", height: 130 }}>
                          {budgetData.byMonth.map((d, i) => (
                            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <div style={{ display: "flex", gap: 1, alignItems: "end", height: 110, width: "100%" }}>
                                <div style={{ flex: 1, background: "rgba(108,92,231,0.4)", borderRadius: "2px 2px 0 0", height: `${(d.plannedExp / maxVal) * 100}%`, minHeight: d.plannedExp > 0 ? 3 : 0 }} title={`Budget dép.: ${fmtCFA(d.plannedExp)}`} />
                                <div style={{ flex: 1, background: "#FF6B6B", borderRadius: "2px 2px 0 0", height: `${(d.actualExp / maxVal) * 100}%`, minHeight: d.actualExp > 0 ? 3 : 0 }} title={`Réel dép.: ${fmtCFA(d.actualExp)}`} />
                                <div style={{ flex: 1, background: "rgba(0,184,148,0.4)", borderRadius: "2px 2px 0 0", height: `${(d.plannedInc / maxVal) * 100}%`, minHeight: d.plannedInc > 0 ? 3 : 0 }} title={`Budget rev.: ${fmtCFA(d.plannedInc)}`} />
                                <div style={{ flex: 1, background: "#00B894", borderRadius: "2px 2px 0 0", height: `${(d.actualInc / maxVal) * 100}%`, minHeight: d.actualInc > 0 ? 3 : 0 }} title={`Réel rev.: ${fmtCFA(d.actualInc)}`} />
                              </div>
                              <div style={{ fontSize: 10, color: "#636985" }}>{d.month}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9BA1B7" }}><div style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(108,92,231,0.4)" }} /> Budget Dép.</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9BA1B7" }}><div style={{ width: 10, height: 10, borderRadius: 2, background: "#FF6B6B" }} /> Réel Dép.</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9BA1B7" }}><div style={{ width: 10, height: 10, borderRadius: 2, background: "rgba(0,184,148,0.4)" }} /> Budget Rev.</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9BA1B7" }}><div style={{ width: 10, height: 10, borderRadius: 2, background: "#00B894" }} /> Réel Rev.</div>
                    </div>
                  </div>
                </div>

                {/* Budget vs Actual by category */}
                {budgetData.byCat.length > 0 && (
                  <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden", marginBottom: 28 }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42" }}><h3>Budget vs Réel par Catégorie</h3></div>
                    <div style={{ padding: 20 }}>
                      {budgetData.byCat.map(c => {
                        const maxBar = Math.max(c.planned, c.actual, 1);
                        return (
                          <div key={c.cat} style={{ marginBottom: 14 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <span style={{ fontSize: 13, color: "#E8EAF0" }}>{c.cat}</span>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {c.overBudget && <span style={S.badge("red")}>+{fmtCFA(c.diff)}</span>}
                                <span style={{ fontSize: 12, color: "#636985" }}>{fmtCFA(c.actual)} / {fmtCFA(c.planned)}</span>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: 4, height: 8 }}>
                              <div style={{ flex: `${c.planned / maxBar}`, background: "rgba(108,92,231,0.4)", borderRadius: 4, minWidth: c.planned > 0 ? 4 : 0 }} />
                              <div style={{ flex: `${c.actual / maxBar}`, background: c.overBudget ? "#FF6B6B" : "#00B894", borderRadius: 4, minWidth: c.actual > 0 ? 4 : 0 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Budget entries table */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                  <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un budget..." />
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr><th style={S.th}>Période</th><th style={S.th}>Catégorie</th><th style={S.th}>Type</th><th style={S.th}>Montant Prévu</th><th style={S.th}>Note</th><th style={S.th}>Actions</th></tr></thead>
                      <tbody>
                        {[...filteredBudgets].sort((a, b) => (a.scope || "monthly").localeCompare(b.scope || "monthly") || (a.month || "").localeCompare(b.month || "") || a.category.localeCompare(b.category)).map(b => (
                          <tr key={b.id}>
                            <td style={S.td}>
                              {(!b.scope || b.scope === "monthly") && b.month ? `${FIN_MONTHS[Number(b.month.split("-")[1]) - 1] || ""} ${b.month.split("-")[0]}` : b.scope === "annual" ? `Annuel ${b.year}` : b.activity || "—"}
                              {b.scope && b.scope !== "monthly" && <span style={{ ...S.badge(b.scope === "annual" ? "blue" : "purple"), marginLeft: 6, fontSize: 10 }}>{b.scope === "annual" ? "Annuel" : "Activité"}</span>}
                            </td>
                            <td style={{ ...S.td, fontWeight: 500, color: "#E8EAF0" }}>{b.category}</td>
                            <td style={S.td}><span style={S.badge(b.type === "income" ? "green" : "red")}>{b.type === "income" ? "Revenu" : "Dépense"}</span></td>
                            <td style={{ ...S.td, fontWeight: 600, color: b.type === "income" ? "#00B894" : "#FF6B6B" }}>{fmtCFA(b.planned)}</td>
                            <td style={{ ...S.td, fontSize: 12, color: "#636985" }}>{b.note || "—"}</td>
                            <td style={S.td}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <Btn variant="ghost" small onClick={() => { setForm({ ...b, scope: b.scope || "monthly", activity: b.activity || "" }); setModal("editBudget"); }}>Modifier</Btn>
                                <Btn variant="danger" small onClick={() => delBudgetEntry(b.id)}>Suppr.</Btn>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {filteredBudgets.length === 0 && (
                          <tr><td colSpan={6}><EmptyState icon="◇" title={search ? "Aucun résultat" : "Aucun budget défini"} subtitle={search ? "Essayez un autre terme" : "Ajoutez votre premier budget"} /></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Add/Edit budget modal */}
                {(modal === "addBudget" || modal === "editBudget") && (
                  <Modal2
                    title={modal === "editBudget" ? "Modifier le Budget" : "Nouveau Budget"}
                    onClose={() => setModal(null)}
                    footer={
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
                        <Btn onClick={modal === "editBudget" ? editBudgetEntry : addBudgetEntry} loading={saving}>Enregistrer</Btn>
                      </div>
                    }
                  >
                    <div style={{ marginBottom: 16 }}>
                      <div style={S.label}>Portée</div>
                      <select style={S.input} value={form.scope || "monthly"} onChange={e => setForm({ ...form, scope: e.target.value })}>
                        <option value="monthly">Mensuel</option>
                        <option value="annual">Annuel</option>
                        <option value="activity">Par activité</option>
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Type</div>
                        <select style={S.input} value={form.type || "expense"} onChange={e => setForm({ ...form, type: e.target.value, category: BUDGET_CATEGORIES[e.target.value]?.[0] || "" })}>
                          <option value="income">Revenu</option>
                          <option value="expense">Dépense</option>
                        </select>
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Catégorie</div>
                        <select style={S.input} value={form.category || ""} onChange={e => setForm({ ...form, category: e.target.value, budgetCatCustom: "" })}>
                          {(BUDGET_CATEGORIES[form.type] || BUDGET_CATEGORIES.expense).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {(form.category === "Autre revenu" || form.category === "Autre dépense") && (
                          <input style={{ ...S.input, marginTop: 6 }} placeholder="Précisez la catégorie…" value={form.budgetCatCustom || ""} onChange={e => setForm({ ...form, budgetCatCustom: e.target.value })} />
                        )}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Montant prévu (FCFA)" value={form.planned || ""} onChange={v => setForm({ ...form, planned: v.replace(/[^0-9]/g, "") })} placeholder="500000" />
                      {(!form.scope || form.scope === "monthly") && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={S.label}>Mois</div>
                          <input style={S.input} type="month" value={form.month || ""} onChange={e => setForm({ ...form, month: e.target.value })} />
                        </div>
                      )}
                      {form.scope === "activity" && (
                        <Field label="Nom de l'activité" value={form.activity || ""} onChange={v => setForm({ ...form, activity: v })} placeholder="Ex: Fête de fin d'année" />
                      )}
                    </div>
                    <Field label="Note (optionnel)" value={form.note || ""} onChange={v => setForm({ ...form, note: v })} placeholder="Détails supplémentaires" />
                  </Modal2>
                )}

                {/* Copy month modal */}
                {modal === "copyBudget" && (
                  <Modal2
                    title="Copier un Mois de Budget"
                    onClose={() => setModal(null)}
                    footer={
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
                        <Btn onClick={copyBudgetMonth} loading={saving}>Copier</Btn>
                      </div>
                    }
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Mois source</div>
                        <input style={S.input} type="month" value={form.fromMonth || ""} onChange={e => setForm({ ...form, fromMonth: e.target.value })} />
                      </div>
                      <div style={{ marginBottom: 16 }}>
                        <div style={S.label}>Mois destination</div>
                        <input style={S.input} type="month" value={form.toMonth || ""} onChange={e => setForm({ ...form, toMonth: e.target.value })} />
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#636985" }}>Toutes les entrées du mois source seront dupliquées vers le mois destination.</div>
                  </Modal2>
                )}
              </div>
            )}

            {/* Classes */}
            {page === "cls" && (role === "admin" || role === "directeur" || role === "secretaire") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2>Classes</h2>
                  <Btn onClick={() => { setForm({ name: "", level: NIV[0], section: "", teacherId: "", year: new Date().getFullYear() }); setModal("addCls"); }}>+ Nouvelle classe</Btn>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
                  {classes.length === 0 && <EmptyState icon="⊞" title="Aucune classe" subtitle="Créez votre première classe" />}
                  {classes.map(c => {
                    const teacher = staff.find(s => s.id === c.teacherId);
                    const count = students.filter(s => s.classId === c.id).length;
                    return (
                      <div key={c.id} style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 700 }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: "#636985", marginTop: 4 }}>{c.level}{c.section ? ` — ${c.section}` : ""} · {c.year}/{c.year + 1}</div>
                          </div>
                          <span style={S.badge("blue")}>{count} élèves</span>
                        </div>
                        {teacher && <div style={{ fontSize: 12, color: "#9BA1B7", marginTop: 8 }}>Prof principal: {teacher.name}</div>}
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                          <Btn variant="ghost" small onClick={() => { setForm({ ...c }); setModal("editCls"); }}>Modifier</Btn>
                          <Btn variant="ghost" small onClick={() => { setForm({ classId: c.id, className: c.name }); setModal("clsStudents"); }}>Élèves</Btn>
                          <Btn variant="danger" small onClick={() => askConfirm(`Supprimer « ${c.name} » ?`, async () => { await saveClasses(classes.filter(x => x.id !== c.id)); })}>Suppr.</Btn>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(modal === "addCls" || modal === "editCls") && (
                  <Modal2 title={modal === "editCls" ? "Modifier la classe" : "Nouvelle classe"} onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.name) return;
                      if (modal === "addCls") await saveClasses([...classes, { id: genId(), name: form.name, level: form.level, section: form.section || "", teacherId: form.teacherId || "", year: Number(form.year) || new Date().getFullYear() }]);
                      else await saveClasses(classes.map(c => c.id === form.id ? { ...c, name: form.name, level: form.level, section: form.section || "", teacherId: form.teacherId || "", year: Number(form.year) } : c));
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Niveau</div>
                        <select style={S.input} value={form.level || NIV[0]} onChange={e => setForm({ ...form, level: e.target.value })}>
                          {NIV.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <Field label="Section / Série" value={form.section || ""} onChange={v => setForm({ ...form, section: v })} placeholder="Ex: A, B, S, L…" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Nom de la classe" value={form.name || ""} onChange={v => setForm({ ...form, name: v })} placeholder="Ex: Terminale A" />
                      <Field label="Année scolaire" value={String(form.year || new Date().getFullYear())} onChange={v => setForm({ ...form, year: v })} placeholder="2026" />
                    </div>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Professeur principal</div>
                      <select style={S.input} value={form.teacherId || ""} onChange={e => setForm({ ...form, teacherId: e.target.value })}>
                        <option value="">— Aucun —</option>
                        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </Modal2>
                )}
                {modal === "clsStudents" && (
                  <Modal2 title={`Élèves — ${form.className}`} onClose={() => setModal(null)}
                    footer={<Btn variant="ghost" onClick={() => setModal(null)}>Fermer</Btn>}>
                    <div style={{ maxHeight: 400, overflowY: "auto" }}>
                      {students.map(s => (
                        <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #2A2E42" }}>
                          <span style={{ fontSize: 13 }}>{s.name}</span>
                          <Btn variant={s.classId === form.classId ? "danger" : "ghost"} small onClick={async () => {
                            await saveStu(students.map(x => x.id === s.id ? { ...x, classId: s.classId === form.classId ? null : form.classId } : x));
                          }}>{s.classId === form.classId ? "Retirer" : "Ajouter"}</Btn>
                        </div>
                      ))}
                    </div>
                  </Modal2>
                )}
              </div>
            )}

            {/* Présences */}
            {page === "att" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                  <h2>Présences</h2>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select style={{ ...S.input, width: "auto", marginTop: 0 }} value={form.attClass || ""} onChange={e => setForm({ ...form, attClass: e.target.value })}>
                      <option value="">— Choisir une classe —</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input style={{ ...S.input, width: "auto", marginTop: 0 }} type="date" value={form.attDate || new Date().toISOString().slice(0, 10)} onChange={e => setForm({ ...form, attDate: e.target.value })} />
                  </div>
                </div>
                {form.attClass ? (() => {
                  const cls = classes.find(c => c.id === form.attClass);
                  const clsStudents = students.filter(s => s.classId === form.attClass);
                  const date = form.attDate || new Date().toISOString().slice(0, 10);
                  const existing = attendance.filter(a => a.classId === form.attClass && a.date === date);
                  return (
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "16px 20px", borderBottom: "1px solid #2A2E42", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h3>{cls?.name} — {date}</h3>
                        <span style={{ fontSize: 12, color: "#636985" }}>{clsStudents.length} élèves</span>
                      </div>
                      {clsStudents.length === 0 ? <EmptyState icon="◎" title="Aucun élève dans cette classe" subtitle="Assignez des élèves depuis l'onglet Classes" /> : (
                        <div>
                          {clsStudents.map(s => {
                            const rec = existing.find(a => a.studentId === s.id);
                            const status = rec?.status || "present";
                            const setStatus = async (st) => {
                              const updated = attendance.filter(a => !(a.classId === form.attClass && a.date === date && a.studentId === s.id));
                              await saveAttendance([...updated, { id: genId(), classId: form.attClass, studentId: s.id, date, status: st, note: "" }]);
                            };
                            return (
                              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #1C1F2E" }}>
                                <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</span>
                                <div style={{ display: "flex", gap: 6 }}>
                                  {["present", "absent", "retard"].map(st => (
                                    <button key={st} onClick={() => setStatus(st)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, background: status === st ? (st === "present" ? "#00B894" : st === "absent" ? "#FF6B6B" : "#FDCB6E") : "#2A2E42", color: status === st ? "#fff" : "#636985" }}>
                                      {st === "present" ? "Présent" : st === "absent" ? "Absent" : "Retard"}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          <div style={{ padding: "12px 20px", display: "flex", gap: 16, fontSize: 12 }}>
                            <span style={{ color: "#00B894" }}>✓ {existing.filter(a => a.status === "present").length} présents</span>
                            <span style={{ color: "#FF6B6B" }}>✗ {existing.filter(a => a.status === "absent").length} absents</span>
                            <span style={{ color: "#FDCB6E" }}>⏱ {existing.filter(a => a.status === "retard").length} retards</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })() : <EmptyState icon="✓" title="Sélectionnez une classe et une date" subtitle="Pour enregistrer les présences" />}
              </div>
            )}

            {/* Notes */}
            {page === "grades" && (role === "admin" || role === "directeur" || role === "enseignant") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                  <h2>Notes</h2>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select style={{ ...S.input, width: "auto", marginTop: 0 }} value={form.gradeClass || ""} onChange={e => setForm({ ...form, gradeClass: e.target.value })}>
                      <option value="">— Classe —</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select style={{ ...S.input, width: "auto", marginTop: 0 }} value={form.gradeTerm || TERMS[0]} onChange={e => setForm({ ...form, gradeTerm: e.target.value })}>
                      {TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {form.gradeClass && <Btn onClick={() => { setForm({ ...form, gradeStudent: "", subject: SUBJECTS[0], score: "", maxScore: "20", gradeNote: "" }); setModal("addGrade"); }}>+ Ajouter une note</Btn>}
                  </div>
                </div>
                {form.gradeClass ? (() => {
                  const clsStudents = students.filter(s => s.classId === form.gradeClass);
                  const term = form.gradeTerm || TERMS[0];
                  const clsGrades = grades.filter(g => g.classId === form.gradeClass && g.term === term);
                  const subjects = [...new Set(clsGrades.map(g => g.subject))];
                  return subjects.length === 0 ? <EmptyState icon="✎" title="Aucune note pour cette classe" subtitle="Ajoutez des notes pour commencer" /> : (
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ overflowX: "auto" }}>
                        <table style={S.table}>
                          <thead><tr>
                            <th style={S.th}>Élève</th>
                            {subjects.map(s => <th key={s} style={S.th}>{s}</th>)}
                            <th style={S.th}>Moyenne</th>
                          </tr></thead>
                          <tbody>
                            {clsStudents.map(s => {
                              const stuGrades = clsGrades.filter(g => g.studentId === s.id);
                              const avg = stuGrades.length ? (stuGrades.reduce((a, g) => a + (g.score / g.maxScore) * 20, 0) / stuGrades.length).toFixed(2) : "—";
                              return (
                                <tr key={s.id}>
                                  <td style={{ ...S.td, fontWeight: 500 }}>{s.name}</td>
                                  {subjects.map(sub => {
                                    const g = stuGrades.find(x => x.subject === sub);
                                    return <td key={sub} style={{ ...S.td, textAlign: "center" }}>{g ? `${g.score}/${g.maxScore}` : "—"}</td>;
                                  })}
                                  <td style={{ ...S.td, fontWeight: 700, color: Number(avg) >= 10 ? "#00B894" : "#FF6B6B" }}>{avg}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })() : <EmptyState icon="✎" title="Sélectionnez une classe" subtitle="Pour voir et saisir les notes" />}
                {modal === "addGrade" && (
                  <Modal2 title="Saisir une note" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.gradeClass || !form.subject || form.score === "" || !form.gradeStudent) return;
                      const subj = form.subject === "Autre" && form.subjectCustom ? form.subjectCustom : form.subject;
                      await saveGrades([...grades, { id: genId(), classId: form.gradeClass, studentId: form.gradeStudent, subject: subj, score: Number(form.score), maxScore: Number(form.maxScore) || 20, term: form.gradeTerm || TERMS[0], year: new Date().getFullYear(), note: form.gradeNote || "" }]);
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Matière</div>
                        <select style={S.input} value={form.subject || SUBJECTS[0]} onChange={e => setForm({ ...form, subject: e.target.value, subjectCustom: "" })}>
                          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {form.subject === "Autre" && (
                          <input style={{ ...S.input, marginTop: 6 }} placeholder="Précisez la matière…" value={form.subjectCustom || ""} onChange={e => setForm({ ...form, subjectCustom: e.target.value })} />
                        )}
                      </div>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Élève</div>
                        <select style={S.input} value={form.gradeStudent || ""} onChange={e => setForm({ ...form, gradeStudent: e.target.value })}>
                          <option value="">— Choisir —</option>
                          {students.filter(s => s.classId === form.gradeClass).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Note obtenue" value={String(form.score ?? "")} onChange={v => setForm({ ...form, score: v })} placeholder="15" />
                      <Field label="Note maximale" value={String(form.maxScore || "20")} onChange={v => setForm({ ...form, maxScore: v })} placeholder="20" />
                    </div>
                    <Field label="Commentaire (optionnel)" value={form.gradeNote || ""} onChange={v => setForm({ ...form, gradeNote: v })} placeholder="Très bien..." />
                  </Modal2>
                )}
              </div>
            )}

            {/* Emploi du temps */}
            {page === "tmt" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                  <h2>Emploi du temps</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select style={{ ...S.input, width: "auto", marginTop: 0 }} value={form.tmtClass || ""} onChange={e => setForm({ ...form, tmtClass: e.target.value })}>
                      <option value="">— Classe —</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {form.tmtClass && <Btn onClick={() => { setForm({ ...form, editTmtId: null, tmtDay: DAYS[0], tmtSubject: SUBJECTS[0], tmtStart: "08:00", tmtEnd: "10:00", tmtTeacher: "", tmtRoom: "" }); setModal("addTmt"); }}>+ Ajouter</Btn>}
                  </div>
                </div>
                {form.tmtClass ? (() => {
                  const clsTmt = timetable.filter(t => t.classId === form.tmtClass);
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
                      {DAYS.map(day => (
                        <div key={day}>
                          <div style={{ padding: "8px 12px", background: "#2A2E42", borderRadius: 6, textAlign: "center", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{day}</div>
                          {clsTmt.filter(t => t.day === day).sort((a, b) => a.start.localeCompare(b.start)).map(t => {
                            const teacher = staff.find(s => s.id === t.teacherId);
                            return (
                              <div key={t.id} style={{ background: "#1C1F2E", border: "1px solid #2A2E42", borderRadius: 6, padding: 8, marginBottom: 6, fontSize: 11 }}>
                                <div style={{ fontWeight: 600, color: "#A29BFE" }}>{t.subject}</div>
                                <div style={{ color: "#636985", marginTop: 2 }}>{t.start}–{t.end}</div>
                                {teacher && <div style={{ color: "#9BA1B7", marginTop: 2 }}>{teacher.name}</div>}
                                {t.room && <div style={{ color: "#636985" }}>Salle {t.room}</div>}
                                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                                  <Btn variant="ghost" small onClick={() => { setForm({ ...form, editTmtId: t.id, tmtDay: t.day, tmtSubject: t.subject, tmtStart: t.start, tmtEnd: t.end, tmtTeacher: t.teacherId, tmtRoom: t.room || "" }); setModal("addTmt"); }}>✎</Btn>
                                  <Btn variant="danger" small onClick={() => askConfirm("Supprimer ce créneau ?", async () => { await saveTimetable(timetable.filter(x => x.id !== t.id)); })}>✕</Btn>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })() : <EmptyState icon="⊟" title="Sélectionnez une classe" subtitle="Pour voir son emploi du temps" />}
                {modal === "addTmt" && (
                  <Modal2 title="Créneau horaire" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.tmtClass || !form.tmtSubject) return;
                      const tmtSubj = form.tmtSubject === "Autre" && form.tmtSubjectCustom ? form.tmtSubjectCustom : form.tmtSubject;
                      const entry = { id: form.editTmtId || genId(), classId: form.tmtClass, day: form.tmtDay, subject: tmtSubj, start: form.tmtStart || "08:00", end: form.tmtEnd || "10:00", teacherId: form.tmtTeacher || "", room: form.tmtRoom || "" };
                      if (form.editTmtId) await saveTimetable(timetable.map(t => t.id === form.editTmtId ? entry : t));
                      else await saveTimetable([...timetable, entry]);
                      setForm({ ...form, editTmtId: null });
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Jour</div>
                        <select style={S.input} value={form.tmtDay || DAYS[0]} onChange={e => setForm({ ...form, tmtDay: e.target.value })}>
                          {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Matière</div>
                        <select style={S.input} value={form.tmtSubject || SUBJECTS[0]} onChange={e => setForm({ ...form, tmtSubject: e.target.value, tmtSubjectCustom: "" })}>
                          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {form.tmtSubject === "Autre" && (
                          <input style={{ ...S.input, marginTop: 6 }} placeholder="Précisez la matière…" value={form.tmtSubjectCustom || ""} onChange={e => setForm({ ...form, tmtSubjectCustom: e.target.value })} />
                        )}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Heure début" value={form.tmtStart || "08:00"} onChange={v => setForm({ ...form, tmtStart: v })} type="time" />
                      <Field label="Heure fin" value={form.tmtEnd || "10:00"} onChange={v => setForm({ ...form, tmtEnd: v })} type="time" />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Enseignant</div>
                        <select style={S.input} value={form.tmtTeacher || ""} onChange={e => setForm({ ...form, tmtTeacher: e.target.value })}>
                          <option value="">— Aucun —</option>
                          {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <Field label="Salle" value={form.tmtRoom || ""} onChange={v => setForm({ ...form, tmtRoom: v })} placeholder="Ex: Salle 12" />
                    </div>
                  </Modal2>
                )}
              </div>
            )}

            {/* Examens */}
            {page === "exams" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2>Examens</h2>
                  <Btn onClick={() => { setForm({ examName: "", examClass: "", examSubject: SUBJECTS[0], examDate: "", examDuration: "120", examRoom: "", editExamId: null }); setModal("addExam"); }}>+ Nouvel examen</Btn>
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr><th style={S.th}>Examen</th><th style={S.th}>Classe</th><th style={S.th}>Matière</th><th style={S.th}>Date</th><th style={S.th}>Durée</th><th style={S.th}>Salle</th><th style={S.th}>Actions</th></tr></thead>
                      <tbody>
                        {exams.length === 0 && <tr><td colSpan={7}><EmptyState icon="⊗" title="Aucun examen planifié" /></td></tr>}
                        {[...exams].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(e => {
                          const cls = classes.find(c => c.id === e.classId);
                          return (
                            <tr key={e.id}>
                              <td style={{ ...S.td, fontWeight: 600 }}>{e.name}</td>
                              <td style={S.td}>{cls?.name || "—"}</td>
                              <td style={S.td}>{e.subject}</td>
                              <td style={S.td}>{e.date || "—"}</td>
                              <td style={S.td}>{e.duration} min</td>
                              <td style={S.td}>{e.room || "—"}</td>
                              <td style={S.td}><div style={{ display: "flex", gap: 6 }}>
                                <Btn variant="ghost" small onClick={() => { setForm({ examName: e.name, examClass: e.classId, examSubject: e.subject, examDate: e.date, examDuration: String(e.duration), examRoom: e.room || "", editExamId: e.id }); setModal("addExam"); }}>Modifier</Btn>
                                <Btn variant="danger" small onClick={() => askConfirm(`Supprimer « ${e.name} » ?`, async () => { await saveExams(exams.filter(x => x.id !== e.id)); })}>Suppr.</Btn>
                              </div></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {modal === "addExam" && (
                  <Modal2 title={form.editExamId ? "Modifier l'examen" : "Nouvel examen"} onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.examName) return;
                      const examSubj = form.examSubject === "Autre" && form.examSubjectCustom ? form.examSubjectCustom : (form.examSubject || SUBJECTS[0]);
                      const entry = { id: form.editExamId || genId(), name: form.examName, classId: form.examClass || "", subject: examSubj, date: form.examDate || "", duration: Number(form.examDuration) || 120, room: form.examRoom || "" };
                      if (form.editExamId) await saveExams(exams.map(e => e.id === form.editExamId ? entry : e));
                      else await saveExams([...exams, entry]);
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <Field label="Nom de l'examen" value={form.examName || ""} onChange={v => setForm({ ...form, examName: v })} placeholder="Ex: Composition 1er trimestre" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Classe</div>
                        <select style={S.input} value={form.examClass || ""} onChange={e => setForm({ ...form, examClass: e.target.value })}>
                          <option value="">— Toutes —</option>
                          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Matière</div>
                        <select style={S.input} value={form.examSubject || SUBJECTS[0]} onChange={e => setForm({ ...form, examSubject: e.target.value, examSubjectCustom: "" })}>
                          {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {form.examSubject === "Autre" && (
                          <input style={{ ...S.input, marginTop: 6 }} placeholder="Précisez la matière…" value={form.examSubjectCustom || ""} onChange={e => setForm({ ...form, examSubjectCustom: e.target.value })} />
                        )}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="Date" value={form.examDate || ""} onChange={v => setForm({ ...form, examDate: v })} type="date" />
                      <Field label="Durée (minutes)" value={form.examDuration || "120"} onChange={v => setForm({ ...form, examDuration: v })} placeholder="120" />
                    </div>
                    <Field label="Salle" value={form.examRoom || ""} onChange={v => setForm({ ...form, examRoom: v })} placeholder="Ex: Amphi A" />
                  </Modal2>
                )}
              </div>
            )}

            {/* Discipline */}
            {page === "disc" && (role === "admin" || role === "directeur" || role === "secretaire") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2>Discipline</h2>
                  <Btn onClick={() => { setForm({ discStudent: "", discType: INCIDENT_TYPES[0], discDate: new Date().toISOString().slice(0, 10), discDesc: "", discSanction: SANCTIONS[0] }); setModal("addDisc"); }}>+ Nouvel incident</Btn>
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr><th style={S.th}>Élève</th><th style={S.th}>Type</th><th style={S.th}>Date</th><th style={S.th}>Description</th><th style={S.th}>Sanction</th><th style={S.th}>Actions</th></tr></thead>
                      <tbody>
                        {incidents.length === 0 && <tr><td colSpan={6}><EmptyState icon="⊘" title="Aucun incident enregistré" /></td></tr>}
                        {[...incidents].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(inc => {
                          const stu = students.find(s => s.id === inc.studentId);
                          return (
                            <tr key={inc.id}>
                              <td style={{ ...S.td, fontWeight: 500 }}>{stu?.name || "—"}</td>
                              <td style={S.td}><span style={S.badge("red")}>{inc.type}</span></td>
                              <td style={S.td}>{inc.date}</td>
                              <td style={{ ...S.td, fontSize: 12, color: "#9BA1B7", maxWidth: 200 }}>{inc.description || "—"}</td>
                              <td style={S.td}>{inc.sanction || "—"}</td>
                              <td style={S.td}><Btn variant="danger" small onClick={() => askConfirm("Supprimer cet incident ?", async () => { await saveIncidents(incidents.filter(x => x.id !== inc.id)); })}>Suppr.</Btn></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {modal === "addDisc" && (
                  <Modal2 title="Nouvel incident" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.discStudent) return;
                      const discType = form.discType === "Autre" && form.discTypeCustom ? form.discTypeCustom : (form.discType || INCIDENT_TYPES[0]);
                      await saveIncidents([...incidents, { id: genId(), studentId: form.discStudent, type: discType, date: form.discDate, description: form.discDesc || "", sanction: form.discSanction || "" }]);
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Élève</div>
                      <select style={S.input} value={form.discStudent || ""} onChange={e => setForm({ ...form, discStudent: e.target.value })}>
                        <option value="">— Choisir un élève —</option>
                        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Type d'incident</div>
                        <select style={S.input} value={form.discType || INCIDENT_TYPES[0]} onChange={e => setForm({ ...form, discType: e.target.value, discTypeCustom: "" })}>
                          {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        {form.discType === "Autre" && (
                          <input style={{ ...S.input, marginTop: 6 }} placeholder="Précisez le type d'incident…" value={form.discTypeCustom || ""} onChange={e => setForm({ ...form, discTypeCustom: e.target.value })} />
                        )}
                      </div>
                      <Field label="Date" value={form.discDate || ""} onChange={v => setForm({ ...form, discDate: v })} type="date" />
                    </div>
                    <Field label="Description" value={form.discDesc || ""} onChange={v => setForm({ ...form, discDesc: v })} placeholder="Décrivez l'incident..." />
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Sanction</div>
                      <select style={S.input} value={form.discSanction || SANCTIONS[0]} onChange={e => setForm({ ...form, discSanction: e.target.value })}>
                        {SANCTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </Modal2>
                )}
              </div>
            )}

            {/* Documents */}
            {page === "docs" && (role === "admin" || role === "secretaire") && (
              <div>
                <div style={{ marginBottom: 24 }}><h2>Documents & Certificats</h2></div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 20, marginBottom: 32 }}>
                  {[
                    { type: "scolarite", icon: "◈", label: "Certificat de scolarité", desc: "Atteste l'inscription de l'élève pour l'année en cours" },
                    { type: "conduite", icon: "◉", label: "Attestation de bonne conduite", desc: "Certifie le bon comportement de l'élève" },
                    { type: "inscription", icon: "◎", label: "Reçu d'inscription", desc: "Confirme l'inscription et le paiement des frais" },
                    { type: "nonredevance", icon: "⊖", label: "Non-Redevance", desc: "Atteste qu'aucune somme n'est due à l'ancien établissement" },
                    { type: "cantineRecu", icon: "⊙", label: "Reçu Cantine", desc: "Reçu de paiement de la cantine pour un élève" },
                    { type: "librairie", icon: "⊚", label: "Reçu Bibliothèque", desc: "Reçu de frais de bibliothèque / prêt de livre" },
                  ].map(doc => (
                    <div key={doc.type} style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 24 }}>
                      <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.6 }}>{doc.icon}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{doc.label}</div>
                      <div style={{ fontSize: 12, color: "#636985", marginBottom: 16 }}>{doc.desc}</div>
                      <Btn variant="ghost" onClick={() => { setForm({ docType: doc.type, docStudent: "", docLabel: doc.label, docMonth: new Date().toISOString().slice(0,7), docLoan: "" }); setModal("genDoc"); }}>Générer</Btn>
                    </div>
                  ))}
                  <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 24 }}>
                    <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.6 }}>⊗</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Palmarès de classe</div>
                    <div style={{ fontSize: 12, color: "#636985", marginBottom: 16 }}>Classement des élèves par moyenne, par classe et trimestre</div>
                    <Btn variant="ghost" onClick={() => { setForm({ palmClass: classes[0]?.id || "", palmTerm: TERMS[0] }); setModal("genPalm"); }}>Générer</Btn>
                  </div>
                </div>

                {/* Multi-receipt section — multiple doc types for ONE student */}
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 24, marginBottom: 24 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Multi-reçus</div>
                  <div style={{ fontSize: 12, color: "#636985", marginBottom: 16 }}>Choisissez un élève, cochez les reçus à imprimer ensemble</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
                    <div style={{ position: "relative" }}>
                      <div style={{ fontSize: 12, color: "#636985", marginBottom: 4 }}>Élève</div>
                      <input
                        value={form.mrStuQ !== undefined ? form.mrStuQ : (students.find(s => s.id === form.mrStuId)?.name || "")}
                        onChange={e => setForm({ ...form, mrStuQ: e.target.value, mrStuId: "" })}
                        placeholder="Rechercher un élève..."
                        style={{ background: "#1C1F2E", color: "#E8EAF0", border: "1px solid #2A2E42", borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 220 }}
                      />
                      {form.mrStuQ && !form.mrStuId && (() => {
                        const q = form.mrStuQ.toLowerCase();
                        const matches = students.filter(s => s.name.toLowerCase().includes(q) || (s.grade||"").toLowerCase().includes(q)).slice(0, 8);
                        if (!matches.length) return null;
                        return (
                          <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 99, background: "#1C1F2E", border: "1px solid #2A2E42", borderRadius: 6, width: 260, maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px #0006" }}>
                            {matches.map(s => (
                              <div key={s.id} onClick={() => setForm({ ...form, mrStuId: s.id, mrStuQ: undefined })}
                                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#E8EAF0", borderBottom: "1px solid #2A2E42" }}
                                onMouseEnter={e => e.currentTarget.style.background = "#2A2E42"}
                                onMouseLeave={e => e.currentTarget.style.background = ""}
                              >{s.name} <span style={{ color: "#636985" }}>— {s.grade}</span></div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "#636985", marginBottom: 4 }}>Mois (Cantine)</div>
                      <input value={form.mrMonth || ""} onChange={e => setForm({ ...form, mrMonth: e.target.value })} placeholder="ex: Avril 2025" style={{ background: "#1C1F2E", color: "#E8EAF0", border: "1px solid #2A2E42", borderRadius: 6, padding: "6px 10px", fontSize: 13, width: 140 }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
                    {[["mrInscription","Reçu d'inscription"],["mrNonRed","Non-Redevance"],["mrCantine","Reçu Cantine"],["mrBiblio","Reçu Bibliothèque"]].map(([key, label]) => (
                      <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" checked={!!form[key]} onChange={e => setForm({ ...form, [key]: e.target.checked })} />
                        <span style={{ color: "#E8EAF0" }}>{label}</span>
                      </label>
                    ))}
                  </div>
                  <Btn onClick={() => {
                    const stu = students.find(s => s.id === form.mrStuId);
                    if (!stu) return;
                    const date = new Date().toLocaleDateString("fr-FR");
                    const year = `${new Date().getFullYear()-1}/${new Date().getFullYear()}`;
                    const paid = studentPayments.filter(p => p.studentId === stu.id).reduce((a,p) => a + Number(p.amount||0), 0);
                    const due = Number(classTuition[stu.grade] || 0);
                    const pages = [];
                    const hdr = `<h2 style="text-align:center;margin-bottom:4px">${school?.name||""}</h2>`;
                    if (form.mrInscription) pages.push(`${hdr}<h3 style="text-align:center">Reçu d'inscription — ${year}</h3><p><strong>Élève :</strong> ${stu.name}<br><strong>Classe :</strong> ${stu.grade}<br><strong>Parent :</strong> ${stu.parent||"—"}<br><strong>Montant dû :</strong> ${fmtCFA(due)}<br><strong>Montant payé :</strong> ${fmtCFA(paid)}<br><strong>Reste :</strong> ${fmtCFA(Math.max(0,due-paid))}<br><strong>Date :</strong> ${date}</p><br><p>Signature et cachet</p>`);
                    if (form.mrNonRed) pages.push(`${hdr}<h3 style="text-align:center">Certificat de Non-Redevance</h3><p>Nous soussignés, Direction de <strong>${school?.name||""}</strong>, certifions que l'élève <strong>${stu.name}</strong>, inscrit(e) en <strong>${stu.grade}</strong>, ne doit aucune somme à notre établissement et n'a aucune dette en cours à la date du <strong>${date}</strong>.<br><br>Ce document lui est délivré pour servir et valoir ce que de droit.</p><br><br><p>Fait le ${date}<br><br>Signature et cachet</p>`);
                    if (form.mrCantine) pages.push(`${hdr}<h3 style="text-align:center">Reçu Cantine — ${form.mrMonth||"—"}</h3><p><strong>Élève :</strong> ${stu.name}<br><strong>Classe :</strong> ${stu.grade}<br><strong>Mois :</strong> ${form.mrMonth||"—"}<br><strong>Date :</strong> ${date}</p><br><p>Reçu pour paiement de la cantine scolaire.<br><br>Signature et cachet</p>`);
                    if (form.mrBiblio) pages.push(`${hdr}<h3 style="text-align:center">Reçu Bibliothèque</h3><p><strong>Élève :</strong> ${stu.name}<br><strong>Classe :</strong> ${stu.grade}<br><strong>Date :</strong> ${date}</p><br><p>Reçu pour frais de bibliothèque.<br><br>Signature et cachet</p>`);
                    if (pages.length === 0) return;
                    const html = pages.map((p, i) => `<div style="page-break-after:${i < pages.length-1 ? "always" : "avoid"};font-family:serif;margin:60px;font-size:15px;line-height:1.8">${p}</div>`).join("");
                    const win = window.open("","_blank");
                    if (win) { win.document.write(`<html><head><title>Multi-reçus — ${stu.name}</title></head><body>${html}</body></html>`); win.document.close(); win.print(); }
                  }}>⊕ Imprimer les reçus sélectionnés</Btn>
                </div>

                {/* genDoc modal */}
                {modal === "genDoc" && (
                  <Modal2 title={`Générer — ${form.docLabel}`} onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn onClick={() => {
                      const stu = students.find(s => s.id === form.docStudent);
                      if (!stu) return;
                      const year = `${new Date().getFullYear() - 1}/${new Date().getFullYear()}`;
                      const date = new Date().toLocaleDateString("fr-FR");
                      let body = "";
                      if (form.docType === "scolarite") body = `Je soussigné(e), Directeur(trice) de ${school?.name}, certifie que l'élève ${stu.name} est régulièrement inscrit(e) dans notre établissement pour l'année scolaire ${year}, en classe de ${stu.grade || "—"}.\n\nFait à ${school?.city || "—"}, le ${date}.\n\nSignature et cachet de l'établissement`;
                      else if (form.docType === "conduite") body = `Je soussigné(e), Directeur(trice) de ${school?.name}, certifie que l'élève ${stu.name} a fait preuve d'une bonne conduite tout au long de son séjour dans notre établissement.\n\nFait à ${school?.city || "—"}, le ${date}.`;
                      else if (form.docType === "inscription") body = `Reçu d'inscription pour l'élève ${stu.name}, classe de ${stu.grade || "—"}, pour l'année scolaire ${year}.\n\nÉtablissement : ${school?.name}\nDate : ${date}`;
                      else if (form.docType === "nonredevance") body = `Je soussigné(e), Directeur(trice) de ${school?.name}, certifie que l'élève ${stu.name}, anciennement inscrit(e) à ${stu.prevSchool || "l'ancien établissement"}, n'est redevable d'aucune somme envers notre établissement et qu'il/elle peut être librement admis(e) dans un autre établissement.\n\nFait à ${school?.city || "—"}, le ${date}.\n\nSignature et cachet de l'établissement`;
                      else if (form.docType === "cantineRecu") {
                        const cantRec = cantine.filter(c => c.studentId === stu.id && c.month === (form.docMonth || "")).reduce((a,c) => ({ days: a.days + c.days, paid: a.paid + c.amountPaid }), { days: 0, paid: 0 });
                        body = `REÇU DE CANTINE\n\nÉlève : ${stu.name}\nClasse : ${stu.grade || "—"}\nMois : ${form.docMonth || "—"}\nNombre de jours : ${cantRec.days}\nMontant payé : ${fmtCFA(cantRec.paid)}\n\nÉtablissement : ${school?.name}\nDate d'émission : ${date}\n\nSignature`;
                      }
                      else if (form.docType === "librairie") {
                        const loan = loans.find(l => l.id === form.docLoan);
                        const bk = books.find(b => b.id === loan?.bookId);
                        body = `REÇU BIBLIOTHÈQUE\n\nÉlève : ${stu.name}\nLivre : ${bk?.title || "—"}\nAuteur : ${bk?.author || "—"}\nDate de prêt : ${loan?.date || "—"}\nRetour prévu : ${loan?.due || "—"}\n\nÉtablissement : ${school?.name}\nDate d'émission : ${date}\n\nSignature`;
                      }
                      const win = window.open("", "_blank");
                      if (win) { win.document.write(`<html><head><title>${form.docLabel}</title><style>body{font-family:serif;margin:60px;font-size:16px;line-height:1.8}h2{text-align:center;margin-bottom:40px}h3{text-align:center}</style></head><body><h2>${school?.name}</h2><h3>${form.docLabel}</h3><p style="white-space:pre-line">${body}</p></body></html>`); win.document.close(); win.print(); }
                    }}>Imprimer</Btn></div>}>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Élève</div>
                      <select style={S.input} value={form.docStudent || ""} onChange={e => setForm({ ...form, docStudent: e.target.value })}>
                        <option value="">— Choisir un élève —</option>
                        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    {form.docType === "cantineRecu" && (
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Mois</div>
                        <input style={S.input} type="month" value={form.docMonth || ""} onChange={e => setForm({ ...form, docMonth: e.target.value })} />
                      </div>
                    )}
                    {form.docType === "librairie" && form.docStudent && (
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Prêt de livre</div>
                        <select style={S.input} value={form.docLoan || ""} onChange={e => setForm({ ...form, docLoan: e.target.value })}>
                          <option value="">— Choisir un prêt —</option>
                          {loans.filter(l => l.studentId === form.docStudent).map(l => {
                            const bk = books.find(b => b.id === l.bookId);
                            return <option key={l.id} value={l.id}>{bk?.title || "Livre"} — {l.date}</option>;
                          })}
                        </select>
                      </div>
                    )}
                  </Modal2>
                )}

                {/* Palmarès modal */}
                {modal === "genPalm" && (
                  <Modal2 title="Palmarès de classe" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn onClick={() => {
                      const cls = classes.find(c => c.id === form.palmClass);
                      if (!cls) return;
                      const term = form.palmTerm || TERMS[0];
                      const classStudents = students.filter(s => s.classId === cls.id);
                      const ranked = classStudents.map(s => {
                        const sg = grades.filter(g => g.studentId === s.id && g.term === term);
                        const avg = sg.length > 0 ? (sg.reduce((a, g) => a + (g.score / (g.maxScore || 20)) * 20, 0) / sg.length).toFixed(2) : "—";
                        return { ...s, avg: sg.length > 0 ? Number(avg) : -1, avgStr: avg };
                      }).sort((a, b) => b.avg - a.avg);
                      const rows = ranked.map((s, i) => `<tr><td style="padding:8px 16px;border-bottom:1px solid #eee;text-align:center">${s.avg >= 0 ? i + 1 : "—"}</td><td style="padding:8px 16px;border-bottom:1px solid #eee">${s.name}</td><td style="padding:8px 16px;border-bottom:1px solid #eee;text-align:center;font-weight:600">${s.avgStr}</td></tr>`).join("");
                      const date = new Date().toLocaleDateString("fr-FR");
                      const win = window.open("","_blank");
                      if (win) { win.document.write(`<html><head><title>Palmarès</title><style>body{font-family:serif;margin:40px}table{width:100%;border-collapse:collapse}th{background:#f0f0f0;padding:10px 16px;text-align:left}</style></head><body><h2 style="text-align:center">${school?.name}</h2><h3 style="text-align:center">Palmarès — ${cls.name} — ${term}</h3><p style="text-align:right;font-size:13px">Édité le ${date}</p><table><thead><tr><th style="text-align:center">Rang</th><th>Élève</th><th style="text-align:center">Moyenne /20</th></tr></thead><tbody>${rows}</tbody></table></body></html>`); win.document.close(); win.print(); }
                    }}>Imprimer</Btn></div>}>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Classe</div>
                      <select style={S.input} value={form.palmClass || ""} onChange={e => setForm({ ...form, palmClass: e.target.value })}>
                        <option value="">— Choisir —</option>
                        {classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` (${c.section})` : ""}</option>)}
                      </select>
                    </div>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Trimestre</div>
                      <select style={S.input} value={form.palmTerm || TERMS[0]} onChange={e => setForm({ ...form, palmTerm: e.target.value })}>
                        {TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </Modal2>
                )}
              </div>
            )}

            {/* Cantine */}
            {page === "cant" && (role === "admin" || role === "secretaire" || role === "comptable") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2>Cantine</h2>
                  <Btn onClick={() => { setForm({ cantStudent: "", cantMonth: new Date().toISOString().slice(0, 7), cantDays: "", cantAmount: "", cantNote: "" }); setModal("addCant"); }}>+ Inscription cantine</Btn>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                  {(() => {
                    const m = new Date().toISOString().slice(0, 7);
                    const monthRec = cantine.filter(c => c.month === m);
                    return [
                      { label: "Inscrits ce mois", value: monthRec.length, color: "#A29BFE" },
                      { label: "Jours total", value: monthRec.reduce((a, c) => a + (c.days || 0), 0), color: "#00B894" },
                      { label: "Recettes cantine", value: fmtCFA(monthRec.reduce((a, c) => a + (c.amountPaid || 0), 0)), color: "#FDCB6E" },
                    ].map(s => <div key={s.label} style={S.stat}><div style={S.label}>{s.label}</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, color: s.color }}>{s.value}</div></div>);
                  })()}
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={S.table}>
                      <thead><tr><th style={S.th}>Élève</th><th style={S.th}>Mois</th><th style={S.th}>Jours</th><th style={S.th}>Montant payé</th><th style={S.th}>Note</th><th style={S.th}>Actions</th></tr></thead>
                      <tbody>
                        {cantine.length === 0 && <tr><td colSpan={6}><EmptyState icon="⊙" title="Aucune inscription cantine" /></td></tr>}
                        {[...cantine].sort((a, b) => (b.month || "").localeCompare(a.month || "")).map(c => {
                          const stu = students.find(s => s.id === c.studentId);
                          return (
                            <tr key={c.id}>
                              <td style={{ ...S.td, fontWeight: 500 }}>{stu?.name || "—"}</td>
                              <td style={S.td}>{c.month}</td>
                              <td style={S.td}>{c.days}</td>
                              <td style={{ ...S.td, color: "#00B894", fontWeight: 600 }}>{fmtCFA(c.amountPaid || 0)}</td>
                              <td style={{ ...S.td, fontSize: 12, color: "#636985" }}>{c.note || "—"}</td>
                              <td style={S.td}><Btn variant="danger" small onClick={() => askConfirm("Supprimer cette inscription ?", async () => { await saveCantine(cantine.filter(x => x.id !== c.id)); })}>Suppr.</Btn></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {modal === "addCant" && (
                  <Modal2 title="Inscription cantine" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.cantStudent || !form.cantMonth) return;
                      await saveCantine([...cantine, { id: genId(), studentId: form.cantStudent, month: form.cantMonth, days: Number(form.cantDays) || 0, amountPaid: Number(form.cantAmount) || 0, note: form.cantNote || "" }]);
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Élève</div>
                      <select style={S.input} value={form.cantStudent || ""} onChange={e => setForm({ ...form, cantStudent: e.target.value })}>
                        <option value="">— Choisir un élève —</option>
                        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div style={{ marginBottom: 16 }}><div style={S.label}>Mois</div><input style={S.input} type="month" value={form.cantMonth || ""} onChange={e => setForm({ ...form, cantMonth: e.target.value })} /></div>
                      <Field label="Nombre de jours" value={String(form.cantDays || "")} onChange={v => setForm({ ...form, cantDays: v })} placeholder="20" />
                    </div>
                    <Field label="Montant payé (FCFA)" value={String(form.cantAmount || "")} onChange={v => setForm({ ...form, cantAmount: v })} placeholder="15000" />
                    <Field label="Note" value={form.cantNote || ""} onChange={v => setForm({ ...form, cantNote: v })} placeholder="Optionnel..." />
                  </Modal2>
                )}
              </div>
            )}

            {/* Bibliothèque */}
            {page === "lib" && (role === "admin" || role === "secretaire") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2>Bibliothèque</h2>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="ghost" onClick={() => { setForm({ loanBook: "", loanStudent: "", loanDue: "" }); setModal("addLoan"); }}>+ Prêt</Btn>
                    <Btn onClick={() => { setForm({ bookTitle: "", bookAuthor: "", bookIsbn: "", bookQty: "1" }); setModal("addBook"); }}>+ Livre</Btn>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  <div>
                    <h3 style={{ marginBottom: 12 }}>Catalogue</h3>
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <table style={S.table}>
                        <thead><tr><th style={S.th}>Titre</th><th style={S.th}>Auteur</th><th style={S.th}>Dispo</th><th style={S.th}>Actions</th></tr></thead>
                        <tbody>
                          {books.length === 0 && <tr><td colSpan={4}><EmptyState icon="⊚" title="Aucun livre" /></td></tr>}
                          {books.map(b => {
                            const borrowed = loans.filter(l => l.bookId === b.id && !l.returnDate).length;
                            const avail = (b.quantity || 1) - borrowed;
                            return (
                              <tr key={b.id}>
                                <td style={{ ...S.td, fontWeight: 500 }}>{b.title}</td>
                                <td style={{ ...S.td, fontSize: 12 }}>{b.author || "—"}</td>
                                <td style={S.td}><span style={S.badge(avail > 0 ? "green" : "red")}>{avail}/{b.quantity || 1}</span></td>
                                <td style={S.td}><Btn variant="danger" small onClick={() => askConfirm(`Supprimer « ${b.title} » ?`, async () => { await saveBooks(books.filter(x => x.id !== b.id)); })}>Suppr.</Btn></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <h3 style={{ marginBottom: 12 }}>Prêts en cours</h3>
                    <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                      <table style={S.table}>
                        <thead><tr><th style={S.th}>Élève</th><th style={S.th}>Livre</th><th style={S.th}>Échéance</th><th style={S.th}>Actions</th></tr></thead>
                        <tbody>
                          {loans.filter(l => !l.returnDate).length === 0 && <tr><td colSpan={4}><EmptyState icon="⊚" title="Aucun prêt en cours" /></td></tr>}
                          {loans.filter(l => !l.returnDate).map(l => {
                            const stu = students.find(s => s.id === l.studentId);
                            const book = books.find(b => b.id === l.bookId);
                            const overdue = l.dueDate && l.dueDate < new Date().toISOString().slice(0, 10);
                            return (
                              <tr key={l.id}>
                                <td style={{ ...S.td, fontSize: 12 }}>{stu?.name || "—"}</td>
                                <td style={{ ...S.td, fontSize: 12 }}>{book?.title || "—"}</td>
                                <td style={S.td}><span style={S.badge(overdue ? "red" : "green")}>{l.dueDate || "—"}</span></td>
                                <td style={S.td}><Btn variant="ghost" small onClick={async () => { await saveLoans(loans.map(x => x.id === l.id ? { ...x, returnDate: new Date().toISOString().slice(0, 10) } : x)); }}>Retour</Btn></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                {modal === "addBook" && (
                  <Modal2 title="Ajouter un livre" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.bookTitle) return;
                      await saveBooks([...books, { id: genId(), title: form.bookTitle, author: form.bookAuthor || "", isbn: form.bookIsbn || "", quantity: Number(form.bookQty) || 1 }]);
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <Field label="Titre" value={form.bookTitle || ""} onChange={v => setForm({ ...form, bookTitle: v })} placeholder="Titre du livre" />
                    <Field label="Auteur" value={form.bookAuthor || ""} onChange={v => setForm({ ...form, bookAuthor: v })} placeholder="Auteur" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <Field label="ISBN" value={form.bookIsbn || ""} onChange={v => setForm({ ...form, bookIsbn: v })} placeholder="978..." />
                      <Field label="Quantité" value={form.bookQty || "1"} onChange={v => setForm({ ...form, bookQty: v })} placeholder="1" />
                    </div>
                  </Modal2>
                )}
                {modal === "addLoan" && (
                  <Modal2 title="Nouveau prêt" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.loanBook || !form.loanStudent) return;
                      await saveLoans([...loans, { id: genId(), bookId: form.loanBook, studentId: form.loanStudent, loanDate: new Date().toISOString().slice(0, 10), dueDate: form.loanDue || "", returnDate: null }]);
                      setModal(null);
                    }}>Enregistrer</Btn></div>}>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Livre</div>
                      <select style={S.input} value={form.loanBook || ""} onChange={e => setForm({ ...form, loanBook: e.target.value })}>
                        <option value="">— Choisir un livre —</option>
                        {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                      </select>
                    </div>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Élève</div>
                      <select style={S.input} value={form.loanStudent || ""} onChange={e => setForm({ ...form, loanStudent: e.target.value })}>
                        <option value="">— Choisir un élève —</option>
                        {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <Field label="Date de retour prévue" value={form.loanDue || ""} onChange={v => setForm({ ...form, loanDue: v })} type="date" />
                  </Modal2>
                )}
              </div>
            )}

            {/* Annonces */}
            {page === "msg" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                  <h2>Annonces</h2>
                  <Btn onClick={() => { setForm({ msgSubject: "", msgBody: "", msgTo: "all" }); setModal("composeMsg"); }}>+ Nouveau message</Btn>
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, overflow: "hidden" }}>
                  {messages.length === 0 && <EmptyState icon="⊛" title="Aucun message" subtitle="Composez votre premier message" />}
                  {[...messages].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(m => (
                    <div key={m.id} style={{ padding: "16px 20px", borderBottom: "1px solid #1C1F2E", cursor: "pointer", background: m.read ? "transparent" : "rgba(108,92,231,0.05)" }}
                      onClick={async () => { setForm({ viewMsg: m }); if (!m.read) await saveMessages(messages.map(x => x.id === m.id ? { ...x, read: true } : x)); }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: m.read ? 400 : 700, fontSize: 14 }}>{m.subject}</div>
                          <div style={{ fontSize: 12, color: "#636985", marginTop: 2 }}>De: {m.from} · À: {m.to === "all" ? "Tout le personnel" : m.to}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#636985" }}>{m.date}</div>
                      </div>
                      <div style={{ fontSize: 12, color: "#9BA1B7", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.body}</div>
                    </div>
                  ))}
                </div>
                {modal === "composeMsg" && (
                  <Modal2 title="Nouveau message" onClose={() => setModal(null)}
                    footer={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn><Btn loading={saving} onClick={async () => {
                      if (!form.msgSubject || !form.msgBody) return;
                      await saveMessages([...messages, { id: genId(), subject: form.msgSubject, body: form.msgBody, to: form.msgTo || "all", from: user?.name || role, date: new Date().toISOString().slice(0, 10), read: false }]);
                      setModal(null);
                    }}>Envoyer</Btn></div>}>
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Destinataire</div>
                      <select style={S.input} value={form.msgTo || "all"} onChange={e => setForm({ ...form, msgTo: e.target.value })}>
                        <option value="all">Tout le personnel</option>
                        {staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                    <Field label="Objet" value={form.msgSubject || ""} onChange={v => setForm({ ...form, msgSubject: v })} placeholder="Objet du message" />
                    <div style={{ marginBottom: 16 }}><div style={S.label}>Message</div>
                      <textarea style={{ ...S.input, minHeight: 120, resize: "vertical" }} value={form.msgBody || ""} onChange={e => setForm({ ...form, msgBody: e.target.value })} placeholder="Votre message..." />
                    </div>
                  </Modal2>
                )}
                {form.viewMsg && (
                  <Modal2 title={form.viewMsg.subject} onClose={() => setForm({ ...form, viewMsg: null })}
                    footer={<Btn variant="ghost" onClick={() => setForm({ ...form, viewMsg: null })}>Fermer</Btn>}>
                    <div style={{ fontSize: 12, color: "#636985", marginBottom: 16 }}>De: {form.viewMsg.from} · À: {form.viewMsg.to === "all" ? "Tout le personnel" : form.viewMsg.to} · {form.viewMsg.date}</div>
                    <p style={{ lineHeight: 1.8, color: "#9BA1B7", whiteSpace: "pre-wrap" }}>{form.viewMsg.body}</p>
                  </Modal2>
                )}
              </div>
            )}

            {/* Subscription */}
            {page === "sub" && role === "admin" && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 16, marginBottom: 28 }}>
                  <div style={S.stat}><div style={S.label}>Forfait</div><div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{PLANS[school?.plan]?.name || "—"}</div></div>
                  <div style={S.stat}><div style={S.label}>Jours restants</div><div style={{ fontSize: 28, fontWeight: 700, marginTop: 8, color: dl <= 0 ? "#FF6B6B" : dl <= 7 ? "#FDCB6E" : "#00B894" }}>{Math.max(0, dl)}</div>
                    <div style={{ marginTop: 8, height: 6, background: "#1C1F2E", borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${Math.min(100, Math.max(0, (dl / 30) * 100))}%`, height: "100%", background: dl <= 7 ? "#FDCB6E" : "#00B894", borderRadius: 3, transition: "width 0.3s ease" }} /></div>
                  </div>
                  <div style={S.stat}><div style={S.label}>Échéance</div><div style={{ fontSize: 16, fontWeight: 600, marginTop: 8, color: dl <= 0 ? "#FF6B6B" : "#E8EAF0" }}>{school?.subEnd || "—"}</div></div>
                </div>
                <div style={{ background: "#161822", border: "1px solid #2A2E42", borderRadius: 10, padding: 24 }}>
                  <h3 style={{ marginBottom: 16 }}>Forfaits Disponibles</h3>
                  <div className="eos-plan-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
                    {Object.entries(PLANS).map(([k, v]) => (
                      <div key={k} style={{ background: school?.plan === k ? "rgba(108,92,231,0.12)" : "#1C1F2E", border: `1px solid ${school?.plan === k ? "#6C5CE7" : "#2A2E42"}`, borderRadius: 10, padding: 20, textAlign: "center" }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{v.name}</div>
                        {v.priceMonth > 0 ? (
                          <>
                            <div style={{ marginTop: 10, fontSize: 20, fontWeight: 700, color: "#A29BFE" }}>{fmtCFA(v.priceMonth)}<span style={{ fontSize: 11, fontWeight: 400, color: "#636985" }}>/mois</span></div>
                            <div style={{ fontSize: 11, color: "#636985", marginTop: 2 }}>{fmtCFA(v.priceYear)}/an</div>
                          </>
                        ) : (
                          <div style={{ marginTop: 10, fontSize: 16, fontWeight: 700, color: "#00B894" }}>Gratuit</div>
                        )}
                        <div style={{ marginTop: 8, fontSize: 11, color: "#9BA1B7" }}>{v.maxStudents ? `≤ ${v.maxStudents} élèves` : "Élèves illimités"}</div>
                        <div style={{ marginTop: 8, borderTop: "1px solid #2A2E42", paddingTop: 8 }}>
                          {v.features.map(f => <div key={f} style={{ fontSize: 11, color: "#636985", marginTop: 4 }}>• {f}</div>)}
                        </div>
                        {school?.plan === k && <div style={{ marginTop: 10, fontSize: 11, color: "#A29BFE", fontWeight: 600 }}>ACTUEL</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      {/* Connection settings modal */}
      {modal === "connection" && (
        <Modal2
          title="Paramètres de Connexion"
          onClose={() => setModal(null)}
          footer={
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
              <Btn onClick={() => saveConnection({ mode: form.mode, serverUrl: form.mode !== "offline" ? form.serverUrl : null, token: connConfig.token, refreshToken: connConfig.refreshToken })}>Enregistrer</Btn>
            </div>
          }
        >
          <div style={{ marginBottom: 16 }}>
            <div style={S.label}>Mode de connexion</div>
            <select style={S.input} value={form.mode || "offline"} onChange={e => setForm(f => ({ ...f, mode: e.target.value, testResult: null }))}>
              <option value="offline">Hors ligne (localStorage uniquement)</option>
              <option value="local">Serveur local (LAN)</option>
              <option value="cloud">Serveur cloud</option>
            </select>
          </div>
          {form.mode !== "offline" && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={S.label}>URL du serveur</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={{ ...S.input, flex: 1 }}
                    value={form.serverUrl || ""}
                    onChange={e => setForm(f => ({ ...f, serverUrl: e.target.value, testResult: null }))}
                    placeholder={form.mode === "local" ? "http://192.168.1.100:4000" : "https://ecoleos.example.com"}
                  />
                  <Btn variant="ghost" small onClick={testServerConnection}>Tester</Btn>
                </div>
              </div>
              {form.testResult && (
                <div style={{ marginBottom: 16, padding: 10, borderRadius: 6, fontSize: 13, background: form.testResult === "ok" ? "rgba(0,184,148,0.12)" : form.testResult === "fail" ? "rgba(255,107,107,0.12)" : "rgba(108,92,231,0.12)", color: form.testResult === "ok" ? "#00B894" : form.testResult === "fail" ? "#FF6B6B" : "#A29BFE" }}>
                  {form.testResult === "ok" ? "Connexion réussie" : form.testResult === "fail" ? "Impossible de joindre le serveur" : "Test en cours..."}
                </div>
              )}
              <div style={{ fontSize: 12, color: "#636985", lineHeight: 1.6 }}>
                {form.mode === "local"
                  ? "Entrez l'adresse IP et le port du serveur sur votre réseau local. Ex : http://192.168.1.100:4000"
                  : "Entrez l'URL complète de votre serveur cloud. Ex : https://ecoleos.example.com"}
              </div>
            </>
          )}
          {form.mode === "offline" && (
            <div style={{ fontSize: 12, color: "#636985", lineHeight: 1.6, padding: 12, background: "#1C1F2E", borderRadius: 6 }}>
              En mode hors ligne, toutes les données sont stockées localement sur cet appareil. Utilisez l'export/import pour partager les données entre appareils.
            </div>
          )}
        </Modal2>
      )}

      {/* Import data modal */}
      {modal === "importData" && (
        <Modal2
          title="Importer des Données"
          onClose={() => setModal(null)}
          footer={
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
              {form.importSummary && !form.importError && (
                <Btn onClick={doImport} loading={saving}>Importer</Btn>
              )}
            </div>
          }
        >
          {form.importError && <div style={S.err}>{form.importError}</div>}
          {form.importSummary && (
            <div>
              <div style={{ marginBottom: 16, padding: 16, background: "#1C1F2E", borderRadius: 8, border: "1px solid #2A2E42" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E8EAF0", marginBottom: 8 }}>Aperçu du fichier</div>
                <div style={{ fontSize: 12, color: "#9BA1B7", lineHeight: 1.8 }}>
                  <div>Établissement : <strong style={{ color: "#E8EAF0" }}>{form.importSummary.school}</strong></div>
                  <div>Élèves : <strong style={{ color: "#E8EAF0" }}>{form.importSummary.students}</strong></div>
                  <div>Personnel : <strong style={{ color: "#E8EAF0" }}>{form.importSummary.staff}</strong></div>
                  <div>Transactions : <strong style={{ color: "#E8EAF0" }}>{form.importSummary.finances}</strong></div>
                  <div>Budgets : <strong style={{ color: "#E8EAF0" }}>{form.importSummary.budgets}</strong></div>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={S.label}>Mode d'importation</div>
                <select style={S.input} value={form.importMode || "replace"} onChange={e => setForm(f => ({ ...f, importMode: e.target.value }))}>
                  <option value="replace">Remplacer — Écraser les données existantes</option>
                  <option value="merge">Fusionner — Ajouter/mettre à jour sans supprimer</option>
                </select>
              </div>
              {form.importMode === "replace" && (
                <div style={{ padding: 10, background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.2)", borderRadius: 6, fontSize: 12, color: "#FF6B6B" }}>
                  Les données actuelles seront remplacées par celles du fichier.
                </div>
              )}
            </div>
          )}
        </Modal2>
      )}

      {confirm && <ConfirmModal message={confirm.message} onConfirm={runConfirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
