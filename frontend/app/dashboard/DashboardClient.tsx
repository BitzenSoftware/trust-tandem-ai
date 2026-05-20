"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, LangSelector } from "@/lib/i18n/context";

const API = process.env.NEXT_PUBLIC_API_URL + "/api/v1";

type CleanRecord = { name: string; email: string; cpf: string };
type QueueItem   = { name: string; email_hint: string; cpf_hint: string };

async function apiFetch(url: string, options: RequestInit = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch (e) { clearTimeout(t); throw e; }
}

async function getFreshHeaders() {
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export default function DashboardClient({ token, userName }: { token: string; userName: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [tab,       setTab]       = useState<"dashboard" | "queue">("dashboard");
  const [db,        setDb]        = useState<CleanRecord[]>([]);
  const [queue,     setQueue]     = useState<QueueItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [diagnoses, setDiagnoses] = useState<Record<string,string>>({});
  const [theme,     setTheme]     = useState<"light"|"dark">("light");

  useEffect(() => {
    const saved = (localStorage.getItem("theme") || document.documentElement.getAttribute("data-theme") || "light") as "light"|"dark";
    setTheme(saved);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const fetchData = useCallback(async () => {
    setLoading(true); setError("");
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }
    // Warm up Render (free tier sleeps; this health ping waits up to 55s)
    const wc = new AbortController();
    const wt = setTimeout(() => wc.abort(), 55000);
    try { await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, { signal: wc.signal }); }
    catch { /* server still sleeping — will fail below with a clear error */ }
    finally { clearTimeout(wt); }
    // Now fetch data (server should be warm)
    try {
      const [dbRes, qRes] = await Promise.all([
        apiFetch(`${API}/database`,     { headers: h }),
        apiFetch(`${API}/review-queue`, { headers: h }),
      ]);
      if (dbRes.ok) setDb(await dbRes.json());
      else if (dbRes.status === 403) setError(t.dashboard.err403);
      else if (dbRes.status === 401) {
        try { const b = await dbRes.clone().json(); setError(`${t.dashboard.err401} (${b.detail})`); }
        catch { setError(t.dashboard.err401); }
      }
      else setError(`${t.dashboard.errApi} ${dbRes.status}.`);
      if (qRes.ok) setQueue(await qRes.json());
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError")
        setError(t.dashboard.errTimeout);
      else
        setError(t.dashboard.errConn);
    } finally { setLoading(false); }
  }, [router, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleLogout() {
    const sb = createClient();
    await sb.auth.signOut();
    router.push("/login"); router.refresh();
  }

  async function handleExpurge(name: string) {
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }
    try {
      await apiFetch(`${API}/review-queue/${encodeURIComponent(name)}`, { method: "DELETE", headers: h });
      fetchData();
    } catch { setError(t.dashboard.expurgeError); }
  }

  async function handleDiagnose(name: string) {
    if (diagnoses[name]) return;
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }
    try {
      const res = await apiFetch(`${API}/analyze/${encodeURIComponent(name)}`, { headers: h });
      if (res.ok) {
        const d = await res.json();
        setDiagnoses(p => ({ ...p, [name]: d.diagnostico }));
      }
    } catch { setDiagnoses(p => ({ ...p, [name]: t.dashboard.claudeError })); }
  }

  const conformidade = db.length + queue.length > 0
    ? ((db.length / (db.length + queue.length)) * 100).toFixed(1) : "100.0";

  const s = {
    page:        { minHeight: "100vh", backgroundColor: "var(--bg-base)", color: "var(--text-primary)" },
    header:      { backgroundColor: "var(--bg-surface)", borderBottom: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" },
    logo:        { fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" },
    logoSub:     { fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 1 },
    themeBtn:    { padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", backgroundColor: "var(--bg-surface-2)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", fontWeight: 500 },
    userName:    { fontSize: "0.8rem", color: "var(--text-secondary)", padding: "6px 12px", backgroundColor: "var(--bg-surface-2)", borderRadius: 8, border: "1px solid var(--border)" },
    logoutBtn:   { fontSize: "0.8rem", color: "var(--danger)", background: "none", border: "none", cursor: "pointer", fontWeight: 500 },
    nav:         { backgroundColor: "var(--bg-surface)", borderBottom: "1px solid var(--border)", padding: "0 24px", display: "flex", gap: 0 },
    tabActive:   { padding: "14px 20px", fontSize: "0.85rem", fontWeight: 600, color: "var(--accent)", background: "none", border: "none", borderBottom: "2px solid var(--accent)", cursor: "pointer" },
    tabInactive: { padding: "14px 20px", fontSize: "0.85rem", fontWeight: 500, color: "var(--text-muted)", background: "none", border: "none", borderBottom: "2px solid transparent", cursor: "pointer" },
    main:        { maxWidth: 1100, margin: "0 auto", padding: "32px 24px" },
    card:        { backgroundColor: "var(--bg-surface)", borderRadius: 14, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: "20px 24px" },
    metricLabel: { fontSize: "0.72rem", fontWeight: 500, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 },
    metricValue: { fontSize: "2rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em" },
    sectionTitle:{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 },
    tableHead:   { fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: "0.06em", padding: "10px 16px", backgroundColor: "var(--bg-surface-2)", borderBottom: "1px solid var(--border)" },
    tableCell:   { padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: "0.85rem" },
    errorBox:    { backgroundColor: "var(--danger-subtle)", border: "1px solid var(--danger)", borderRadius: 12, padding: "16px 20px", color: "var(--danger-text)" },
    successBox:  { backgroundColor: "var(--success-subtle)", border: "1px solid var(--success)", borderRadius: 12, padding: "20px 24px", textAlign: "center" as const, color: "var(--success-text)" },
    alertCard:   { backgroundColor: "var(--bg-surface)", border: "1px solid var(--warning)", borderRadius: 14, padding: "20px 24px", boxShadow: "var(--shadow-sm)" },
    alertBadge:  { fontSize: "0.65rem", fontWeight: 700, color: "var(--warning)", textTransform: "uppercase" as const, letterSpacing: "0.1em", backgroundColor: "var(--warning-subtle)", padding: "3px 8px", borderRadius: 6 },
    hintBox:     { backgroundColor: "var(--bg-surface-2)", borderRadius: 8, padding: "10px 14px", border: "1px solid var(--border)" },
    hintLabel:   { fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 4 },
    hintValue:   { fontFamily: "var(--font-geist-mono)", fontSize: "0.85rem", color: "var(--text-primary)" },
    diagnoseBox: { backgroundColor: "var(--accent-subtle)", border: "1px solid var(--accent)", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "var(--accent-text)" },
    diagnoseBtn: { fontSize: "0.78rem", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontWeight: 500, padding: 0 },
    expurgeBtn:  { fontSize: "0.75rem", color: "var(--danger)", background: "none", border: "none", cursor: "pointer", fontWeight: 500 },
    retryBtn:    { marginTop: 10, fontSize: "0.82rem", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontWeight: 500 },
    badge:       { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", backgroundColor: "var(--danger)", color: "#fff", borderRadius: 10, fontSize: "0.68rem", fontWeight: 700, marginLeft: 6 },
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={{ ...s.header, padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div>
            <div style={s.logo}>Trust & Tandem AI</div>
            <div style={s.logoSub}>{t.dashboard.subtitle}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LangSelector />
            <button onClick={toggleTheme} style={s.themeBtn}>
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
              {theme === "light" ? "Dark" : "Light"}
            </button>
            <span style={s.userName}>{userName}</span>
            <button onClick={handleLogout} style={s.logoutBtn}>{t.dashboard.logout}</button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div style={s.nav}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", width: "100%" }}>
          {(["dashboard","queue"] as const).map(tab_ => (
            <button key={tab_} onClick={() => setTab(tab_)}
              style={tab === tab_ ? s.tabActive : s.tabInactive}>
              {tab_ === "dashboard" ? t.dashboard.tabDashboard : (
                <span style={{ display: "flex", alignItems: "center" }}>
                  {t.dashboard.tabQueue}
                  {queue.length > 0 && <span style={s.badge}>{queue.length}</span>}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main style={s.main}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ width: 36, height: 36, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              {elapsed >= 8 ? t.dashboard.warmingUp : t.dashboard.loading}
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: 6 }}>{t.dashboard.coldStart}</p>
          </div>
        ) : error ? (
          <div style={s.errorBox}>
            <p style={{ fontWeight: 600, marginBottom: 4, fontSize: "0.9rem" }}>{t.dashboard.connError}</p>
            <p style={{ fontSize: "0.82rem", opacity: 0.85 }}>{error}</p>
            <button onClick={fetchData} style={s.retryBtn}>{t.dashboard.retry}</button>
          </div>
        ) : tab === "dashboard" ? (
          <>
            {/* Métricas */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
              {[
                { label: t.dashboard.metricTotal,      value: db.length + queue.length, accent: false },
                { label: t.dashboard.metricCompliance, value: `${conformidade}%`,        accent: true  },
                { label: t.dashboard.metricSecure,     value: db.length,                accent: false },
              ].map(({ label, value, accent }) => (
                <div key={label} style={{ ...s.card, borderTop: accent ? "3px solid var(--accent)" : "3px solid var(--border)" }}>
                  <div style={s.metricLabel}>{label}</div>
                  <div style={{ ...s.metricValue, color: accent ? "var(--accent)" : "var(--text-primary)" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Tabela */}
            <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                <p style={s.sectionTitle}>{t.dashboard.tableTitle}</p>
              </div>
              {db.length === 0 ? (
                <p style={{ padding: "32px 20px", color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center" }}>
                  {t.dashboard.tableEmpty} <code style={{ fontFamily: "var(--font-geist-mono)", backgroundColor: "var(--bg-surface-2)", padding: "2px 6px", borderRadius: 4 }}>/api/v1/ingest</code>
                </p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{[t.dashboard.colName, t.dashboard.colEmail, t.dashboard.colCpf].map(h => <th key={h} style={{ ...s.tableHead, textAlign: "left" }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {db.map((r, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "transparent" : "var(--bg-surface-2)" }}>
                        <td style={{ ...s.tableCell, fontWeight: 600, color: "var(--text-primary)" }}>{r.name}</td>
                        <td style={{ ...s.tableCell, fontFamily: "var(--font-geist-mono)", fontSize: "0.78rem", color: "var(--text-secondary)" }}>{r.email}</td>
                        <td style={{ ...s.tableCell, fontFamily: "var(--font-geist-mono)", fontSize: "0.78rem", color: "var(--text-secondary)" }}>{r.cpf}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {queue.length === 0 ? (
              <div style={s.successBox}>
                <p style={{ fontWeight: 600, fontSize: "0.95rem" }}>{t.dashboard.queueEmpty}</p>
                <p style={{ fontSize: "0.82rem", marginTop: 4, opacity: 0.8 }}>{t.dashboard.queueEmptySub}</p>
              </div>
            ) : queue.map((item, i) => (
              <div key={i} style={s.alertCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <span style={s.alertBadge}>{t.dashboard.alertLabel} #{i + 1}</span>
                    <p style={{ fontWeight: 700, color: "var(--text-primary)", marginTop: 6, fontSize: "0.95rem" }}>{item.name}</p>
                  </div>
                  <button onClick={() => handleExpurge(item.name)} style={s.expurgeBtn}>{t.dashboard.expurgeBtn}</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div style={s.hintBox}>
                    <div style={s.hintLabel}>{t.dashboard.emailHint}</div>
                    <div style={s.hintValue}>{item.email_hint}</div>
                  </div>
                  <div style={s.hintBox}>
                    <div style={s.hintLabel}>{t.dashboard.cpfHint}</div>
                    <div style={s.hintValue}>{item.cpf_hint}</div>
                  </div>
                </div>
                {diagnoses[item.name]
                  ? <div style={s.diagnoseBox}><strong>{t.dashboard.claude}</strong>{diagnoses[item.name]}</div>
                  : <button onClick={() => handleDiagnose(item.name)} style={s.diagnoseBtn}>{t.dashboard.diagnoseBtn}</button>
                }
              </div>
            ))}
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        button:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}
