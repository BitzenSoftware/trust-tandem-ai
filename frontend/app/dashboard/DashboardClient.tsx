"use client";

import { useState, useEffect, useCallback, useRef, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, LangSelector } from "@/lib/i18n/context";
import Papa from "papaparse";

const API = process.env.NEXT_PUBLIC_API_URL + "/api/v1";

type CleanRecord    = { name: string; email: string; cpf: string };
type QueueItem      = { name: string; email_hint: string; cpf_hint: string };
type DiagnosisResult = {
  campo_afetado: string;
  valor_original: string;
  valor_sugerido: string;
  diagnostico_motivo: string;
};

type BulkLogEntry = {
  name: string;
  status: "analyzing" | "success" | "skipped" | "error";
  detail?: string;
};

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
  const [tab,       setTab]       = useState<"dashboard" | "queue" | "ingest" | "settings">("dashboard");
  const [db,        setDb]        = useState<CleanRecord[]>([]);
  const [queue,     setQueue]     = useState<QueueItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [diagnoses,     setDiagnoses]     = useState<Record<string, DiagnosisResult>>({});
  const [corrections,   setCorrections]   = useState<Record<string, { email: string; cpf: string }>>({});
  const [approveLoading, setApproveLoading] = useState<Record<string, boolean>>({});
  const [theme,     setTheme]     = useState<"light"|"dark">("light");
  const [ingestMode,    setIngestMode]    = useState<"csv" | "manual">("csv");
  const [csvData,       setCsvData]       = useState<Record<string, string>[]>([]);
  const [csvColumns,    setCsvColumns]    = useState<string[]>([]);
  const [isCsvValid,    setIsCsvValid]    = useState(false);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult,  setIngestResult]  = useState<{ total: number; clean: number; review: number } | null>(null);
  const [ingestError,   setIngestError]   = useState("");
  const [ingestProgress, setIngestProgress] = useState<{ current: number; total: number; processed: number; totalRecords: number } | null>(null);
  const [formRecord,    setFormRecord]    = useState({ name: "", email: "", cpf: "" });
  const [apiKeys,       setApiKeys]       = useState<{ id: number; label: string | null; created_at: string }[]>([]);
  const [newKeyLabel,   setNewKeyLabel]   = useState("");
  const [generatedKey,  setGeneratedKey]  = useState<string | null>(null);
  const [keyLoading,    setKeyLoading]    = useState(false);
  const [copiedKey,     setCopiedKey]     = useState(false);
  const [webhookUrl,    setWebhookUrl]    = useState("");
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [webhookCurrent, setWebhookCurrent] = useState<{ url: string; secret: string; active: boolean } | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // ── Bulk approval state ──────────────────────────────────────────────────
  const [selectedNames,  setSelectedNames]  = useState<string[]>([]);
  const [bulkStep,       setBulkStep]       = useState<"idle" | "confirm" | "executing" | "completed">("idle");
  const [bulkMode,       setBulkMode]       = useState<"auto" | "all">("auto");
  const [bulkProgress,   setBulkProgress]   = useState({ current: 0, total: 0 });
  const [bulkReport,     setBulkReport]     = useState({ approved: 0, skipped: 0, error: 0 });
  const [bulkLog,        setBulkLog]        = useState<BulkLogEntry[]>([]);
  const bulkCancelRef = useRef(false);

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

  const fetchSettings = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const [keysRes, whRes] = await Promise.all([
        apiFetch(`${API}/keys`, { headers: h }),
        apiFetch(`${API}/webhook`, { headers: h }),
      ]);
      if (keysRes.ok) setApiKeys(await keysRes.json());
      if (whRes.ok) {
        const wh = await whRes.json();
        setWebhookCurrent(wh);
        setWebhookUrl(wh.url);
      }
    } catch { /* ignore */ }
    finally { setSettingsLoaded(true); }
  }, []);

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
        const diag: DiagnosisResult = d.campo_afetado
          ? { campo_afetado: d.campo_afetado, valor_original: d.valor_original, valor_sugerido: d.valor_sugerido, diagnostico_motivo: d.diagnostico_motivo }
          : { campo_afetado: "—", valor_original: "—", valor_sugerido: "—", diagnostico_motivo: d.diagnostico ?? t.dashboard.claudeError };
        setDiagnoses(p => ({ ...p, [name]: diag }));
        setCorrections(p => ({
          ...p,
          [name]: {
            email: d.campo_afetado === "email" ? d.valor_sugerido : "",
            cpf:   d.campo_afetado === "cpf"   ? d.valor_sugerido : "",
          },
        }));
      }
    } catch {
      setDiagnoses(p => ({
        ...p,
        [name]: { campo_afetado: "—", valor_original: "—", valor_sugerido: "—", diagnostico_motivo: t.dashboard.claudeError },
      }));
    }
  }

  async function handleApprove(name: string) {
    const corr = corrections[name];
    if (!corr) return;
    setApproveLoading(p => ({ ...p, [name]: true }));
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }
    try {
      await apiFetch(`${API}/resolve`, {
        method: "POST", headers: h,
        body: JSON.stringify({ name, email: corr.email || null, cpf: corr.cpf || null }),
      });
      setDiagnoses(p => { const c = { ...p }; delete c[name]; return c; });
      setCorrections(p => { const c = { ...p }; delete c[name]; return c; });
      fetchData();
    } catch { /* user can retry */ }
    finally { setApproveLoading(p => ({ ...p, [name]: false })); }
  }

  async function handleGenerateKey() {
    setKeyLoading(true); setGeneratedKey(null);
    const h = await getFreshHeaders();
    if (!h) { setKeyLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/keys`, {
        method: "POST", headers: h,
        body: JSON.stringify({ label: newKeyLabel || null }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedKey(data.key);
        setNewKeyLabel("");
        fetchSettings();
      }
    } catch { /* ignore */ }
    finally { setKeyLoading(false); }
  }

  async function handleRevokeKey(id: number) {
    const h = await getFreshHeaders();
    if (!h) return;
    await apiFetch(`${API}/keys/${id}`, { method: "DELETE", headers: h });
    fetchSettings();
  }

  async function handleSaveWebhook() {
    if (!webhookUrl) return;
    setWebhookLoading(true); setWebhookSecret(null);
    const h = await getFreshHeaders();
    if (!h) { setWebhookLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/webhook`, {
        method: "POST", headers: h,
        body: JSON.stringify({ url: webhookUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        setWebhookCurrent(data);
        setWebhookSecret(data.secret);
      }
    } catch { /* ignore */ }
    finally { setWebhookLoading(false); }
  }

  async function handleBulkApprove(mode: "auto" | "all") {
    setBulkMode(mode);
    setBulkStep("executing");
    bulkCancelRef.current = false;

    const names = [...selectedNames];
    setBulkProgress({ current: 0, total: names.length });
    setBulkReport({ approved: 0, skipped: 0, error: 0 });
    setBulkLog(names.map(n => ({ name: n, status: "analyzing" as const })));

    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }

    let approved = 0, skipped = 0, errors = 0;

    for (let i = 0; i < names.length; i++) {
      if (bulkCancelRef.current) break;

      const name = names[i];
      setBulkProgress({ current: i + 1, total: names.length });

      try {
        // Reuse cached diagnosis if available from manual triage
        let diag = diagnoses[name];
        if (!diag) {
          const diagRes = await apiFetch(`${API}/analyze/${encodeURIComponent(name)}`, { headers: h });
          if (!diagRes.ok) throw new Error(`HTTP ${diagRes.status}`);
          const d = await diagRes.json();
          diag = {
            campo_afetado:     d.campo_afetado     || "—",
            valor_original:    d.valor_original    || "—",
            valor_sugerido:    d.valor_sugerido    || "",
            diagnostico_motivo: d.diagnostico_motivo || "",
          };
          setDiagnoses(p => ({ ...p, [name]: diag }));
        }

        const corrEmail = diag.campo_afetado === "email" ? diag.valor_sugerido : "";
        const corrCpf   = diag.campo_afetado === "cpf"   ? diag.valor_sugerido : "";
        const hasValidFix = diag.valor_sugerido && diag.valor_sugerido !== "—";

        if (!hasValidFix && mode === "auto") {
          skipped++;
          setBulkLog(prev => prev.map(l => l.name === name
            ? { ...l, status: "skipped", detail: "sem sugestão automática" } : l));
          setBulkReport(r => ({ ...r, skipped: r.skipped + 1 }));
          continue;
        }

        const resolveRes = await apiFetch(`${API}/resolve`, {
          method: "POST", headers: h,
          body: JSON.stringify({ name, email: corrEmail || null, cpf: corrCpf || null }),
        });

        if (resolveRes.ok) {
          approved++;
          setBulkLog(prev => prev.map(l => l.name === name
            ? { ...l, status: "success", detail: `${diag.campo_afetado}: ${diag.valor_sugerido}` } : l));
          setBulkReport(r => ({ ...r, approved: r.approved + 1 }));
          // Remove from local diagnosis cache
          setDiagnoses(p => { const c = { ...p }; delete c[name]; return c; });
          setCorrections(p => { const c = { ...p }; delete c[name]; return c; });
        } else {
          errors++;
          setBulkLog(prev => prev.map(l => l.name === name
            ? { ...l, status: "error", detail: `HTTP ${resolveRes.status}` } : l));
          setBulkReport(r => ({ ...r, error: r.error + 1 }));
        }
      } catch (e) {
        errors++;
        setBulkLog(prev => prev.map(l => l.name === name
          ? { ...l, status: "error", detail: e instanceof Error ? e.message : "erro" } : l));
        setBulkReport(r => ({ ...r, error: r.error + 1 }));
      }
    }

    setBulkStep("completed");
    setSelectedNames([]);
    fetchData();
  }

  async function handleDeleteWebhook() {
    const h = await getFreshHeaders();
    if (!h) return;
    await apiFetch(`${API}/webhook`, { method: "DELETE", headers: h });
    setWebhookCurrent(null); setWebhookUrl(""); setWebhookSecret(null);
  }

  function formatCpfCnpj(raw: string): string {
    const d = raw.replace(/\D/g, "").slice(0, 14);
    if (d.length <= 11) {
      return d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: { data: Record<string, string>[]; meta: { fields?: string[] } }) => {
        const columns = results.meta.fields ?? [];
        const valid = ["name", "email", "cpf"].every(c => columns.includes(c));
        setCsvColumns(columns);
        setCsvData(results.data);
        setIsCsvValid(valid);
        setIngestResult(null);
        setIngestError("");
      },
    });
  }

  const CHUNK_SIZE = 500;

  async function submitIngestion(payload: Record<string, string>[]) {
    setIngestLoading(true); setIngestError(""); setIngestResult(null); setIngestProgress(null);
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }

    const chunks: Record<string, string>[][] = [];
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      chunks.push(payload.slice(i, i + CHUNK_SIZE));
    }

    let lastClean = 0;
    let lastReview = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        setIngestProgress({
          current: i + 1,
          total: chunks.length,
          processed: i * CHUNK_SIZE,
          totalRecords: payload.length,
        });
        const res = await fetch(`${API}/ingest`, {
          method: "POST", headers: h, body: JSON.stringify(chunks[i]),
        });
        if (res.ok) {
          const data = await res.json();
          lastClean  = data.registros_banco_limpo;
          lastReview = data.registros_fila_revisao;
        } else {
          setIngestError(`Erro ${res.status} no lote ${i + 1}/${chunks.length}`);
          return;
        }
      }
      setIngestResult({ total: payload.length, clean: lastClean, review: lastReview });
      setCsvData([]); setCsvColumns([]);
      setFormRecord({ name: "", email: "", cpf: "" });
      fetchData();
    } catch { setIngestError(t.dashboard.errConn); }
    finally { setIngestLoading(false); setIngestProgress(null); }
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
    ingestLabel:      { display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, letterSpacing: "0.01em" },
    ingestInput:      { width: "100%", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: "0.88rem", color: "var(--text-primary)", backgroundColor: "var(--bg-surface-2)", outline: "none", boxSizing: "border-box" as const },
    ingestBtn:        { backgroundColor: "var(--accent)", color: "#fff", borderRadius: 10, padding: "11px 20px", fontSize: "0.88rem", fontWeight: 600, border: "none", cursor: "pointer", letterSpacing: "0.01em" },
    ingestModeActive: { padding: "7px 16px", borderRadius: 8, backgroundColor: "var(--accent)", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 },
    ingestModeInac:   { padding: "7px 16px", borderRadius: 8, backgroundColor: "var(--bg-surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 500 },
    dropzone:         { display: "block", padding: "48px 24px", border: "2px dashed var(--border)", borderRadius: 12, textAlign: "center" as const, cursor: "pointer", color: "var(--text-muted)", fontSize: "0.88rem", backgroundColor: "var(--bg-surface-2)" },
    settingsCard:     { backgroundColor: "var(--bg-surface)", borderRadius: 14, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: "24px" },
    settingsTitle:    { fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px 0" },
    settingsDesc:     { fontSize: "0.8rem", color: "var(--text-muted)", margin: "0 0 16px 0" },
    keyRow:           { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", backgroundColor: "var(--bg-surface-2)", borderRadius: 8, border: "1px solid var(--border)" },
    keyMono:          { fontFamily: "var(--font-geist-mono)", fontSize: "0.8rem", color: "var(--text-secondary)", wordBreak: "break-all" as const, flex: 1 },
    copyBtn:          { fontSize: "0.75rem", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" as const, marginLeft: 8 },
    revokeBtn:        { fontSize: "0.75rem", color: "var(--danger)", background: "none", border: "none", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" as const },
    secretHint:       { fontSize: "0.73rem", color: "var(--text-muted)", marginTop: 4, fontStyle: "italic" as const },
    // Bulk approval
    floatingToolbar:  { position: "fixed" as const, bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 60, display: "flex", alignItems: "center", gap: 14, padding: "12px 22px", backgroundColor: "#0F172A", color: "#fff", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,.45)", border: "1px solid rgba(255,255,255,.1)", whiteSpace: "nowrap" as const },
    modalOverlay:     { position: "fixed" as const, inset: 0, backgroundColor: "rgba(0,0,0,.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
    modalCard:        { backgroundColor: "var(--bg-surface)", borderRadius: 18, border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", padding: "32px", width: "100%", maxWidth: 560, maxHeight: "80vh", overflowY: "auto" as const },
    bulkLogBox:       { maxHeight: 220, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 4, marginTop: 12, padding: "10px 14px", backgroundColor: "var(--bg-surface-2)", borderRadius: 10, border: "1px solid var(--border)" },
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
          <button onClick={() => setTab("dashboard")} style={tab === "dashboard" ? s.tabActive : s.tabInactive}>
              {t.dashboard.tabDashboard}
            </button>
            <button onClick={() => setTab("queue")} style={tab === "queue" ? s.tabActive : s.tabInactive}>
              <span style={{ display: "flex", alignItems: "center" }}>
                {t.dashboard.tabQueue}
                {queue.length > 0 && <span style={s.badge}>{queue.length}</span>}
              </span>
            </button>
            <button onClick={() => setTab("ingest")} style={tab === "ingest" ? s.tabActive : s.tabInactive}>
              {t.ingest.tab}
            </button>
            <button onClick={() => { setTab("settings"); if (!settingsLoaded) fetchSettings(); }} style={tab === "settings" ? s.tabActive : s.tabInactive}>
              {t.settings.tab}
            </button>
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
        ) : tab === "queue" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {queue.length === 0 ? (
              <div style={s.successBox}>
                <p style={{ fontWeight: 600, fontSize: "0.95rem" }}>{t.dashboard.queueEmpty}</p>
                <p style={{ fontSize: "0.82rem", marginTop: 4, opacity: 0.8 }}>{t.dashboard.queueEmptySub}</p>
              </div>
            ) : (
            <>
              {/* Select-all toolbar */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 4px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.84rem", color: "var(--text-secondary)", fontWeight: 500, userSelect: "none" as const }}>
                  <input
                    type="checkbox"
                    checked={selectedNames.length === queue.length && queue.length > 0}
                    onChange={e => setSelectedNames(e.target.checked ? queue.map(r => r.name) : [])}
                    style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)" }}
                  />
                  {selectedNames.length === queue.length && queue.length > 0
                    ? `${t.bulk.deselectAll} (${queue.length})`
                    : `${t.bulk.selectAll} (${queue.length})`}
                </label>
                {selectedNames.length > 0 && (
                  <span style={{ fontSize: "0.78rem", color: "var(--accent)", fontWeight: 700 }}>
                    {selectedNames.length} {t.bulk.toolbarSelected}
                  </span>
                )}
              </div>

              {queue.map((item, i) => (
              <div key={i} style={{ ...s.alertCard, outline: selectedNames.includes(item.name) ? "2px solid var(--accent)" : "2px solid transparent", transition: "outline 0.15s" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={selectedNames.includes(item.name)}
                      onChange={e => setSelectedNames(prev => e.target.checked ? [...prev, item.name] : prev.filter(n => n !== item.name))}
                      style={{ width: 16, height: 16, cursor: "pointer", marginTop: 4, accentColor: "var(--accent)", flexShrink: 0 }}
                    />
                    <div>
                    <span style={s.alertBadge}>{t.dashboard.alertLabel} #{i + 1}</span>
                    <p style={{ fontWeight: 700, color: "var(--text-primary)", marginTop: 6, fontSize: "0.95rem" }}>{item.name}</p>
                    </div>
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
                {diagnoses[item.name] ? (
                  <div>
                    <div style={s.diagnoseBox}>
                      <p style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>
                        {t.dashboard.claude}
                        <span style={{ fontWeight: 400 }}>{diagnoses[item.name].diagnostico_motivo}</span>
                      </p>
                      <p style={{ fontSize: "0.75rem", opacity: 0.85 }}>
                        <strong>{t.dashboard.diagnoseField}:</strong>{" "}{diagnoses[item.name].campo_afetado}
                        {"  "}<code style={{ backgroundColor: "var(--bg-surface)", padding: "1px 5px", borderRadius: 4 }}>{diagnoses[item.name].valor_original}</code>
                        {" → "}<code style={{ backgroundColor: "var(--bg-surface)", padding: "1px 5px", borderRadius: 4 }}>{diagnoses[item.name].valor_sugerido}</code>
                      </p>
                    </div>
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div>
                        <label style={s.ingestLabel}>{t.dashboard.corrEmail}</label>
                        <input type="email" style={s.ingestInput}
                          value={corrections[item.name]?.email ?? ""}
                          onChange={e => setCorrections(p => ({ ...p, [item.name]: { ...p[item.name], email: e.target.value } }))}
                        />
                      </div>
                      <div>
                        <label style={s.ingestLabel}>{t.dashboard.corrCpf}</label>
                        <input type="text" style={s.ingestInput}
                          value={corrections[item.name]?.cpf ?? ""}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            setCorrections(p => ({ ...p, [item.name]: { ...p[item.name], cpf: formatCpfCnpj(e.target.value) } }))
                          }
                        />
                      </div>
                      <button
                        onClick={() => handleApprove(item.name)}
                        disabled={approveLoading[item.name]}
                        style={{ ...s.ingestBtn, fontSize: "0.82rem", opacity: approveLoading[item.name] ? 0.6 : 1 }}
                      >
                        {approveLoading[item.name] ? t.dashboard.approving : t.dashboard.approveBtn}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => handleDiagnose(item.name)} style={s.diagnoseBtn}>{t.dashboard.diagnoseBtn}</button>
                )}
              </div>
            ))}
            </>
            )}
          </div>
        ) : tab === "ingest" ? (
          /* ── INGESTÃO DE DADOS ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={ingestMode === "csv" ? s.ingestModeActive : s.ingestModeInac} onClick={() => setIngestMode("csv")}>{t.ingest.modeCSV}</button>
              <button style={ingestMode === "manual" ? s.ingestModeActive : s.ingestModeInac} onClick={() => setIngestMode("manual")}>{t.ingest.modeManual}</button>
            </div>

            {ingestError && <div style={s.errorBox}><p style={{ fontSize: "0.85rem" }}>{ingestError}</p></div>}

            {ingestMode === "csv" ? (
              <div style={s.card}>
                <label style={s.dropzone}>
                  {t.ingest.dropzone}
                  <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: "none" }} />
                </label>
                {csvData.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <p style={{ fontSize: "0.82rem", fontWeight: 600, color: isCsvValid ? "var(--success-text)" : "var(--danger)", marginBottom: 8 }}>
                      {isCsvValid ? `✅ ${t.ingest.columnsOk}` : `❌ ${t.ingest.columnsMissing}`}
                    </p>
                    <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>{csvData.length} {t.ingest.recordCount}</p>
                    <div style={{ overflowX: "auto", marginBottom: 16 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead><tr>{csvColumns.map(c => <th key={c} style={{ ...s.tableHead, textAlign: "left" }}>{c}</th>)}</tr></thead>
                        <tbody>
                          {csvData.slice(0, 5).map((row, i) => (
                            <tr key={i}>{csvColumns.map(c => <td key={c} style={s.tableCell}>{row[c]}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {ingestLoading && ingestProgress ? (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: 6 }}>
                          <span>{t.ingest.batchLabel} {ingestProgress.current} {t.ingest.batchOf} {ingestProgress.total}</span>
                          <span>{Math.min(ingestProgress.current * CHUNK_SIZE, ingestProgress.totalRecords).toLocaleString()} / {ingestProgress.totalRecords.toLocaleString()} {t.ingest.recordCount}</span>
                        </div>
                        <div style={{ height: 10, backgroundColor: "var(--bg-surface-2)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                          <div style={{
                            height: "100%",
                            width: `${Math.round((ingestProgress.current / ingestProgress.total) * 100)}%`,
                            backgroundColor: "var(--accent)",
                            borderRadius: 6,
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 6, textAlign: "center" }}>
                          {Math.round((ingestProgress.current / ingestProgress.total) * 100)}% — {t.ingest.processing}
                        </p>
                      </div>
                    ) : (
                      <button disabled={!isCsvValid || ingestLoading} onClick={() => submitIngestion(csvData)}
                        style={{ ...s.ingestBtn, opacity: !isCsvValid || ingestLoading ? 0.6 : 1 }}>
                        {t.ingest.process}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={s.card}>
                <form onSubmit={e => { e.preventDefault(); submitIngestion([formRecord]); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={s.ingestLabel}>{t.ingest.fieldName}</label>
                    <input required type="text" style={s.ingestInput} value={formRecord.name} onChange={e => setFormRecord({ ...formRecord, name: e.target.value })} />
                  </div>
                  <div>
                    <label style={s.ingestLabel}>{t.ingest.fieldEmail}</label>
                    <input type="email" style={s.ingestInput} value={formRecord.email} onChange={e => setFormRecord({ ...formRecord, email: e.target.value })} />
                  </div>
                  <div>
                    <label style={s.ingestLabel}>{t.ingest.fieldCpf}</label>
                    <input
                      type="text"
                      style={s.ingestInput}
                      value={formRecord.cpf}
                      placeholder="000.000.000-00 ou 00.000.000/0000-00"
                      onChange={(e: ChangeEvent<HTMLInputElement>) =>
                        setFormRecord({ ...formRecord, cpf: formatCpfCnpj(e.target.value) })
                      }
                    />
                  </div>
                  <button type="submit" disabled={ingestLoading} style={{ ...s.ingestBtn, opacity: ingestLoading ? 0.6 : 1 }}>
                    {ingestLoading ? t.ingest.processing : t.ingest.submit}
                  </button>
                </form>
              </div>
            )}

            {ingestResult && (
              <div style={{ ...s.card, backgroundColor: "var(--success-subtle)", border: "1px solid var(--success)" }}>
                <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--success-text)", marginBottom: 8 }}>
                  ✅ {ingestResult.total} {t.ingest.successBatch}
                </p>
                <ul style={{ fontSize: "0.85rem", color: "var(--success-text)", paddingLeft: 16, margin: 0 }}>
                  <li>{ingestResult.clean} {t.ingest.clean}</li>
                  <li>{ingestResult.review} {t.ingest.review}</li>
                </ul>
              </div>
            )}
          </div>
        ) : (
          /* ── SETTINGS ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* API Keys */}
            <div style={s.settingsCard}>
              <p style={s.settingsTitle}>{t.settings.apiKeys}</p>
              <p style={s.settingsDesc}>{t.settings.apiKeysDesc}</p>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  type="text"
                  placeholder={t.settings.keyLabelPlaceholder}
                  value={newKeyLabel}
                  onChange={e => setNewKeyLabel(e.target.value)}
                  style={{ ...s.ingestInput, flex: 1 }}
                />
                <button onClick={handleGenerateKey} disabled={keyLoading}
                  style={{ ...s.ingestBtn, opacity: keyLoading ? 0.6 : 1 }}>
                  {keyLoading ? t.settings.saving : t.settings.generateKey}
                </button>
              </div>
              {generatedKey && (
                <div style={{ padding: "12px 14px", backgroundColor: "var(--success-subtle)", borderRadius: 8, border: "1px solid var(--success)", marginBottom: 16 }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--success-text)", marginBottom: 8 }}>{t.settings.keyGenerated}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={s.keyMono}>{generatedKey}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(generatedKey); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}
                      style={s.copyBtn}>
                      {copiedKey ? t.settings.copied : t.settings.copyKey}
                    </button>
                  </div>
                </div>
              )}
              {apiKeys.length === 0 ? (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{t.settings.noKeys}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {apiKeys.map(k => (
                    <div key={k.id} style={s.keyRow}>
                      <div>
                        <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>{k.label || `Key #${k.id}`}</p>
                        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{k.created_at}</p>
                      </div>
                      <button onClick={() => handleRevokeKey(k.id)} style={s.revokeBtn}>{t.settings.revokeKey}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Webhook */}
            <div style={s.settingsCard}>
              <p style={s.settingsTitle}>{t.settings.webhookTitle}</p>
              <p style={s.settingsDesc}>{t.settings.webhookDesc}</p>
              {webhookCurrent && (
                <div style={{ padding: "12px 14px", backgroundColor: "var(--bg-surface-2)", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 16 }}>
                  <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{webhookCurrent.url}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 2 }}>
                    {t.settings.webhookSecret}: <code style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.72rem" }}>{webhookCurrent.secret.slice(0, 16)}…</code>
                  </p>
                  <p style={s.secretHint}>{t.settings.webhookSecretHint}</p>
                  <button onClick={handleDeleteWebhook} style={{ ...s.revokeBtn, marginTop: 8 }}>{t.settings.deleteWebhook}</button>
                </div>
              )}
              {webhookSecret && (
                <div style={{ padding: "12px 14px", backgroundColor: "var(--success-subtle)", borderRadius: 8, border: "1px solid var(--success)", marginBottom: 16 }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--success-text)", marginBottom: 4 }}>{t.settings.webhookSecret}</p>
                  <span style={{ ...s.keyMono, color: "var(--success-text)" }}>{webhookSecret}</span>
                  <p style={{ ...s.secretHint, color: "var(--success-text)" }}>{t.settings.webhookSecretHint}</p>
                </div>
              )}
              {!webhookCurrent && !webhookSecret && (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>{t.settings.webhookNone}</p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="url"
                  placeholder={t.settings.webhookUrlPlaceholder}
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  style={{ ...s.ingestInput, flex: 1 }}
                />
                <button onClick={handleSaveWebhook} disabled={webhookLoading || !webhookUrl}
                  style={{ ...s.ingestBtn, opacity: webhookLoading || !webhookUrl ? 0.6 : 1 }}>
                  {webhookLoading ? t.settings.saving : t.settings.saveWebhook}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── FLOATING TOOLBAR ──────────────────────────────────────────────── */}
      {selectedNames.length > 0 && bulkStep === "idle" && (
        <div style={s.floatingToolbar}>
          <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>
            {selectedNames.length} {t.bulk.toolbarSelected}
          </span>
          <button
            onClick={() => setBulkStep("confirm")}
            style={{ padding: "8px 20px", backgroundColor: "var(--accent)", color: "#fff", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700 }}
          >
            ▶ {t.bulk.btnAgent}
          </button>
          <button
            onClick={() => setSelectedNames([])}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── BULK MODAL ────────────────────────────────────────────────────── */}
      {(bulkStep === "confirm" || bulkStep === "executing" || bulkStep === "completed") && (
        <div style={s.modalOverlay}>
          <div style={s.modalCard}>

            {/* ── CONFIRM ── */}
            {bulkStep === "confirm" && (
              <>
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 6, letterSpacing: "-0.02em" }}>
                  🤖 {t.bulk.modalTitle}
                </h2>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: 24 }}>
                  <strong style={{ color: "var(--accent)", fontSize: "1.3rem" }}>{selectedNames.length}</strong>{" "}
                  {t.bulk.confirmSubtitle}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    onClick={() => handleBulkApprove("auto")}
                    style={{ ...s.ingestBtn, textAlign: "left", padding: "14px 18px" }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>✅ {t.bulk.btnOnlyAuto}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.8, fontWeight: 400 }}>
                      Registros sem sugestão válida são pulados automaticamente
                    </div>
                  </button>
                  <button
                    onClick={() => handleBulkApprove("all")}
                    style={{ ...s.ingestBtn, backgroundColor: "var(--warning)", textAlign: "left", padding: "14px 18px" }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>⚠️ {t.bulk.btnProcessAll}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.8, fontWeight: 400 }}>
                      Dados em falta serão aprovados com campos nulos
                    </div>
                  </button>
                  <button
                    onClick={() => setBulkStep("idle")}
                    style={{ padding: "11px 0", borderRadius: 10, border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.86rem", fontWeight: 500 }}
                  >
                    {t.bulk.btnCancel}
                  </button>
                </div>
              </>
            )}

            {/* ── EXECUTING ── */}
            {bulkStep === "executing" && (
              <>
                <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 4 }}>
                  🔄 {t.bulk.processingTitle}
                </h2>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 20 }}>
                  {bulkMode === "auto" ? t.bulk.btnOnlyAuto : t.bulk.btnProcessAll}
                </p>

                {/* Progress bar */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: 6 }}>
                    <span>{bulkProgress.current} / {bulkProgress.total}</span>
                    <span>{bulkProgress.total > 0 ? Math.round((bulkProgress.current / bulkProgress.total) * 100) : 0}%</span>
                  </div>
                  <div style={{ height: 10, backgroundColor: "var(--bg-surface-2)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--border)" }}>
                    <div style={{
                      height: "100%",
                      width: `${bulkProgress.total > 0 ? Math.round((bulkProgress.current / bulkProgress.total) * 100) : 0}%`,
                      backgroundColor: "var(--accent)",
                      borderRadius: 6,
                      transition: "width 0.35s ease",
                    }} />
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: "0.73rem" }}>
                    <span style={{ color: "var(--success-text)" }}>✅ {bulkReport.approved} {t.bulk.statusSuccess}</span>
                    <span style={{ color: "var(--warning-text)" }}>⏭️ {bulkReport.skipped} {t.bulk.statusSkipped}</span>
                    <span style={{ color: "var(--danger-text)" }}>❌ {bulkReport.error} {t.bulk.statusError}</span>
                  </div>
                </div>

                {/* Live log */}
                <div style={s.bulkLogBox}>
                  {bulkLog.slice(-12).map(entry => (
                    <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.76rem", padding: "2px 0" }}>
                      <span style={{ flexShrink: 0 }}>
                        {entry.status === "success"   ? "✅" :
                         entry.status === "error"     ? "❌" :
                         entry.status === "skipped"   ? "⏭️" : "🔄"}
                      </span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, color: "var(--text-primary)", fontWeight: 500 }}>
                        {entry.name}
                      </span>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.68rem", flexShrink: 0 }}>
                        {entry.status === "analyzing" ? t.bulk.statusAnalyzing :
                         entry.status === "success"   ? (entry.detail || t.bulk.statusSuccess) :
                         entry.status === "skipped"   ? t.bulk.statusSkipped :
                         (entry.detail || t.bulk.statusError)}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => { bulkCancelRef.current = true; }}
                  style={{ marginTop: 16, width: "100%", padding: "9px 0", borderRadius: 10, border: "1px solid var(--border)", backgroundColor: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: "0.84rem", fontWeight: 600 }}
                >
                  {t.bulk.btnCancel}
                </button>
              </>
            )}

            {/* ── COMPLETED ── */}
            {bulkStep === "completed" && (
              <>
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: 8 }}>🎉</div>
                  <h2 style={{ fontSize: "1.1rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{t.bulk.reportTitle}</h2>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                  {[
                    { value: bulkReport.approved, label: t.bulk.reportApproved, color: "var(--success)", bg: "var(--success-subtle)", icon: "✅" },
                    { value: bulkReport.skipped,  label: t.bulk.reportSkipped,  color: "var(--warning-text)", bg: "var(--warning-subtle)", icon: "⏭️" },
                    { value: bulkReport.error,    label: t.bulk.reportError,    color: "var(--danger-text)", bg: "var(--danger-subtle)", icon: "❌" },
                  ].map(row => (
                    <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", backgroundColor: row.bg, borderRadius: 10 }}>
                      <span style={{ fontSize: "1.2rem" }}>{row.icon}</span>
                      <span style={{ fontSize: "1.4rem", fontWeight: 800, color: row.color, minWidth: 32 }}>{row.value}</span>
                      <span style={{ fontSize: "0.83rem", color: row.color }}>{row.label}</span>
                    </div>
                  ))}
                </div>

                {bulkReport.approved > 0 && (
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", textAlign: "center", marginBottom: 16 }}>
                    🔗 {bulkReport.approved} {t.bulk.webhooksFired}
                  </p>
                )}

                <button
                  onClick={() => setBulkStep("idle")}
                  style={{ ...s.ingestBtn, width: "100%", textAlign: "center" }}
                >
                  {t.bulk.btnClose}
                </button>
              </>
            )}

          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        button:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}
