"use client";

import { useState, useEffect, useCallback, useRef, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, LangSelector } from "@/lib/i18n/context";
import Papa from "papaparse";

const API = process.env.NEXT_PUBLIC_API_URL + "/api/v1";

type CleanRecord    = { name: string; email: string; cpf: string };
type QueueItem      = { name: string; email_hint: string; cpf_hint: string; legal_basis?: string | null };
type AuditLogEntry  = { id: number; operator_email: string; record_name: string; action: string; fields_affected: string | Record<string, unknown>; created_at: string };
type FieldSchema    = { field_key: string; label: string; field_type: string; required: boolean; position: number; validation_rules: Record<string, unknown>; is_sensitive: boolean };
type PlanInfo       = { plan: string; field_limit: number; field_count: number };
type PlanConfig    = { plan_name: string; field_limit: number; price_monthly: number; stripe_price_id: string | null; records_per_month: number; api_keys_limit: number; diagnoses_per_month: number };
type EnterpriseConfig  = { tenant_id: string; stripe_price_id: string; amount_display: number; currency_display: string };
type TenantOption      = { tenant_id: string; company_name: string | null; plan: string; subscription_status: string | null };
type SubscriptionInfo = {
  plan: string; effective_plan: string;
  status: string; // trialing | active | expired | canceled | free
  trial_ends_at: string | null; trial_days_left: number | null;
  stripe_customer_id: string | null; stripe_subscription_id: string | null;
  enterprise_config?: EnterpriseConfig | null;
};
type SecretEntry   = { key_name: string; updated_at: string };
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

export default function DashboardClient({ token: _token, userName }: { token: string; userName: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [tab,       setTab]       = useState<"dashboard" | "queue" | "ingest" | "settings" | "schema" | "audit" | "admin" | "subscription" | "users">("dashboard");
  const [db,        setDb]        = useState<CleanRecord[]>([]);
  const [queue,     setQueue]     = useState<QueueItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [diagnoses,     setDiagnoses]     = useState<Record<string, DiagnosisResult>>({});
  const [corrections,   setCorrections]   = useState<Record<string, { email: string; cpf: string }>>({});
  const [approveLoading, setApproveLoading] = useState<Record<string, boolean>>({});
  const [theme,     setTheme]     = useState<"light"|"dark">("light");
  const [workspaces, setWorkspaces] = useState<{ id: number; name: string; description: string; created_at: string }[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<number | null>(null);
  const [workspacesLoaded, setWorkspacesLoaded] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<{ id: number; workspace_id: number; email: string; role: string; invited_by: string | null; accepted: boolean; created_at: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("operator");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [ingestMode,    setIngestMode]    = useState<"csv" | "manual">("csv");
  const [csvData,       setCsvData]       = useState<Record<string, string>[]>([]);
  const [csvColumns,    setCsvColumns]    = useState<string[]>([]);
  const [isCsvValid,    setIsCsvValid]    = useState(false);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestResult,  setIngestResult]  = useState<{ total: number; clean: number; review: number } | null>(null);
  const [ingestError,   setIngestError]   = useState("");
  const [ingestProgress, setIngestProgress] = useState<{ current: number; total: number; processed: number; totalRecords: number } | null>(null);
  const [formRecord,    setFormRecord]    = useState<Record<string, string>>({ name: "", email: "", cpf: "" });
  const [schema,        setSchema]        = useState<FieldSchema[]>([]);
  const [schemaLoaded,  setSchemaLoaded]  = useState(false);
  const [newField,      setNewField]      = useState({ field_key: "", label: "", field_type: "text", required: true, position: 0, is_sensitive: false });
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [planInfo,      setPlanInfo]      = useState<PlanInfo | null>(null);
  const [addFieldError, setAddFieldError] = useState("");
  const [isSuperAdmin,  setIsSuperAdmin]  = useState(false);
  const [adminTab,      setAdminTab]      = useState<"plans" | "keys">("plans");
  const [planConfigs,   setPlanConfigs]   = useState<PlanConfig[]>([]);
  const [planSaving,    setPlanSaving]    = useState<Record<string, boolean>>({});
  const [planSaved,     setPlanSaved]     = useState<Record<string, boolean>>({});
  const [secrets,       setSecrets]       = useState<SecretEntry[]>([]);
  const [revealedKeys,  setRevealedKeys]  = useState<Record<string, string>>({});
  const [copiedSecret,  setCopiedSecret]  = useState<Record<string, boolean>>({});
  const [newSecret,     setNewSecret]     = useState({ key_name: "", value: "" });
  const [secretSaving,  setSecretSaving]  = useState(false);
  const [showNewSecretValue, setShowNewSecretValue] = useState(false);
  const [adminLoaded,   setAdminLoaded]   = useState(false);
  const [editPlan,      setEditPlan]      = useState<Record<string, PlanConfig>>({});
  const [syncingStripe,    setSyncingStripe]    = useState(false);
  const [stripeSyncDone,   setStripeSyncDone]   = useState(false);
  const [stripeSyncError,  setStripeSyncError]  = useState("");
  const [revealedPriceIds, setRevealedPriceIds] = useState<Record<string, boolean>>({});
  const [copiedPriceId,    setCopiedPriceId]    = useState<Record<string, boolean>>({});
  const [subscription,  setSubscription]  = useState<SubscriptionInfo | null>(null);
  const [publicPlans,   setPublicPlans]   = useState<PlanConfig[]>([]);
  const [subLoading,    setSubLoading]    = useState(false);
  const [subBanner,     setSubBanner]     = useState<"success" | "canceled" | null>(null);
  const [showEntDrawer, setShowEntDrawer] = useState(false);
  const [entClients,    setEntClients]    = useState<EnterpriseConfig[]>([]);
  const [newEntClient,  setNewEntClient]  = useState({ tenant_id: "", stripe_price_id: "", amount_display: "", currency_display: "BRL" });
  const [entClientSaving, setEntClientSaving] = useState(false);
  const [tenantOptions,   setTenantOptions]   = useState<TenantOption[]>([]);
  const [auditLogs,       setAuditLogs]       = useState<AuditLogEntry[]>([]);
  const [auditLogsLoaded, setAuditLogsLoaded] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [csvMapStep,    setCsvMapStep]    = useState<"upload" | "map" | "ready">("upload");
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
  const [trialExpired,      setTrialExpired]      = useState(false);
  const [dbTotal,           setDbTotal]           = useState<number | null>(null);
  const [exportRowsPerFile, setExportRowsPerFile] = useState(10000);
  const [exportProgress,    setExportProgress]    = useState<{ part: number } | null>(null);
  const [userRole,          setUserRole]          = useState<"admin" | "operator" | "viewer">("admin");
  const [members,           setMembers]           = useState<{ id: number; email: string; role: string; invited_by: string | null; created_at: string }[]>([]);
  const [membersLoaded,     setMembersLoaded]     = useState(false);
  const [newMember,         setNewMember]         = useState({ email: "", role: "operator" });
  const [memberSaving,      setMemberSaving]      = useState(false);
  const [memberError,       setMemberError]       = useState("");
  const [pendingApproval,   setPendingApproval]   = useState<{ name: string; email_hint: string; cpf_hint: string; operator_approved_by: string | null }[]>([]);
  const [adminApproveLoading, setAdminApproveLoading] = useState<Record<string, boolean>>({});
  const [showTierModal,     setShowTierModal]     = useState(false);
  const [enterpriseTiers,   setEnterpriseTiers]   = useState<{ id: number; name: string; description: string; records_per_month: number; api_keys_limit: number; field_limit: number; price_monthly: number; stripe_price_id: string | null; active: boolean }[]>([]);
  const [tiersLoaded,       setTiersLoaded]       = useState(false);
  const [tierCheckoutLoading, setTierCheckoutLoading] = useState<Record<number, boolean>>({});
  const [adminTiers,        setAdminTiers]        = useState<{ id: number; name: string; description: string; records_per_month: number; api_keys_limit: number; diagnoses_per_month: number; field_limit: number; price_monthly: number; stripe_price_id: string | null; active: boolean }[]>([]);
  const [editTierPrice,     setEditTierPrice]     = useState<Record<number, string>>({});
  const [editTierFields,    setEditTierFields]    = useState<Record<number, { records_per_month: number; api_keys_limit: number; diagnoses_per_month: number; field_limit: number; price_monthly: number }>>({});
  const [tierPriceSaving,   setTierPriceSaving]   = useState<Record<number, boolean>>({});
  const [tierPriceSaved,    setTierPriceSaved]    = useState<Record<number, boolean>>({});
  const [revealedTierPriceIds, setRevealedTierPriceIds] = useState<Record<number, boolean>>({});
  const [copiedTierPriceId,    setCopiedTierPriceId]    = useState<Record<number, boolean>>({});
  const [stripeSetupLoading, setStripeSetupLoading] = useState(false);
  const [stripeSetupResult,  setStripeSetupResult]  = useState<{ id: number; name: string; status: string; price_id?: string; detail?: string }[] | null>(null);

  // ── Queue pagination ─────────────────────────────────────────────────────
  const QUEUE_PAGE_SIZE = 50;
  const [queuePage, setQueuePage] = useState(0);

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
    // Phase 2: workspace filter param
    const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
    // Now fetch data (server should be warm)
    try {
      const [dbRes, qRes, profileRes, countRes, pendingRes] = await Promise.all([
        apiFetch(`${API}/database${wsParam}`,          { headers: h }),
        apiFetch(`${API}/review-queue${wsParam}`,      { headers: h }),
        apiFetch(`${API}/admin/profile`,               { headers: h }),
        apiFetch(`${API}/database/count${wsParam}`,    { headers: h }),
        apiFetch(`${API}/pending-approval${wsParam}`,  { headers: h }),
      ]);
      if (profileRes.ok) {
        const prof = await profileRes.json();
        setIsSuperAdmin(prof.is_super_admin);
        if (prof.role) setUserRole(prof.role as "admin" | "operator" | "viewer");
      }
      if (dbRes.ok) setDb(await dbRes.json());
      else if (dbRes.status === 402) { setTrialExpired(true); }
      else if (dbRes.status === 403) setError(t.dashboard.err403);
      else if (dbRes.status === 401) {
        try { const b = await dbRes.clone().json(); setError(`${t.dashboard.err401} (${b.detail})`); }
        catch { setError(t.dashboard.err401); }
      }
      else setError(`${t.dashboard.errApi} ${dbRes.status}.`);
      if (qRes.ok) setQueue(await qRes.json());
      if (countRes.ok) { const c = await countRes.json(); setDbTotal(c.count ?? null); }
      if (pendingRes.ok) setPendingApproval(await pendingRes.json());
      // Phase 2: Load workspaces after server is warm — header selector
      try {
        const wsRes = await apiFetch(`${API}/workspaces`, { headers: h });
        if (wsRes.ok) {
          const ws = await wsRes.json();
          setWorkspaces(ws);
          if (ws.length > 0) setActiveWorkspace((prev: number | null) => prev ?? ws[0].id);
        }
      } catch { /* non-fatal */ }
      finally { setWorkspacesLoaded(true); }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError")
        setError(t.dashboard.errTimeout);
      else
        setError(t.dashboard.errConn);
    } finally { setLoading(false); }
  }, [router, t, activeWorkspace]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sub = params.get("sub");
    if (sub === "success" || sub === "canceled") {
      setSubBanner(sub as "success" | "canceled");
      setTab("subscription");
      window.history.replaceState({}, "", "/dashboard");
      setTimeout(() => setSubBanner(null), 6000);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const [keysRes, whRes, membersRes] = await Promise.all([
        apiFetch(`${API}/keys`,    { headers: h }),
        apiFetch(`${API}/webhook`, { headers: h }),
        apiFetch(`${API}/members`, { headers: h }),
      ]);
      if (keysRes.ok) setApiKeys(await keysRes.json());
      if (whRes.ok) {
        const wh = await whRes.json();
        setWebhookCurrent(wh);
        setWebhookUrl(wh.url);
      }
      if (membersRes.ok) { setMembers(await membersRes.json()); setMembersLoaded(true); }
    } catch { /* ignore */ }
    finally { setSettingsLoaded(true); }
  }, []);

  async function handleAddMember() {
    if (!newMember.email) return;
    setMemberSaving(true); setMemberError("");
    const h = await getFreshHeaders();
    if (!h) { setMemberSaving(false); return; }
    try {
      const res = await apiFetch(`${API}/members`, {
        method: "POST", headers: h,
        body: JSON.stringify(newMember),
      });
      if (res.ok) {
        setNewMember({ email: "", role: "operator" });
        const membersRes = await apiFetch(`${API}/members`, { headers: h });
        if (membersRes.ok) setMembers(await membersRes.json());
      } else {
        const b = await res.json().catch(() => ({}));
        setMemberError(b.detail || `Erro ${res.status}`);
      }
    } catch { setMemberError("Erro de conexão."); }
    finally { setMemberSaving(false); }
  }

  async function handleRemoveMember(email: string) {
    if (!confirm(`Remover ${email} da equipa?`)) return;
    const h = await getFreshHeaders();
    if (!h) return;
    await apiFetch(`${API}/members/${encodeURIComponent(email)}`, { method: "DELETE", headers: h });
    setMembers(prev => prev.filter(m => m.email !== email));
  }

  async function handleChangeMemberRole(email: string, role: string) {
    const h = await getFreshHeaders();
    if (!h) return;
    const res = await apiFetch(`${API}/members/${encodeURIComponent(email)}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      setMembers(prev => prev.map(m => m.email === email ? { ...m, role } : m));
    }
  }

  const fetchSchema = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      // Phase 2: Include workspace_id in schema queries
      const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
      const [schemaRes, planRes] = await Promise.all([
        apiFetch(`${API}/schema${wsParam}`, { headers: h }),
        apiFetch(`${API}/plan`,   { headers: h }),
      ]);
      if (schemaRes.ok) { setSchema(await schemaRes.json()); setSchemaLoaded(true); }
      if (planRes.ok)   setPlanInfo(await planRes.json());
    } catch { /* ignore */ }
  }, [activeWorkspace]);

  async function handleAddField() {
    if (!newField.field_key || !newField.label) return;
    setSchemaLoading(true);
    setAddFieldError("");
    const h = await getFreshHeaders();
    if (!h) { setSchemaLoading(false); return; }
    try {
      // Phase 2: Include workspace_id in field creation
      const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
      const res = await apiFetch(`${API}/schema/fields${wsParam}`, {
        method: "POST", headers: h,
        body: JSON.stringify(newField),
      });
      if (res.ok) {
        setSchema(await res.json());
        setNewField({ field_key: "", label: "", field_type: "text", required: true, position: 0, is_sensitive: false });
        // Refresh plan count after successful add
        const planRes = await apiFetch(`${API}/plan`, { headers: h });
        if (planRes.ok) setPlanInfo(await planRes.json());
      } else if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        setAddFieldError(body.detail || t.schema.limitReached);
      }
    } catch { /* ignore */ }
    finally { setSchemaLoading(false); }
  }

  async function handleDeleteField(field_key: string) {
    if (!confirm(t.schema.confirmDelete)) return;
    const h = await getFreshHeaders();
    if (!h) return;
    // Phase 2: Include workspace_id in field deletion
    const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
    await apiFetch(`${API}/schema/fields/${encodeURIComponent(field_key)}${wsParam}`, { method: "DELETE", headers: h });
    fetchSchema();
  }

  const fetchAdminData = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    const [plansRes, secretsRes, tiersRes] = await Promise.all([
      apiFetch(`${API}/admin/plans`,          { headers: h }),
      apiFetch(`${API}/admin/secrets`,        { headers: h }),
      apiFetch(`${API}/admin/enterprise-tiers`, { headers: h }),
    ]);
    if (plansRes.ok) {
      const configs: PlanConfig[] = await plansRes.json();
      setPlanConfigs(configs);
      const map: Record<string, PlanConfig> = {};
      configs.forEach(c => { map[c.plan_name] = { ...c }; });
      setEditPlan(map);
    }
    if (secretsRes.ok) setSecrets(await secretsRes.json());
    if (tiersRes.ok) {
      const tiers = await tiersRes.json();
      setAdminTiers(tiers);
      const priceMap: Record<number, string> = {};
      const fieldsMap: Record<number, { records_per_month: number; api_keys_limit: number; diagnoses_per_month: number; field_limit: number; price_monthly: number }> = {};
      tiers.forEach((t: { id: number; stripe_price_id: string | null; records_per_month: number; api_keys_limit: number; diagnoses_per_month: number; field_limit: number; price_monthly: number }) => {
        priceMap[t.id] = t.stripe_price_id ?? "";
        fieldsMap[t.id] = { records_per_month: t.records_per_month, api_keys_limit: t.api_keys_limit, diagnoses_per_month: t.diagnoses_per_month, field_limit: t.field_limit, price_monthly: t.price_monthly };
      });
      setEditTierPrice(priceMap);
      setEditTierFields(fieldsMap);
    }
    setAdminLoaded(true);
    // Auto-sync Stripe prices in background — silently updates plan configs if key is configured
    apiFetch(`${API}/admin/stripe/sync`, { method: "POST", headers: h })
      .then(async res => {
        if (res.ok) {
          const freshRes = await apiFetch(`${API}/admin/plans`, { headers: h });
          if (freshRes.ok) {
            const configs: PlanConfig[] = await freshRes.json();
            setPlanConfigs(configs);
            const map: Record<string, PlanConfig> = {};
            configs.forEach(c => { map[c.plan_name] = { ...c }; });
            setEditPlan(map);
          }
        }
      })
      .catch(() => {});
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const res = await apiFetch(`${API}/workspaces`, { headers: h });
      if (res.ok) {
        const ws = await res.json();
        setWorkspaces(ws);
        if (ws.length > 0 && !activeWorkspace) setActiveWorkspace(ws[0].id);
      }
    } catch { /* ignore */ }
    finally { setWorkspacesLoaded(true); }
  }, [activeWorkspace]);


  const fetchWorkspaceMembers = useCallback(async (wsId: number) => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const res = await apiFetch(`${API}/workspaces/${wsId}/members`, { headers: h });
      if (res.ok) setWorkspaceMembers(await res.json());
    } catch { /* ignore */ }
  }, []);

  async function handleInviteWorkspaceMember(wsId: number) {
    if (!inviteEmail || !inviteRole) return;
    setInviteLoading(true);
    const h = await getFreshHeaders();
    if (!h) { setInviteLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/workspaces/${wsId}/members`, {
        method: "POST", headers: h,
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (res.ok) {
        setInviteEmail("");
        setInviteRole("operator");
        await fetchWorkspaceMembers(wsId);
      } else alert("Erro ao convidar membro.");
    } catch { alert("Erro de ligação."); }
    finally { setInviteLoading(false); }
  }

  async function handleRemoveWorkspaceMember(wsId: number, email: string) {
    if (!confirm(`Remover ${email}?`)) return;
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const res = await apiFetch(`${API}/workspaces/${wsId}/members/${email}`, {
        method: "DELETE", headers: h,
      });
      if (res.ok) await fetchWorkspaceMembers(wsId);
      else alert("Erro ao remover membro.");
    } catch { alert("Erro de ligação."); }
  }

  async function handleSavePlan(plan_name: string) {
    const cfg = editPlan[plan_name];
    if (!cfg) return;
    setPlanSaving(p => ({ ...p, [plan_name]: true }));
    const h = await getFreshHeaders();
    if (!h) { setPlanSaving(p => ({ ...p, [plan_name]: false })); return; }
    const res = await apiFetch(`${API}/admin/plans/${plan_name}`, {
      method: "PUT", headers: h,
      body: JSON.stringify({
        field_limit: cfg.field_limit, price_monthly: cfg.price_monthly, stripe_price_id: cfg.stripe_price_id,
        records_per_month: cfg.records_per_month ?? 0,
        api_keys_limit: cfg.api_keys_limit ?? 1,
        diagnoses_per_month: cfg.diagnoses_per_month ?? 0,
      }),
    });
    if (res.ok) {
      const updated: PlanConfig[] = await res.json();
      setPlanConfigs(updated);
      setPlanSaved(p => ({ ...p, [plan_name]: true }));
      setTimeout(() => setPlanSaved(p => ({ ...p, [plan_name]: false })), 2000);
    }
    setPlanSaving(p => ({ ...p, [plan_name]: false }));
  }

  async function handleRevealSecret(key_name: string) {
    if (revealedKeys[key_name] !== undefined) {
      setRevealedKeys(p => { const n = { ...p }; delete n[key_name]; return n; });
      return;
    }
    const h = await getFreshHeaders();
    if (!h) return;
    const res = await apiFetch(`${API}/admin/secrets/${encodeURIComponent(key_name)}/reveal`, { headers: h });
    if (res.ok) {
      const data = await res.json();
      setRevealedKeys(p => ({ ...p, [key_name]: data.value }));
    }
  }

  async function handleCopySecret(key_name: string) {
    const val = revealedKeys[key_name];
    if (!val) return;
    await navigator.clipboard.writeText(val);
    setCopiedSecret(p => ({ ...p, [key_name]: true }));
    setTimeout(() => setCopiedSecret(p => ({ ...p, [key_name]: false })), 2000);
  }

  async function handleSaveSecret() {
    if (!newSecret.key_name || !newSecret.value) return;
    setSecretSaving(true);
    const h = await getFreshHeaders();
    if (!h) { setSecretSaving(false); return; }
    const res = await apiFetch(`${API}/admin/secrets`, {
      method: "POST", headers: h,
      body: JSON.stringify(newSecret),
    });
    if (res.ok) {
      setNewSecret({ key_name: "", value: "" });
      await fetchAdminData();
    }
    setSecretSaving(false);
  }

  async function handleDeleteSecret(key_name: string) {
    if (!confirm(t.admin.confirmDelete)) return;
    const h = await getFreshHeaders();
    if (!h) return;
    await apiFetch(`${API}/admin/secrets/${encodeURIComponent(key_name)}`, { method: "DELETE", headers: h });
    setRevealedKeys(p => { const n = { ...p }; delete n[key_name]; return n; });
    await fetchAdminData();
  }

  async function handleSyncStripe() {
    setSyncingStripe(true);
    setStripeSyncDone(false);
    setStripeSyncError("");
    const h = await getFreshHeaders();
    if (!h) { setSyncingStripe(false); return; }
    try {
      const res = await apiFetch(`${API}/admin/stripe/sync`, { method: "POST", headers: h });
      if (res.ok) {
        const freshRes = await apiFetch(`${API}/admin/plans`, { headers: h });
        if (freshRes.ok) {
          const configs: PlanConfig[] = await freshRes.json();
          setPlanConfigs(configs);
          const map: Record<string, PlanConfig> = {};
          configs.forEach(c => { map[c.plan_name] = { ...c }; });
          setEditPlan(map);
        }
        setStripeSyncDone(true);
        setTimeout(() => setStripeSyncDone(false), 3000);
      } else {
        const body = await res.json().catch(() => ({}));
        setStripeSyncError(body.detail || `Erro ${res.status} ao sincronizar com Stripe.`);
      }
    } catch { setStripeSyncError("Erro de conexão ao tentar sincronizar."); }
    finally { setSyncingStripe(false); }
  }

  const fetchAuditLogs = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const res = await apiFetch(`${API}/audit-logs?limit=100`, { headers: h });
      if (res.ok) setAuditLogs(await res.json());
    } catch { /* ignore */ }
    finally { setAuditLogsLoaded(true); }
  }, []);

  const fetchSubscription = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const [subRes, plansRes] = await Promise.all([
        apiFetch(`${API}/subscription`, { headers: h }),
        apiFetch(`${API}/plans`, { headers: h }),
      ]);
      if (subRes.ok)   setSubscription(await subRes.json());
      if (plansRes.ok) setPublicPlans(await plansRes.json());
    } catch { /* ignore */ }
  }, []);

  const fetchEnterpriseClients = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const res = await apiFetch(`${API}/admin/enterprise/clients`, { headers: h });
      if (res.ok) setEntClients(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchTenantOptions = useCallback(async () => {
    const h = await getFreshHeaders();
    if (!h) return;
    try {
      const res = await apiFetch(`${API}/admin/tenants`, { headers: h });
      if (res.ok) setTenantOptions(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (tab === "subscription") fetchSubscription();
  }, [tab, fetchSubscription]);

  async function handleCheckout(plan_name: string) {
    setSubLoading(true);
    const h = await getFreshHeaders();
    if (!h) { setSubLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/subscription/checkout`, {
        method: "POST", headers: h, body: JSON.stringify({ plan_name }),
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.checkout_url;
      }
    } catch { /* ignore */ }
    finally { setSubLoading(false); }
  }

  async function handlePortal() {
    setSubLoading(true);
    const h = await getFreshHeaders();
    if (!h) { setSubLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/subscription/portal`, { method: "POST", headers: h });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.portal_url;
      }
    } catch { /* ignore */ }
    finally { setSubLoading(false); }
  }

  async function handleSaveEnterpriseClient() {
    if (!newEntClient.tenant_id || !newEntClient.stripe_price_id || !newEntClient.amount_display) return;
    setEntClientSaving(true);
    const h = await getFreshHeaders();
    if (!h) { setEntClientSaving(false); return; }
    try {
      const res = await apiFetch(`${API}/admin/enterprise/clients`, {
        method: "POST", headers: h,
        body: JSON.stringify({ ...newEntClient, amount_display: Number(newEntClient.amount_display) }),
      });
      if (res.ok) {
        setNewEntClient({ tenant_id: "", stripe_price_id: "", amount_display: "", currency_display: "BRL" });
        fetchEnterpriseClients();
      }
    } catch { /* ignore */ }
    finally { setEntClientSaving(false); }
  }

  async function handleDeleteEnterpriseClient(client_tenant_id: string) {
    if (!confirm(t.admin.confirmDeleteEnterpriseClient)) return;
    const h = await getFreshHeaders();
    if (!h) return;
    await apiFetch(`${API}/admin/enterprise/clients/${encodeURIComponent(client_tenant_id)}`, {
      method: "DELETE", headers: h,
    });
    fetchEnterpriseClients();
  }

  async function handleExportCSV() {
    const h = await getFreshHeaders();
    if (!h) return;

    const today = new Date().toISOString().slice(0, 10);
    let afterId: number | null = null;
    let part = 1;
    let hasMore = true;

    setExportProgress({ part: 1 });

    while (hasMore) {
      const params = new URLSearchParams({ limit: String(exportRowsPerFile) });
      if (afterId !== null) params.set("after_id", String(afterId));

      const res = await apiFetch(`${API}/database/export?${params}`, { headers: h });
      if (!res || !res.ok) { setExportProgress(null); return; }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trust-tandem-${today}-part${String(part).padStart(2, "0")}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      hasMore = res.headers.get("X-Has-More") === "true";
      if (hasMore) {
        afterId = Number(res.headers.get("X-Next-Cursor"));
        part++;
        setExportProgress({ part });
        await new Promise(r => setTimeout(r, 600));
      }
    }

    setExportProgress(null);
  }

  function autoMapColumns(columns: string[], currentSchema: FieldSchema[]): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const col of columns) {
      const norm = col.toLowerCase().replace(/[^a-z0-9]/g, "_");
      const match = currentSchema.find(f =>
        f.field_key === norm || f.field_key === col.toLowerCase() ||
        f.label.toLowerCase() === col.toLowerCase()
      );
      mapping[col] = match ? match.field_key : "__ignore__";
    }
    // always map "name" column if present
    if (columns.includes("name")) mapping["name"] = "name";
    return mapping;
  }

  async function handleLogout() {
    const sb = createClient();
    await sb.auth.signOut();
    router.push("/login"); router.refresh();
  }

  async function handleExpurge(name: string) {
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }
    try {
      const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
      await apiFetch(`${API}/review-queue/${encodeURIComponent(name)}${wsParam}`, { method: "DELETE", headers: h });
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
        // Pre-fill correction fields with AI suggestion where applicable
        const sugg = d.valor_sugerido && d.valor_sugerido !== "—" && d.valor_sugerido !== "None"
          ? d.valor_sugerido : "";
        setCorrections(p => ({
          ...p,
          [name]: {
            email: (d.campo_afetado === "email" || d.campo_afetado === "email_e_cpf") ? sugg : (p[name]?.email ?? ""),
            cpf:   (d.campo_afetado === "cpf"   || d.campo_afetado === "email_e_cpf") ? sugg : (p[name]?.cpf  ?? ""),
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
    const corr = corrections[name] ?? { email: "", cpf: "" };
    setApproveLoading(p => ({ ...p, [name]: true }));
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }
    try {
      const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
      await apiFetch(`${API}/resolve${wsParam}`, {
        method: "POST", headers: h,
        body: JSON.stringify({ name, email: corr.email || null, cpf: corr.cpf || null }),
      });
      setDiagnoses(p => { const c = { ...p }; delete c[name]; return c; });
      setCorrections(p => { const c = { ...p }; delete c[name]; return c; });
      setQueue(prev => {
        const next = prev.filter(q => q.name !== name);
        const maxPage = Math.max(0, Math.ceil(next.length / QUEUE_PAGE_SIZE) - 1);
        setQueuePage(p => Math.min(p, maxPage));
        return next;
      });
      fetchData();
    } catch { /* user can retry */ }
    finally { setApproveLoading(p => ({ ...p, [name]: false })); }
  }

  async function fetchEnterpriseTiers() {
    const h = await getFreshHeaders();
    if (!h) return;
    const res = await apiFetch(`${API}/enterprise-tiers`, { headers: h });
    if (res.ok) setEnterpriseTiers(await res.json());
    setTiersLoaded(true);
  }

  async function handleTierCheckout(tierId: number) {
    setTierCheckoutLoading(p => ({ ...p, [tierId]: true }));
    const h = await getFreshHeaders();
    if (!h) { setTierCheckoutLoading(p => ({ ...p, [tierId]: false })); return; }
    try {
      const res = await apiFetch(`${API}/subscription/checkout`, {
        method: "POST", headers: h,
        body: JSON.stringify({ plan_name: "enterprise", enterprise_tier_id: tierId }),
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.checkout_url;
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail ?? "Erro ao iniciar checkout.");
      }
    } catch { alert("Erro de ligação. Tente novamente."); }
    finally { setTierCheckoutLoading(p => ({ ...p, [tierId]: false })); }
  }

  async function handleSetupStripe(force = false) {
    const msg = force
      ? "Isso vai RECRIAR os preços no Stripe (arquiva os antigos, cria novos com os valores actuais). Assinaturas existentes não são afectadas. Continuar?"
      : "Isso vai criar produtos e preços no Stripe para todos os tiers Enterprise sem price ID. Continuar?";
    if (!confirm(msg)) return;
    setStripeSetupLoading(true); setStripeSetupResult(null);
    const h = await getFreshHeaders();
    if (!h) { setStripeSetupLoading(false); return; }
    try {
      const res = await apiFetch(`${API}/admin/enterprise-tiers/setup-stripe?force=${force}`, { method: "POST", headers: h });
      if (res.ok) {
        const data = await res.json();
        setStripeSetupResult(data.results);
        if (data.tiers) {
          setAdminTiers(data.tiers);
          const pm: Record<number, string> = {};
          data.tiers.forEach((t: { id: number; stripe_price_id: string | null }) => { pm[t.id] = t.stripe_price_id ?? ""; });
          setEditTierPrice(pm);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail ?? "Erro ao configurar Stripe.");
      }
    } catch { alert("Erro de ligação."); }
    finally { setStripeSetupLoading(false); }
  }

  async function handleSaveTierPrice(tierId: number) {
    setTierPriceSaving(p => ({ ...p, [tierId]: true }));
    const h = await getFreshHeaders();
    if (!h) { setTierPriceSaving(p => ({ ...p, [tierId]: false })); return; }
    const fields = editTierFields[tierId] ?? {};
    const res = await apiFetch(`${API}/admin/enterprise-tiers/${tierId}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({
        stripe_price_id:     editTierPrice[tierId] || null,
        records_per_month:   fields.records_per_month,
        api_keys_limit:      fields.api_keys_limit,
        diagnoses_per_month: fields.diagnoses_per_month,
        field_limit:         fields.field_limit,
        price_monthly:       fields.price_monthly,
      }),
    });
    if (res.ok) {
      const updated = await res.json();
      setAdminTiers(updated);
      setTierPriceSaved(p => ({ ...p, [tierId]: true }));
      setTimeout(() => setTierPriceSaved(p => ({ ...p, [tierId]: false })), 2000);
    }
    setTierPriceSaving(p => ({ ...p, [tierId]: false }));
  }

  async function handleAdminApprove(name: string) {
    setAdminApproveLoading(p => ({ ...p, [name]: true }));
    const h = await getFreshHeaders();
    if (!h) { router.push("/login"); return; }
    try {
      const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
      await apiFetch(`${API}/admin-approve/${encodeURIComponent(name)}${wsParam}`, { method: "POST", headers: h });
      setPendingApproval(prev => prev.filter(r => r.name !== name));
      fetchData();
    } catch { /* user can retry */ }
    finally { setAdminApproveLoading(p => ({ ...p, [name]: false })); }
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

    // Phase 1 — sequential AI analysis with live progress log
    const items: { name: string; email: string | null; cpf: string | null }[] = [];
    for (let i = 0; i < names.length; i++) {
      if (bulkCancelRef.current) break;
      const name = names[i];
      setBulkProgress({ current: i + 1, total: names.length });
      try {
        let diag = diagnoses[name];
        if (!diag) {
          const diagRes = await apiFetch(`${API}/analyze/${encodeURIComponent(name)}`, { headers: h });
          if (!diagRes.ok) throw new Error(`HTTP ${diagRes.status}`);
          const d = await diagRes.json();
          diag = {
            campo_afetado:      d.campo_afetado      || "—",
            valor_original:     d.valor_original     || "—",
            valor_sugerido:     d.valor_sugerido      || "",
            diagnostico_motivo: d.diagnostico_motivo  || "",
          };
          setDiagnoses(p => ({ ...p, [name]: diag }));
        }
        items.push({
          name,
          email: diag.campo_afetado === "email" ? diag.valor_sugerido || null : null,
          cpf:   diag.campo_afetado === "cpf"   ? diag.valor_sugerido || null : null,
        });
        setBulkLog(prev => prev.map(l => l.name === name
          ? { ...l, status: "analyzing", detail: `${diag.campo_afetado}: ${diag.valor_sugerido}` } : l));
      } catch (e) {
        items.push({ name, email: null, cpf: null });
        setBulkLog(prev => prev.map(l => l.name === name
          ? { ...l, status: "error", detail: e instanceof Error ? e.message : "erro" } : l));
      }
    }

    if (bulkCancelRef.current || items.length === 0) {
      setBulkStep("completed");
      setSelectedNames([]);
      return;
    }

    // Phase 2 — single POST /bulk-resolve (one HTTP round-trip, all DB ops server-side)
    try {
      const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
      const resolveRes = await apiFetch(`${API}/bulk-resolve${wsParam}`, {
        method: "POST", headers: h,
        body: JSON.stringify({ items, mode }),
      });

      if (resolveRes.ok) {
        const report = await resolveRes.json();
        // Update log from server response
        setBulkLog(prev => prev.map(l => {
          const d = (report.details as { name: string; status: string; detail?: string }[])
            .find(r => r.name === l.name);
          if (!d) return l;
          return { ...l, status: d.status as BulkLogEntry["status"], detail: d.detail };
        }));
        setBulkReport({ approved: report.approved, skipped: report.skipped, error: report.errors });
        // Optimistic: remove approved items from queue state immediately
        const approvedNames = new Set(
          (report.details as { name: string; status: string }[])
            .filter(d => d.status === "success").map(d => d.name)
        );
        setQueue(prev => {
          const next = prev.filter(q => !approvedNames.has(q.name));
          const maxPage = Math.max(0, Math.ceil(next.length / QUEUE_PAGE_SIZE) - 1);
          setQueuePage(p => Math.min(p, maxPage));
          return next;
        });
        approvedNames.forEach(name => {
          setDiagnoses(p => { const c = { ...p }; delete c[name]; return c; });
          setCorrections(p => { const c = { ...p }; delete c[name]; return c; });
        });
      } else {
        setBulkReport({ approved: 0, skipped: 0, error: items.length });
        setBulkLog(prev => prev.map(l => ({ ...l, status: "error", detail: `HTTP ${resolveRes.status}` })));
      }
    } catch (e) {
      setBulkReport({ approved: 0, skipped: 0, error: items.length });
      setBulkLog(prev => prev.map(l => ({ ...l, status: "error", detail: e instanceof Error ? e.message : "erro" })));
    }

    setBulkStep("completed");
    setSelectedNames([]);
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
        setCsvColumns(columns);
        setCsvData(results.data);
        setIngestResult(null);
        setIngestError("");
        // Build initial mapping (auto-match by field_key / label)
        const currentSchema = schema.length > 0 ? schema : [
          { field_key: "email", label: "E-mail",   field_type: "email", required: true, position: 1, validation_rules: {}, is_sensitive: false },
          { field_key: "cpf",   label: "CPF/CNPJ", field_type: "cpf",   required: true, position: 2, validation_rules: {}, is_sensitive: false },
        ];
        const mapping = autoMapColumns(columns, currentSchema);
        setColumnMapping(mapping);
        // If all required fields mapped, skip to ready; otherwise show mapper
        const schemaFields = ["name", ...currentSchema.map(f => f.field_key)];
        const allMapped = schemaFields.every(fk => Object.values(mapping).includes(fk));
        setCsvMapStep(allMapped ? "ready" : "map");
        setIsCsvValid(true);
      },
    });
  }

  const CHUNK_SIZE = 500;

  function applyColumnMapping(data: Record<string, string>[], mapping: Record<string, string>): Record<string, string>[] {
    return data.map(row => {
      const mapped: Record<string, string> = {};
      for (const [csvCol, fieldKey] of Object.entries(mapping)) {
        if (fieldKey && fieldKey !== "__ignore__") {
          mapped[fieldKey] = row[csvCol] ?? "";
        }
      }
      return mapped;
    });
  }

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
        const wsParam = activeWorkspace ? `?workspace_id=${activeWorkspace}` : "";
        const res = await fetch(`${API}/ingest${wsParam}`, {
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

  const totalClean = dbTotal ?? db.length;
  const conformidade = totalClean + queue.length > 0
    ? ((totalClean / (totalClean + queue.length)) * 100).toFixed(1) : "100.0";

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
    // Audit / Compliance Hub
    auditCardGreen:   { backgroundColor: "var(--bg-surface)", borderRadius: 14, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: "20px 24px", borderLeft: "4px solid var(--success)" },
    auditCardBlue:    { backgroundColor: "var(--bg-surface)", borderRadius: 14, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: "20px 24px", borderLeft: "4px solid var(--accent)" },
    auditCardPurple:  { backgroundColor: "var(--bg-surface)", borderRadius: 14, border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", padding: "20px 24px", borderLeft: "4px solid #a78bfa" },
    auditCardRow:     { display: "flex", justifyContent: "space-between", alignItems: "flex-start" as const, marginBottom: 12 },
    auditIconGreen:   { width: 40, height: 40, borderRadius: 12, backgroundColor: "var(--success-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", flexShrink: 0 },
    auditIconBlue:    { width: 40, height: 40, borderRadius: 12, backgroundColor: "var(--accent-subtle)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", flexShrink: 0 },
    auditIconPurple:  { width: 40, height: 40, borderRadius: 12, backgroundColor: "#ede9fe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem", flexShrink: 0 },
    auditCardTitle:   { margin: 0, fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" },
    auditCardSub:     { margin: 0, fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 1 },
    auditCardDesc:    { fontSize: "0.84rem", color: "var(--text-secondary)", lineHeight: 1.6 as unknown as string, marginBottom: 16 },
    auditBadgeRow:    { display: "flex", flexWrap: "wrap" as const, gap: 8, marginBottom: 12 },
    auditBadgeRowLast:{ display: "flex", flexWrap: "wrap" as const, gap: 8 },
    auditBadgeGreen:  { display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", backgroundColor: "var(--success-subtle)", color: "var(--success-text)", border: "1px solid var(--success)", whiteSpace: "nowrap" as const },
    auditBadgeBlue:   { display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", backgroundColor: "var(--accent-subtle)", color: "var(--accent-text)", border: "1px solid var(--accent)", whiteSpace: "nowrap" as const },
    auditBadgePurple: { display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", backgroundColor: "#ede9fe", color: "#6d28d9", border: "1px solid #a78bfa", whiteSpace: "nowrap" as const },
    auditStatusPill:  { display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 700, backgroundColor: "var(--success-subtle)", color: "var(--success-text)", border: "1px solid var(--success)" },
    auditStatusDot:   { width: 7, height: 7, borderRadius: "50%", backgroundColor: "var(--success-text)", display: "inline-block" as const },
    auditCountdown:   { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", backgroundColor: "var(--bg-surface-2)", borderRadius: 8, border: "1px solid var(--border)", marginTop: 4 },
    auditCountdownLbl:{ fontSize: "0.75rem", color: "var(--text-muted)" },
    auditCountdownVal:{ fontFamily: "var(--font-geist-mono)", fontSize: "0.82rem", fontWeight: 700, color: "var(--text-primary)" },
    // Loading screen
    loadingWrap:      { textAlign: "center" as const, padding: "80px 24px" },
    loadingSteps:     { display: "flex", justifyContent: "center", alignItems: "center", gap: 0, marginBottom: 32 },
    loadingStepCol:   { display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 6 },
    loadingConnector: { width: 48, height: 2, margin: "0 4px 22px", transition: "background-color 0.6s" },
    loadingBarWrap:   { width: "100%", maxWidth: 320, margin: "0 auto 16px", backgroundColor: "var(--border)", borderRadius: 99, height: 6, overflow: "hidden" },
    loadingBar:       { height: "100%", borderRadius: 99, backgroundColor: "var(--accent)", transition: "width 1s ease-out" },
    loadingMsg:       { color: "var(--text-secondary)", fontSize: "0.88rem", fontWeight: 500 },
    loadingHint:      { color: "var(--text-muted)", fontSize: "0.75rem", marginTop: 4 },
    loadingTimer:     { color: "var(--text-muted)", fontSize: "0.72rem", marginTop: 8, fontVariantNumeric: "tabular-nums" as const },
  };

  if (trialExpired) {
    return (
      <div style={{ ...s.page, display: "flex", flexDirection: "column" }}>
        {/* Header still visible */}
        <header style={{ ...s.header, padding: "0 24px" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
            <div>
              <div style={s.logo}>Trust & Tandem AI</div>
              <div style={s.logoSub}>{t.dashboard.subtitle}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={s.userName}>{userName}</span>
              <button onClick={handleLogout} style={s.logoutBtn}>{t.dashboard.logout}</button>
            </div>
          </div>
        </header>
        {/* Trial expired gate */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
          <div style={{ ...s.card, maxWidth: 480, width: "100%", textAlign: "center", padding: "48px 40px" }}>
            <div style={{ fontSize: "3rem", marginBottom: 16 }}>🔒</div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
              Trial de 15 dias expirado
            </h2>
            <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", marginBottom: 28, lineHeight: 1.6 }}>
              Seu período de teste gratuito chegou ao fim. Assine um plano para continuar acessando o Trust & Tandem AI.
            </p>
            <button
              onClick={async () => {
                setTrialExpired(false);
                setTab("subscription");
                await fetchSubscription();
              }}
              style={{ ...s.ingestBtn, width: "100%", padding: "14px 24px", fontSize: "0.95rem" }}
            >
              Ver Planos e Assinar
            </button>
          </div>
        </div>
        {/* Subscription tab content is rendered below in invisible mode so fetchSubscription works */}
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={{ ...s.header, padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div>
              <div style={s.logo}>Trust & Tandem AI</div>
              <div style={s.logoSub}>{t.dashboard.subtitle}</div>
            </div>
            {workspacesLoaded && (
              <select
                value={activeWorkspace ?? ""}
                onChange={e => {
                  const val = e.target.value;
                  const wsId = val === "" ? null : Number(val);
                  setActiveWorkspace(wsId);
                  if (wsId) fetchWorkspaceMembers(wsId);
                }}
                style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", backgroundColor: "var(--bg-surface-2)", color: "var(--text-primary)", fontSize: "0.84rem", fontWeight: 600, cursor: "pointer" }}>
                <option value="">Principal</option>
                {workspaces.map(ws => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <LangSelector />
            <button onClick={toggleTheme} style={s.themeBtn}>
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
              {theme === "light" ? "Dark" : "Light"}
            </button>
            <span style={s.userName}>{userName}</span>
            {userRole !== "admin" && (
              <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 10px", borderRadius: 12,
                backgroundColor: userRole === "operator" ? "var(--accent-subtle)" : "var(--bg-surface-2)",
                color: userRole === "operator" ? "var(--accent)" : "var(--text-muted)",
                border: "1px solid var(--border)", letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
                {userRole}
              </span>
            )}
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
            <button onClick={() => { setTab("ingest"); if (!schemaLoaded) fetchSchema(); }} style={tab === "ingest" ? s.tabActive : s.tabInactive}>
              {t.ingest.tab}
            </button>
            {userRole === "admin" && (
              <button onClick={() => { setTab("settings"); if (!settingsLoaded) fetchSettings(); }} style={tab === "settings" ? s.tabActive : s.tabInactive}>
                {t.settings.tab}
              </button>
            )}
            {userRole === "admin" && (
              <button onClick={() => { setTab("schema"); if (!workspacesLoaded) fetchWorkspaces(); if (!schemaLoaded) fetchSchema(); }} style={tab === "schema" ? s.tabActive : s.tabInactive}>
                {t.schema.tab}
              </button>
            )}
            <button onClick={() => { setTab("audit"); if (!auditLogsLoaded) fetchAuditLogs(); }} style={tab === "audit" ? s.tabActive : s.tabInactive}>
              {t.audit.tab}
            </button>
            {userRole === "admin" && (
              <button onClick={() => setTab("subscription")} style={tab === "subscription" ? s.tabActive : s.tabInactive}>
                {t.subscription.tab}
              </button>
            )}
            {userRole === "admin" && (
              <button onClick={() => { setTab("users"); fetchWorkspaces(); }} style={tab === "users" ? s.tabActive : s.tabInactive}>
                👥 Utilizadores
              </button>
            )}
            {isSuperAdmin && (
              <button onClick={() => { setTab("admin" as never); if (!adminLoaded) fetchAdminData(); }} style={(tab as string) === "admin" ? s.tabActive : s.tabInactive}>
                {t.admin.tab}
              </button>
            )}
        </div>
      </div>

      {/* Content */}
      <main style={s.main}>
        {loading ? (
          <div style={s.loadingWrap}>
            {/* Step indicators */}
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 0, marginBottom: 32 }}>
              {[
                { label: t.dashboard.stepConnect, threshold: 0 },
                { label: t.dashboard.stepWarm,    threshold: 3 },
                { label: t.dashboard.stepLoad,    threshold: 14 },
              ].map((step, i) => {
                const active  = elapsed >= step.threshold;
                const current = i === (elapsed < 3 ? 0 : elapsed < 14 ? 1 : 2);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        backgroundColor: active ? "var(--accent)" : "var(--border)",
                        border: current ? "2px solid var(--accent)" : "2px solid transparent",
                        boxShadow: current ? "0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent)" : "none",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 0.4s",
                        fontSize: 12, color: active ? "#fff" : "var(--text-muted)",
                        fontWeight: 700,
                      }}>
                        {active && !current ? "✓" : i + 1}
                      </div>
                      <span style={{ fontSize: "0.72rem", color: active ? "var(--text-primary)" : "var(--text-muted)", fontWeight: current ? 600 : 400, whiteSpace: "nowrap" as const }}>
                        {step.label}
                      </span>
                    </div>
                    {i < 2 && (
                      <div style={{ width: 48, height: 2, backgroundColor: elapsed > step.threshold ? "var(--accent)" : "var(--border)", margin: "0 4px 22px", transition: "background-color 0.6s" }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div style={{ width: "100%", maxWidth: 320, margin: "0 auto 16px", backgroundColor: "var(--border)", borderRadius: 99, height: 6, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 99,
                backgroundColor: "var(--accent)",
                width: `${Math.min(95, elapsed < 3 ? elapsed * 10 : elapsed < 14 ? 30 + (elapsed - 3) * 5 : 85 + (elapsed - 14) * 2)}%`,
                transition: "width 1s ease-out",
              }} />
            </div>

            {/* Message + timer */}
            <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", fontWeight: 500 }}>
              {elapsed < 3 ? t.dashboard.loading : elapsed < 14 ? t.dashboard.warmingUp : t.dashboard.loading}
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: 4 }}>
              {elapsed >= 3 ? t.dashboard.coldStart : " "}
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
              {elapsed}s
            </p>
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
                { label: t.dashboard.metricTotal,      value: totalClean + queue.length, accent: false },
                { label: t.dashboard.metricCompliance, value: `${conformidade}%`,         accent: true  },
                { label: t.dashboard.metricSecure,     value: totalClean,                accent: false },
              ].map(({ label, value, accent }) => (
                <div key={label} style={{ ...s.card, borderTop: accent ? "3px solid var(--accent)" : "3px solid var(--border)" }}>
                  <div style={s.metricLabel}>{label}</div>
                  <div style={{ ...s.metricValue, color: accent ? "var(--accent)" : "var(--text-primary)" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Tabela */}
            <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ ...s.sectionTitle, margin: 0 }}>{t.dashboard.tableTitle}</p>
                {db.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {exportProgress ? (
                      <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        Baixando parte {exportProgress.part}...
                      </span>
                    ) : (
                      <select
                        title="Linhas por arquivo"
                        value={exportRowsPerFile}
                        onChange={e => setExportRowsPerFile(Number(e.target.value))}
                        style={{ fontSize: "0.75rem", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", background: "var(--bg-surface-2)", color: "var(--text-secondary)", cursor: "pointer" }}
                      >
                        <option value={1000}>1 000 / arquivo</option>
                        <option value={5000}>5 000 / arquivo</option>
                        <option value={10000}>10 000 / arquivo</option>
                        <option value={50000}>50 000 / arquivo</option>
                      </select>
                    )}
                    <button
                      onClick={handleExportCSV}
                      disabled={!!exportProgress}
                      style={{ padding: "6px 14px", fontSize: "0.8rem", fontWeight: 600, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: 8, cursor: exportProgress ? "not-allowed" : "pointer", opacity: exportProgress ? 0.6 : 1 }}
                    >
                      ↓ {t.dashboard.exportCsv}
                    </button>
                  </div>
                )}
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
                  {(() => {
                    const pageNames = queue.slice(queuePage * QUEUE_PAGE_SIZE, (queuePage + 1) * QUEUE_PAGE_SIZE).map(r => r.name);
                    const allPageSelected = pageNames.length > 0 && pageNames.every(n => selectedNames.includes(n));
                    return (
                      <>
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={e => setSelectedNames(e.target.checked
                            ? [...new Set([...selectedNames, ...pageNames])]
                            : selectedNames.filter(n => !pageNames.includes(n))
                          )}
                          style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)" }}
                        />
                        {allPageSelected
                          ? `${t.bulk.deselectAll} (${pageNames.length})`
                          : `${t.bulk.selectAll} (${pageNames.length})`}
                      </>
                    );
                  })()}
                </label>
                {selectedNames.length > 0 && (
                  <span style={{ fontSize: "0.78rem", color: "var(--accent)", fontWeight: 700 }}>
                    {selectedNames.length} {t.bulk.toolbarSelected}
                  </span>
                )}
              </div>

              {/* Pagination info */}
              {queue.length > QUEUE_PAGE_SIZE && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 2px" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    Página {queuePage + 1} de {Math.ceil(queue.length / QUEUE_PAGE_SIZE)} — {queue.length} registros na fila
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setQueuePage(p => Math.max(0, p - 1))}
                      disabled={queuePage === 0}
                      style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: queuePage === 0 ? "not-allowed" : "pointer", opacity: queuePage === 0 ? 0.4 : 1, fontSize: "0.8rem" }}
                    >← Anterior</button>
                    <button
                      onClick={() => setQueuePage(p => Math.min(Math.ceil(queue.length / QUEUE_PAGE_SIZE) - 1, p + 1))}
                      disabled={queuePage >= Math.ceil(queue.length / QUEUE_PAGE_SIZE) - 1}
                      style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: queuePage >= Math.ceil(queue.length / QUEUE_PAGE_SIZE) - 1 ? "not-allowed" : "pointer", opacity: queuePage >= Math.ceil(queue.length / QUEUE_PAGE_SIZE) - 1 ? 0.4 : 1, fontSize: "0.8rem" }}>Próxima →</button>
                  </div>
                </div>
              )}

              {queue.slice(queuePage * QUEUE_PAGE_SIZE, (queuePage + 1) * QUEUE_PAGE_SIZE).map((item, i) => (
              <div key={item.name} style={{ ...s.alertCard, outline: selectedNames.includes(item.name) ? "2px solid var(--accent)" : "2px solid transparent", transition: "outline 0.15s" }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: item.legal_basis ? 8 : 12 }}>
                  <div style={s.hintBox}>
                    <div style={s.hintLabel}>{t.dashboard.emailHint}</div>
                    <div style={s.hintValue}>{item.email_hint}</div>
                  </div>
                  <div style={s.hintBox}>
                    <div style={s.hintLabel}>{t.dashboard.cpfHint}</div>
                    <div style={s.hintValue}>{item.cpf_hint}</div>
                  </div>
                </div>
                {item.legal_basis && (
                  <div style={{ marginBottom: 12, padding: "6px 10px", backgroundColor: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Base Legal (LGPD)</span>
                    <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--accent)" }}>{item.legal_basis}</span>
                  </div>
                )}
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

            {/* ── FOUR-EYES: admin sees operator pre-approved items ── */}
            {userRole === "admin" && pendingApproval.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                    backgroundColor: "var(--warning-subtle, #fff7e6)", color: "var(--warning, #b45309)",
                    border: "1px solid var(--warning, #b45309)", letterSpacing: "0.04em" }}>
                    APROVAÇÃO FINAL
                  </span>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    Aguardando carimbo do admin ({pendingApproval.length})
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {pendingApproval.map(item => (
                    <div key={item.name} style={{ ...s.alertCard, borderColor: "var(--warning, #b45309)", borderWidth: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <p style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: "0.92rem", marginBottom: 4 }}>
                            {item.name}
                          </p>
                          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {item.email_hint} · {item.cpf_hint}
                            {item.operator_approved_by && (
                              <span style={{ marginLeft: 8, color: "var(--accent)", fontWeight: 600 }}>
                                pré-aprovado por {item.operator_approved_by}
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAdminApprove(item.name)}
                          disabled={adminApproveLoading[item.name]}
                          style={{ ...s.ingestBtn, fontSize: "0.8rem", padding: "8px 16px", width: "auto",
                            opacity: adminApproveLoading[item.name] ? 0.6 : 1 }}
                        >
                          {adminApproveLoading[item.name] ? "Aprovando..." : "✓ Aprovar definitivamente"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
                    {/* CSV column mapper */}
                    {csvMapStep === "map" && (
                      <div style={{ marginBottom: 16, padding: "16px", backgroundColor: "var(--bg-surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                        <p style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)", marginBottom: 4 }}>{t.schema.csvMapTitle}</p>
                        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 12 }}>{t.schema.csvMapSubtitle}</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {csvColumns.map(col => (
                            <div key={col} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ flex: 1, fontFamily: "var(--font-geist-mono)", fontSize: "0.78rem", color: "var(--text-secondary)", padding: "6px 10px", backgroundColor: "var(--bg-surface)", borderRadius: 6, border: "1px solid var(--border)" }}>{col}</span>
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>→</span>
                              <select
                                style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: "0.82rem", color: "var(--text-primary)", backgroundColor: "var(--bg-surface-2)", outline: "none" }}
                                value={columnMapping[col] ?? "__ignore__"}
                                onChange={e => setColumnMapping(p => ({ ...p, [col]: e.target.value }))}
                              >
                                <option value="__ignore__">{t.schema.ignore}</option>
                                <option value="name">{t.ingest.fieldName}</option>
                                {(schema.length > 0 ? schema : [
                                  { field_key: "email", label: "E-mail" },
                                  { field_key: "cpf",   label: "CPF/CNPJ" },
                                ]).map(f => (
                                  <option key={f.field_key} value={f.field_key}>{f.label}</option>
                                ))}
                              </select>
                              {columnMapping[col] && columnMapping[col] !== "__ignore__" &&
                                Object.keys(autoMapColumns([col], schema.length > 0 ? schema : [])).length > 0 &&
                                autoMapColumns([col], schema.length > 0 ? schema : [])[col] === columnMapping[col] && (
                                <span style={{ fontSize: "0.65rem", color: "var(--success-text)", backgroundColor: "var(--success-subtle)", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>{t.schema.autoMapped}</span>
                              )}
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => setCsvMapStep("ready")}
                          style={{ ...s.ingestBtn, marginTop: 14, fontSize: "0.82rem" }}
                        >
                          {t.schema.confirmMap}
                        </button>
                      </div>
                    )}
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
                    ) : csvMapStep !== "map" ? (
                      <button
                        disabled={!isCsvValid || ingestLoading}
                        onClick={() => submitIngestion(
                          Object.values(columnMapping).some(v => v && v !== "__ignore__")
                            ? applyColumnMapping(csvData, columnMapping)
                            : csvData
                        )}
                        style={{ ...s.ingestBtn, opacity: !isCsvValid || ingestLoading ? 0.6 : 1 }}
                      >
                        {t.ingest.process}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : (
              <div style={s.card}>
                <form onSubmit={e => { e.preventDefault(); submitIngestion([formRecord]); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* scrollable fields area */}
                  <div style={{ maxHeight: "420px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
                    {/* name is always first */}
                    <div>
                      <label style={s.ingestLabel}>{t.ingest.fieldName}</label>
                      <input required type="text" style={s.ingestInput} value={formRecord.name ?? ""} onChange={e => setFormRecord(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    {/* dynamic schema fields */}
                    {(schema.length > 0 ? schema : [
                      { field_key: "email", label: t.ingest.fieldEmail, field_type: "email", required: true, position: 1, validation_rules: {} },
                      { field_key: "cpf",   label: t.ingest.fieldCpf,   field_type: "cpf",   required: true, position: 2, validation_rules: {} },
                    ]).map(f => (
                      <div key={f.field_key}>
                        <label style={s.ingestLabel}>{f.label}{f.required ? "" : " (opcional)"}</label>
                        <input
                          type={f.field_type === "email" ? "email" : f.field_type === "number" ? "number" : "text"}
                          style={s.ingestInput}
                          required={f.required}
                          value={formRecord[f.field_key] ?? ""}
                          placeholder={f.field_type === "cpf" ? "000.000.000-00 ou 00.000.000/0000-00" : ""}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => {
                            const val = f.field_type === "cpf" ? formatCpfCnpj(e.target.value) : e.target.value;
                            setFormRecord(p => ({ ...p, [f.field_key]: val }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  {/* submit always visible below scroll */}
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
        ) : tab === "schema" ? (
          /* ── SCHEMA EDITOR ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Phase 2: Workspace selector for schema */}
            {workspacesLoaded && workspaces.length > 0 && (
              <div style={{ ...s.card, display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
                <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>Workspace:</label>
                <select
                  value={activeWorkspace ?? ""}
                  onChange={e => {
                    const wsId = Number(e.target.value);
                    setActiveWorkspace(wsId);
                    setSchema([]);
                    setSchemaLoaded(false);
                  }}
                  style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", backgroundColor: "var(--bg-surface-2)", color: "var(--text-primary)", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", flex: 1 }}>
                  {workspaces.map(ws => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
                </select>
              </div>
            )}
            <div style={s.settingsCard}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
                <p style={{ ...s.settingsTitle, marginBottom: 0 }}>{t.schema.title}</p>
                {planInfo && (
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: planInfo.field_count >= planInfo.field_limit ? "var(--error-text, #b91c1c)" : "var(--text-muted)", backgroundColor: planInfo.field_count >= planInfo.field_limit ? "var(--error-subtle, #fee2e2)" : "var(--bg-surface-2)", padding: "3px 10px", borderRadius: 20, border: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                    {planInfo.field_count} / {planInfo.field_limit} {t.schema.customFields} · {planInfo.plan.charAt(0).toUpperCase() + planInfo.plan.slice(1)}
                  </span>
                )}
              </div>
              <p style={s.settingsDesc}>{t.schema.subtitle}</p>

              {/* Plan limit warning */}
              {planInfo && planInfo.field_count >= planInfo.field_limit && (
                <div style={{ backgroundColor: "var(--error-subtle, #fee2e2)", border: "1px solid var(--error, #ef4444)", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "var(--error-text, #b91c1c)", marginBottom: 14 }}>
                  {t.schema.limitReached}
                </div>
              )}

              {/* Built-in name field */}
              <div style={{ marginBottom: 12 }}>
                <div style={s.keyRow}>
                  <div>
                    <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>name</p>
                    <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>text · {t.schema.required} · {t.schema.position}: 0</p>
                  </div>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text-muted)", backgroundColor: "var(--bg-surface-2)", padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)" }}>built-in</span>
                </div>
              </div>

              {/* Configured fields */}
              {schema.length === 0 && (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>{t.schema.defaultNotice}</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {schema.map(f => (
                  <div key={f.field_key} style={s.keyRow}>
                    <div>
                      <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                        {f.field_key} <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>— {f.label}</span>
                        {f.is_sensitive && <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 600, color: "#b91c1c", background: "#fee2e2", borderRadius: 4, padding: "1px 6px" }}>🔒 Sensível</span>}
                      </p>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{f.field_type} · {f.required ? t.schema.required : "opcional"} · {t.schema.position}: {f.position}</p>
                    </div>
                    <button onClick={() => handleDeleteField(f.field_key)} style={s.revokeBtn}>{t.schema.deleteField}</button>
                  </div>
                ))}
              </div>

              {/* Add field form */}
              <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>{t.schema.addField}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={s.ingestLabel}>{t.schema.fieldKey}</label>
                    <input type="text" placeholder={t.schema.fieldKeyPlaceholder} style={s.ingestInput}
                      value={newField.field_key}
                      onChange={e => setNewField(p => ({ ...p, field_key: e.target.value.toLowerCase().replace(/\s+/g, "_") }))} />
                    <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 3 }}>{t.schema.fieldKeyHint}</p>
                  </div>
                  <div>
                    <label style={s.ingestLabel}>{t.schema.fieldLabel}</label>
                    <input type="text" placeholder={t.schema.fieldLabelPlaceholder} style={s.ingestInput}
                      value={newField.label}
                      onChange={e => setNewField(p => ({ ...p, label: e.target.value }))} />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={s.ingestLabel}>{t.schema.fieldType}</label>
                    <select title={t.schema.fieldType} style={{ ...s.ingestInput, cursor: "pointer" }}
                      value={newField.field_type}
                      onChange={e => setNewField(p => ({ ...p, field_type: e.target.value }))}>
                      {Object.entries(t.schema.fieldTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={s.ingestLabel}>{t.schema.position}</label>
                    <input type="number" title={t.schema.position} placeholder="0" style={s.ingestInput} min={0} value={newField.position}
                      onChange={e => setNewField(p => ({ ...p, position: Number(e.target.value) }))} />
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                      <input type="checkbox" checked={newField.required} style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
                        onChange={e => setNewField(p => ({ ...p, required: e.target.checked }))} />
                      {t.schema.required}
                    </label>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.82rem", color: newField.is_sensitive ? "#b91c1c" : "var(--text-secondary)" }}>
                    <input type="checkbox" checked={newField.is_sensitive} style={{ accentColor: "#b91c1c", width: 16, height: 16 }}
                      onChange={e => setNewField(p => ({ ...p, is_sensitive: e.target.checked }))} />
                    🔒 Dado Sensível (LGPD Art. 11) — valor não será enviado à IA
                  </label>
                </div>
                {addFieldError && (
                  <p style={{ fontSize: "0.78rem", color: "var(--error-text, #b91c1c)", margin: "4px 0 0" }}>{addFieldError}</p>
                )}
                <button onClick={handleAddField}
                  disabled={schemaLoading || !newField.field_key || !newField.label || !!(planInfo && planInfo.field_count >= planInfo.field_limit)}
                  style={{ ...s.ingestBtn, opacity: schemaLoading || !newField.field_key || !newField.label || !!(planInfo && planInfo.field_count >= planInfo.field_limit) ? 0.6 : 1 }}>
                  {schemaLoading ? t.schema.saving : t.schema.addField}
                </button>
              </div>
            </div>
          </div>
        ) : tab === "audit" ? (
          /* ── COMPLIANCE HUB ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ marginBottom: 16 }}>
              <h1 style={s.auditCardTitle}>{t.audit.title}</h1>
              <p style={s.auditCardSub}>{t.audit.subtitle}</p>
            </div>

            {/* Card 1 — Data Retention */}
            <div style={s.auditCardGreen}>
              <div style={s.auditCardRow}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={s.auditIconGreen}>🕒</div>
                  <div>
                    <p style={s.auditCardTitle}>{t.audit.retentionTitle}</p>
                    <p style={s.auditCardSub}>{t.audit.retentionSubtitle}</p>
                  </div>
                </div>
                <span style={s.auditStatusPill}><span style={s.auditStatusDot} />{t.audit.statusActive}</span>
              </div>
              <p style={s.auditCardDesc}>{t.audit.retentionDesc}</p>
              <div style={s.auditBadgeRow}>
                <span style={s.auditBadgeGreen}>{t.audit.retentionBadge1}</span>
                <span style={s.auditBadgeGreen}>{t.audit.retentionBadge2}</span>
                <span style={s.auditBadgeGreen}>{t.audit.retentionBadge3}</span>
              </div>
              <div style={s.auditCountdown}>
                <span style={s.auditCountdownLbl}>{t.audit.retentionNext}:</span>
                <span style={s.auditCountdownVal}>{(() => {
                  const now = new Date(); const next = new Date();
                  next.setUTCHours(3, 0, 0, 0);
                  if (now >= next) next.setUTCDate(next.getUTCDate() + 1);
                  const ms = next.getTime() - now.getTime();
                  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
                })()}</span>
              </div>
            </div>

            {/* Card 2 — Rate Limiting */}
            <div style={s.auditCardBlue}>
              <div style={s.auditCardRow}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={s.auditIconBlue}>🛡️</div>
                  <div>
                    <p style={s.auditCardTitle}>{t.audit.rateLimitTitle}</p>
                    <p style={s.auditCardSub}>{t.audit.rateLimitSubtitle}</p>
                  </div>
                </div>
                <span style={s.auditStatusPill}><span style={s.auditStatusDot} />{t.audit.rateLimitStatus}</span>
              </div>
              <p style={s.auditCardDesc}>{t.audit.rateLimitDesc}</p>
              <div style={s.auditBadgeRowLast}>
                <span style={s.auditBadgeBlue}>{t.audit.rateLimitBadge1}</span>
                <span style={s.auditBadgeBlue}>{t.audit.rateLimitBadge2}</span>
                <span style={s.auditBadgeBlue}>{t.audit.rateLimitBadge3}</span>
              </div>
            </div>

            {/* Card 3 — API Key Security */}
            <div style={s.auditCardPurple}>
              <div style={s.auditCardRow}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={s.auditIconPurple}>🔑</div>
                  <div>
                    <p style={s.auditCardTitle}>{t.audit.cryptoTitle}</p>
                    <p style={s.auditCardSub}>{t.audit.cryptoSubtitle}</p>
                  </div>
                </div>
                <span style={s.auditStatusPill}><span style={s.auditStatusDot} />{t.audit.statusActive}</span>
              </div>
              <p style={s.auditCardDesc}>{t.audit.cryptoDesc}</p>
              <div style={s.auditBadgeRowLast}>
                <span style={s.auditBadgePurple}>{t.audit.cryptoBadge1}</span>
                <span style={s.auditBadgePurple}>{t.audit.cryptoBadge2}</span>
                <span style={s.auditBadgePurple}>{t.audit.cryptoBadge3}</span>
              </div>
            </div>

            {/* Card 4 — Audit Log */}
            <div style={{ ...s.auditCardBlue, marginTop: 8 }}>
              <div style={s.auditCardRow}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={s.auditIconBlue}>📋</div>
                  <div>
                    <p style={s.auditCardTitle}>Log de Auditoria</p>
                    <p style={s.auditCardSub}>Histórico de aprovações e expurgos — LGPD Art. 37</p>
                  </div>
                </div>
                <button onClick={fetchAuditLogs} style={{ fontSize: "0.72rem", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer" }}>
                  Atualizar
                </button>
              </div>
              {!auditLogsLoaded ? (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 12 }}>Carregando...</p>
              ) : auditLogs.length === 0 ? (
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 12 }}>Nenhuma ação registrada ainda.</p>
              ) : (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  {auditLogs.map(log => {
                    const fields = typeof log.fields_affected === "string" ? (() => { try { return JSON.parse(log.fields_affected as string); } catch { return {}; } })() : (log.fields_affected ?? {});
                    const legalBasis = (fields as Record<string, unknown>).legal_basis as string | undefined;
                    return (
                      <div key={log.id} style={{ padding: "8px 12px", backgroundColor: "var(--bg-surface)", borderRadius: 8, border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: log.action.startsWith("APPROVE") ? "#dcfce7" : "#fee2e2", color: log.action.startsWith("APPROVE") ? "#15803d" : "#b91c1c" }}>
                              {log.action}
                            </span>
                            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>{log.record_name}</span>
                          </div>
                          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{new Date(log.created_at).toLocaleString("pt-BR")}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{log.operator_email}</span>
                          {legalBasis && (
                            <span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "var(--bg-base)", border: "1px solid var(--border)", color: "var(--accent)" }}>
                              Base legal: {legalBasis}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : tab === "subscription" ? (
          /* ── PLANO / SUBSCRIPTION ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Success / canceled banners */}
            {subBanner === "success" && (
              <div style={{ padding: "14px 18px", backgroundColor: "var(--success-subtle)", border: "1px solid var(--success)", borderRadius: 10, color: "var(--success-text)", fontSize: "0.86rem", fontWeight: 600 }}>
                {t.subscription.successBanner}
              </div>
            )}
            {subBanner === "canceled" && (
              <div style={{ padding: "14px 18px", backgroundColor: "var(--warning-subtle, #fef9ec)", border: "1px solid var(--warning, #f59e0b)", borderRadius: 10, color: "var(--warning-text, #92400e)", fontSize: "0.86rem", fontWeight: 600 }}>
                {t.subscription.canceledBanner}
              </div>
            )}

            {/* Plan comparison table with inline actions */}
            <div style={s.settingsCard}>
              <p style={s.settingsTitle}>{t.subscription.compareTitle}</p>
              {!subscription ? (
                <p style={{ color: "var(--text-muted)", fontSize: "0.84rem" }}>A carregar...</p>
              ) : (() => {
                const pl = (name: string) => publicPlans.find(p => p.plan_name === name);
                const fmtRec  = (n?: number) => !n || n === 0 ? "Ilimitado" : n.toLocaleString("pt-BR");
                const fmtKeys = (n?: number) => !n || n >= 999 ? "Ilimitado" : String(n);
                const fmtDiag = (n?: number) => !n || n === 0 ? "Ilimitado" : String(n);

                const PLAN_ORDER: Record<string, number> = { starter: 0, pro: 1, professional: 2, enterprise: 3 };
                const PLAN_LABELS: Record<string, string> = { starter: "Trial", pro: "Business", professional: "Professional", enterprise: "Enterprise" };
                const names = ["starter", "pro", "professional", "enterprise"];

                const currentPlanName = subscription.status === "active" ? (subscription.plan ?? "starter") : "starter";
                const currentIdx = PLAN_ORDER[currentPlanName] ?? 0;

                const fmtPrice = (name: string) => {
                  if (name === "starter")    return { main: "Grátis", sub: "15 dias" };
                  if (name === "enterprise") return { main: "Sob consulta", sub: "" };
                  const v = pl(name)?.price_monthly;
                  return { main: `R$${(v ?? 0).toLocaleString("pt-BR")}`, sub: "/mês" };
                };

                const renderBtn = (name: string, idx: number) => {
                  const isCurrent = name === currentPlanName;
                  if (name === "enterprise") {
                    if (subscription.enterprise_config) {
                      return (
                        <button onClick={() => handleCheckout("enterprise")} disabled={subLoading}
                          style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, backgroundColor: "#1e293b", color: "#fff", opacity: subLoading ? 0.6 : 1 }}>
                          {isCurrent ? t.subscription.manageSubscription : `Fazer Upgrade`}
                        </button>
                      );
                    }
                    return (
                      <button onClick={() => { setShowTierModal(true); if (!tiersLoaded) fetchEnterpriseTiers(); }}
                        style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, backgroundColor: "#1e293b", color: "#fff" }}>
                        Customizar Plano →
                      </button>
                    );
                  }
                  if (isCurrent) {
                    if (subscription.status === "active") {
                      return (
                        <button onClick={handlePortal} disabled={subLoading}
                          style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "2px solid var(--accent)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, backgroundColor: "transparent", color: "var(--accent)", opacity: subLoading ? 0.6 : 1 }}>
                          {subLoading ? "..." : t.subscription.manageSubscription}
                        </button>
                      );
                    }
                    if (subscription.status === "trialing") {
                      return (
                        <div style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "2px solid #f59e0b", fontSize: "0.75rem", fontWeight: 700, color: "#92400e", backgroundColor: "#fef9ec", textAlign: "center" as const }}>
                          {t.subscription.trialActive} · {subscription.trial_days_left ?? 0}d
                        </div>
                      );
                    }
                    return (
                      <div style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", backgroundColor: "var(--bg-surface-2)", textAlign: "center" as const }}>
                        Plano atual
                      </div>
                    );
                  }
                  if (idx > currentIdx) {
                    const price = pl(name)?.price_monthly;
                    return (
                      <button onClick={() => handleCheckout(name)} disabled={subLoading}
                        style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, backgroundColor: "var(--accent)", color: "#fff", opacity: subLoading ? 0.6 : 1 }}>
                        {subLoading ? "..." : `Fazer Upgrade · R$${(price ?? 0).toLocaleString("pt-BR")}/mês`}
                      </button>
                    );
                  }
                  return (
                    <button onClick={handlePortal} disabled={subLoading}
                      style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, backgroundColor: "transparent", color: "var(--text-muted)", opacity: subLoading ? 0.6 : 1 }}>
                      {subLoading ? "..." : "Fazer Downgrade"}
                    </button>
                  );
                };

                const rows: { label: string; vals: string[] }[] = [
                  { label: "Registros/mês",            vals: [fmtRec(pl("starter")?.records_per_month ?? 10000), fmtRec(pl("pro")?.records_per_month ?? 50000), fmtRec(pl("professional")?.records_per_month ?? 200000), "Personalizado"] },
                  { label: "API Keys",                 vals: [fmtKeys(pl("starter")?.api_keys_limit ?? 1), fmtKeys(pl("pro")?.api_keys_limit ?? 5), fmtKeys(pl("professional")?.api_keys_limit ?? 20), "Personalizado"] },
                  { label: "Diagnósticos/mês",         vals: [fmtDiag(pl("starter")?.diagnoses_per_month ?? 50), "Ilimitado", "Ilimitado", "Personalizado"] },
                  { label: t.subscription.fieldLimit,  vals: [String(pl("starter")?.field_limit ?? 5), String(pl("pro")?.field_limit ?? 15), String(pl("professional")?.field_limit ?? 20), "Personalizado"] },
                  { label: t.subscription.feat_lgpd,   vals: ["✓", "✓", "✓", "✓"] },
                  { label: t.subscription.feat_fields, vals: ["✓", "✓", "✓", "✓"] },
                  { label: t.subscription.feat_webhook,vals: ["—", "✓", "✓", "✓"] },
                  { label: t.subscription.feat_bulk,   vals: ["—", "✓", "✓", "✓"] },
                  { label: t.subscription.feat_support,vals: ["—", "—", "✓", "✓"] },
                ];

                return (
                  <div style={{ overflowX: "auto" as const }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: "0.83rem" }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "8px 14px", textAlign: "left" as const, borderBottom: "2px solid var(--border)", width: "28%" }} />
                          {names.map((name, idx) => {
                            const isCurrent = name === currentPlanName;
                            const { main, sub } = fmtPrice(name);
                            return (
                              <th key={name} style={{
                                padding: "14px 12px 10px", textAlign: "center" as const,
                                borderBottom: `2px solid ${isCurrent ? "var(--accent)" : "var(--border)"}`,
                                backgroundColor: isCurrent ? "var(--accent-subtle)" : "var(--bg-surface-2)",
                                minWidth: 130,
                              }}>
                                <div style={{ display: "flex", flexDirection: "column" as const, gap: 4, alignItems: "center" }}>
                                  {isCurrent && (
                                    <span style={{ fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.06em", color: "var(--accent)", textTransform: "uppercase" as const }}>
                                      ● PLANO ATUAL
                                    </span>
                                  )}
                                  <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text-primary)" }}>{PLAN_LABELS[name]}</span>
                                  <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                                    <span style={{ fontWeight: 700, fontSize: "1rem", color: isCurrent ? "var(--accent)" : "var(--text-primary)" }}>{main}</span>
                                    {sub && <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{sub}</span>}
                                  </div>
                                  <div style={{ width: "100%", marginTop: 6 }}>{renderBtn(name, idx)}</div>
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "transparent" : "var(--bg-surface-2)" }}>
                            <td style={{ padding: "9px 14px", color: "var(--text-primary)", fontWeight: 500, whiteSpace: "nowrap" as const }}>{row.label}</td>
                            {row.vals.map((v, j) => {
                              const isCurrent = names[j] === currentPlanName;
                              return (
                                <td key={j} style={{ padding: "9px 12px", textAlign: "center" as const,
                                  backgroundColor: isCurrent ? "var(--accent-subtle)" : "transparent",
                                  color: v === "—" ? "var(--text-muted)" : v === "✓" ? "var(--success-text)" : isCurrent ? "var(--accent)" : "var(--text-primary)",
                                  fontWeight: v === "✓" || isCurrent ? 600 : 400 }}>
                                  {v}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>

        ) : tab === "users" ? (
          /* ── UTILIZADORES ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={s.card}>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
                Membros — {activeWorkspace ? (workspaces.find(w => w.id === activeWorkspace)?.name ?? "Workspace") : "Principal"}
              </h2>

              {/* Convidar — só para workspace específico */}
              {activeWorkspace && (
                <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid var(--border)" }}>
                  <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Convidar novo membro</p>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <label style={s.ingestLabel}>E-mail</label>
                      <input type="email" style={s.ingestInput} placeholder="utilizador@empresa.com"
                        value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                    </div>
                    <div>
                      <label style={s.ingestLabel} htmlFor="invite-role">Role</label>
                      <select id="invite-role" style={{ ...s.ingestInput, padding: "10px 14px" }}
                        value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                        <option value="admin">Admin</option>
                        <option value="operator">Operator</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                    <button onClick={() => handleInviteWorkspaceMember(activeWorkspace)}
                      disabled={inviteLoading || !inviteEmail}
                      style={{ ...s.ingestBtn, opacity: inviteLoading || !inviteEmail ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
                      {inviteLoading ? "A convidar..." : "Convidar"}
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de membros — usa tenant_members para Principal, workspace_members para outros */}
              {(() => {
                const list = activeWorkspace
                  ? workspaceMembers.map(m => ({ email: m.email, role: m.role, extra: m.accepted ? "✓" : "(convite pendente)" }))
                  : members.map(m => ({ email: m.email, role: m.role, extra: "" }));

                if (list.length === 0) {
                  return <p style={{ color: "var(--text-muted)", fontSize: "0.84rem" }}>
                    {activeWorkspace ? "Sem membros neste espaço de trabalho." : "Sem membros no tenant."}
                  </p>;
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {list.map((member, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                        backgroundColor: "var(--bg-surface-2)", padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div>
                          <p style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text-primary)" }}>{member.email}</p>
                          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {member.role.toUpperCase()} {member.extra}
                          </p>
                        </div>
                        {activeWorkspace && (
                          <button onClick={() => handleRemoveWorkspaceMember(activeWorkspace, member.email)}
                            style={{ fontSize: "0.78rem", padding: "6px 12px", borderRadius: 6, border: "none",
                              backgroundColor: "var(--danger-subtle)", color: "var(--danger-text)", cursor: "pointer" }}>
                            Remover
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

        ) : tab === "admin" ? (
          /* ── SUPER ADMIN ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Sub-tab switcher */}
            <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
              <button onClick={() => setAdminTab("plans")} style={adminTab === "plans" ? s.tabActive : s.tabInactive}>{t.admin.plansTab}</button>
              <button onClick={() => setAdminTab("keys")}  style={adminTab === "keys"  ? s.tabActive : s.tabInactive}>{t.admin.keysTab}</button>
            </div>

            {adminTab === "plans" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={s.settingsCard}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <p style={{ ...s.settingsTitle, marginBottom: 0 }}>{t.admin.plansTitle}</p>
                    <button
                      onClick={handleSyncStripe}
                      disabled={syncingStripe}
                      style={{ ...s.diagnoseBtn, opacity: syncingStripe ? 0.6 : 1 }}>
                      {stripeSyncDone ? t.admin.syncDone : syncingStripe ? t.admin.syncing : t.admin.syncStripe}
                    </button>
                  </div>
                  <p style={s.settingsDesc}>{t.admin.plansSubtitle}</p>
                  {stripeSyncError && (
                    <div style={{ padding: "10px 14px", backgroundColor: "var(--danger-subtle)", border: "1px solid var(--danger)", borderRadius: 8, fontSize: "0.8rem", color: "var(--danger-text)", marginBottom: 8 }}>
                      {stripeSyncError}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {(planConfigs.length > 0 ? planConfigs : [
                      { plan_name: "starter",    field_limit: 5,   price_monthly: 0,   stripe_price_id: null },
                      { plan_name: "pro",        field_limit: 15,  price_monthly: 49,  stripe_price_id: null },
                      { plan_name: "enterprise", field_limit: 999, price_monthly: 199, stripe_price_id: null },
                    ]).map(cfg => {
                      const edit = editPlan[cfg.plan_name] || cfg;
                      return (
                        <div key={cfg.plan_name} style={{ backgroundColor: "var(--bg-surface-2)", borderRadius: 12, border: "1px solid var(--border)", padding: "18px 20px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                            <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)", margin: 0, textTransform: "capitalize" as const }}>{cfg.plan_name}</p>
                            {cfg.plan_name === "enterprise" && (
                              <button
                                onClick={() => { setShowEntDrawer(true); fetchEnterpriseClients(); fetchTenantOptions(); }}
                                style={{ ...s.diagnoseBtn, fontSize: "0.78rem", fontWeight: 600 }}>
                                {t.admin.manageEnterpriseClients} →
                              </button>
                            )}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div>
                              <label style={s.ingestLabel}>Registros/mês (0=ilimitado)</label>
                              <input type="number" min={0} step={1000} style={s.ingestInput} value={edit.records_per_month ?? 0}
                                onChange={e => setEditPlan(p => ({ ...p, [cfg.plan_name]: { ...edit, records_per_month: Number(e.target.value) } }))} />
                            </div>
                            <div>
                              <label style={s.ingestLabel}>API Keys máx.</label>
                              <input type="number" min={1} style={s.ingestInput} value={edit.api_keys_limit ?? 1}
                                onChange={e => setEditPlan(p => ({ ...p, [cfg.plan_name]: { ...edit, api_keys_limit: Number(e.target.value) } }))} />
                            </div>
                            <div>
                              <label style={s.ingestLabel}>Diagnósticos/mês (0=ilimitado)</label>
                              <input type="number" min={0} style={s.ingestInput} value={edit.diagnoses_per_month ?? 0}
                                onChange={e => setEditPlan(p => ({ ...p, [cfg.plan_name]: { ...edit, diagnoses_per_month: Number(e.target.value) } }))} />
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
                            <div>
                              <label style={s.ingestLabel}>{t.admin.fieldLimit}</label>
                              <input type="number" min={1} style={s.ingestInput} value={edit.field_limit}
                                onChange={e => setEditPlan(p => ({ ...p, [cfg.plan_name]: { ...edit, field_limit: Number(e.target.value) } }))} />
                            </div>
                            <div>
                              <label style={s.ingestLabel}>{t.admin.priceMonthly}</label>
                              <input type="number" min={0} step={0.01} style={s.ingestInput} value={edit.price_monthly}
                                onChange={e => setEditPlan(p => ({ ...p, [cfg.plan_name]: { ...edit, price_monthly: Number(e.target.value) } }))} />
                            </div>
                            <div>
                              <label style={s.ingestLabel}>{t.admin.stripePriceId}</label>
                              {edit.stripe_price_id ? (
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <span style={{ ...s.ingestInput, display: "flex", alignItems: "center", fontFamily: "var(--font-geist-mono)", fontSize: "0.78rem", letterSpacing: revealedPriceIds[cfg.plan_name] ? "normal" : "0.12em", color: "var(--text-secondary)", userSelect: revealedPriceIds[cfg.plan_name] ? "text" as const : "none" as const, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                                    {revealedPriceIds[cfg.plan_name] ? edit.stripe_price_id : "••••••••••••••••"}
                                  </span>
                                  <button onClick={() => setRevealedPriceIds(p => ({ ...p, [cfg.plan_name]: !p[cfg.plan_name] }))} style={s.diagnoseBtn}>
                                    {revealedPriceIds[cfg.plan_name] ? t.admin.hide : t.admin.reveal}
                                  </button>
                                  <button onClick={() => { navigator.clipboard.writeText(edit.stripe_price_id!); setCopiedPriceId(p => ({ ...p, [cfg.plan_name]: true })); setTimeout(() => setCopiedPriceId(p => ({ ...p, [cfg.plan_name]: false })), 2000); }} style={s.copyBtn}>
                                    {copiedPriceId[cfg.plan_name] ? t.admin.copied : t.admin.copy}
                                  </button>
                                </div>
                              ) : (
                                <input type="text" placeholder="price_xxx" style={s.ingestInput} value={edit.stripe_price_id || ""}
                                  onChange={e => setEditPlan(p => ({ ...p, [cfg.plan_name]: { ...edit, stripe_price_id: e.target.value || null } }))} />
                              )}
                            </div>
                            <button onClick={() => handleSavePlan(cfg.plan_name)}
                              disabled={planSaving[cfg.plan_name]}
                              style={{ ...s.ingestBtn, opacity: planSaving[cfg.plan_name] ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
                              {planSaved[cfg.plan_name] ? t.admin.saved : planSaving[cfg.plan_name] ? t.admin.saving : t.admin.save}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Enterprise Tiers */}
                  {adminTiers.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <p style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Sub-planos Enterprise</p>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => handleSetupStripe(false)} disabled={stripeSetupLoading}
                            style={{ ...s.diagnoseBtn, fontSize: "0.76rem", fontWeight: 700, opacity: stripeSetupLoading ? 0.6 : 1 }}>
                            {stripeSetupLoading ? "A processar..." : "⚡ Criar no Stripe"}
                          </button>
                          <button onClick={() => handleSetupStripe(true)} disabled={stripeSetupLoading}
                            style={{ ...s.diagnoseBtn, fontSize: "0.76rem", fontWeight: 600, opacity: stripeSetupLoading ? 0.6 : 1, color: "var(--warning, #b45309)" }}>
                            🔄 Recriar preços
                          </button>
                        </div>
                      </div>
                      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 12 }}>
                        Clique em "Criar produtos no Stripe" para gerar automaticamente os produtos e preços. Depois edite os Price IDs manualmente se necessário.
                      </p>
                      {stripeSetupResult && (
                        <div style={{ marginBottom: 12, display: "flex", flexDirection: "column" as const, gap: 4 }}>
                          {stripeSetupResult.map(r => (
                            <div key={r.id} style={{ fontSize: "0.76rem", padding: "6px 12px", borderRadius: 6,
                              backgroundColor: r.status === "created" ? "var(--success-subtle)" : r.status === "skipped" ? "var(--bg-surface-2)" : "var(--danger-subtle)",
                              color: r.status === "created" ? "var(--success-text)" : r.status === "skipped" ? "var(--text-muted)" : "var(--danger-text)",
                              border: `1px solid ${r.status === "created" ? "var(--success)" : r.status === "skipped" ? "var(--border)" : "var(--danger)"}` }}>
                              {r.status === "created" ? "✓" : r.status === "skipped" ? "—" : "✗"} {r.name}
                              {r.price_id && <span style={{ marginLeft: 8, opacity: 0.7 }}>{r.price_id}</span>}
                              {r.detail && <span style={{ marginLeft: 8 }}>{r.detail}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {adminTiers.map(tier => (
                          <div key={tier.id} style={{ backgroundColor: "var(--bg-surface-2)", borderRadius: 12, border: "1px solid var(--border)", padding: "18px 20px" }}>
                            <p style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 14px 0", textTransform: "capitalize" as const }}>{tier.name}</p>
                            {/* Row 1 — 3 limit fields (igual ao Professional) */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                              <div>
                                <label style={s.ingestLabel}>Registros/mês (0=ilimitado)</label>
                                <input type="number" min={0} step={10000} style={s.ingestInput}
                                  value={editTierFields[tier.id]?.records_per_month ?? tier.records_per_month}
                                  onChange={e => setEditTierFields(p => { const cur = p[tier.id] ?? { records_per_month: tier.records_per_month, api_keys_limit: tier.api_keys_limit, diagnoses_per_month: tier.diagnoses_per_month, field_limit: tier.field_limit, price_monthly: tier.price_monthly }; return { ...p, [tier.id]: { ...cur, records_per_month: Number(e.target.value) } }; })} />
                              </div>
                              <div>
                                <label style={s.ingestLabel}>API Keys máx.</label>
                                <input type="number" min={1} style={s.ingestInput}
                                  value={editTierFields[tier.id]?.api_keys_limit ?? tier.api_keys_limit}
                                  onChange={e => setEditTierFields(p => { const cur = p[tier.id] ?? { records_per_month: tier.records_per_month, api_keys_limit: tier.api_keys_limit, diagnoses_per_month: tier.diagnoses_per_month, field_limit: tier.field_limit, price_monthly: tier.price_monthly }; return { ...p, [tier.id]: { ...cur, api_keys_limit: Number(e.target.value) } }; })} />
                              </div>
                              <div>
                                <label style={s.ingestLabel}>Diagnósticos/mês (0=ilimitado)</label>
                                <input type="number" min={0} style={s.ingestInput}
                                  value={editTierFields[tier.id]?.diagnoses_per_month ?? tier.diagnoses_per_month}
                                  onChange={e => setEditTierFields(p => { const cur = p[tier.id] ?? { records_per_month: tier.records_per_month, api_keys_limit: tier.api_keys_limit, diagnoses_per_month: tier.diagnoses_per_month, field_limit: tier.field_limit, price_monthly: tier.price_monthly }; return { ...p, [tier.id]: { ...cur, diagnoses_per_month: Number(e.target.value) } }; })} />
                              </div>
                            </div>
                            {/* Row 2 — campos + preço + stripe ID + guardar */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
                              <div>
                                <label style={s.ingestLabel}>Limite de campos</label>
                                <input type="number" min={1} style={s.ingestInput}
                                  value={editTierFields[tier.id]?.field_limit ?? tier.field_limit}
                                  onChange={e => setEditTierFields(p => { const cur = p[tier.id] ?? { records_per_month: tier.records_per_month, api_keys_limit: tier.api_keys_limit, diagnoses_per_month: tier.diagnoses_per_month, field_limit: tier.field_limit, price_monthly: tier.price_monthly }; return { ...p, [tier.id]: { ...cur, field_limit: Number(e.target.value) } }; })} />
                              </div>
                              <div>
                                <label style={s.ingestLabel}>Preço mensal (BRL)</label>
                                <input type="number" min={0} step={0.01} style={s.ingestInput}
                                  value={editTierFields[tier.id]?.price_monthly ?? tier.price_monthly}
                                  onChange={e => setEditTierFields(p => { const cur = p[tier.id] ?? { records_per_month: tier.records_per_month, api_keys_limit: tier.api_keys_limit, diagnoses_per_month: tier.diagnoses_per_month, field_limit: tier.field_limit, price_monthly: tier.price_monthly }; return { ...p, [tier.id]: { ...cur, price_monthly: Number(e.target.value) } }; })} />
                              </div>
                              <div>
                                <label style={s.ingestLabel}>{t.admin.stripePriceId}</label>
                                {editTierPrice[tier.id] ? (
                                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    <span style={{ ...s.ingestInput, display: "flex", alignItems: "center", fontFamily: "var(--font-geist-mono)", fontSize: "0.78rem", letterSpacing: revealedTierPriceIds[tier.id] ? "normal" : "0.12em", color: "var(--text-secondary)", userSelect: revealedTierPriceIds[tier.id] ? "text" as const : "none" as const, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                                      {revealedTierPriceIds[tier.id] ? editTierPrice[tier.id] : "••••••••••••••••"}
                                    </span>
                                    <button type="button" onClick={() => setRevealedTierPriceIds(p => ({ ...p, [tier.id]: !p[tier.id] }))} style={s.diagnoseBtn}>
                                      {revealedTierPriceIds[tier.id] ? t.admin.hide : t.admin.reveal}
                                    </button>
                                    <button type="button" onClick={() => { navigator.clipboard.writeText(editTierPrice[tier.id]); setCopiedTierPriceId(p => ({ ...p, [tier.id]: true })); setTimeout(() => setCopiedTierPriceId(p => ({ ...p, [tier.id]: false })), 2000); }} style={s.copyBtn}>
                                      {copiedTierPriceId[tier.id] ? t.admin.copied : t.admin.copy}
                                    </button>
                                    <button type="button" onClick={() => setEditTierPrice(p => ({ ...p, [tier.id]: "" }))} style={{ ...s.diagnoseBtn, color: "var(--danger-text)" }}>
                                      {t.admin.reveal === "Revelar" ? "Alterar" : "Change"}
                                    </button>
                                  </div>
                                ) : (
                                  <input type="text" placeholder="price_xxx" style={s.ingestInput}
                                    value={editTierPrice[tier.id] ?? ""}
                                    onChange={e => setEditTierPrice(p => ({ ...p, [tier.id]: e.target.value }))} />
                                )}
                              </div>
                              <button onClick={() => handleSaveTierPrice(tier.id)} disabled={tierPriceSaving[tier.id]}
                                style={{ ...s.ingestBtn, opacity: tierPriceSaving[tier.id] ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
                                {tierPriceSaved[tier.id] ? t.admin.saved : tierPriceSaving[tier.id] ? t.admin.saving : t.admin.save}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Keys tab */
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={s.settingsCard}>
                  <p style={s.settingsTitle}>{t.admin.keysTitle}</p>
                  <p style={s.settingsDesc}>{t.admin.keysSubtitle}</p>

                  {/* Stored secrets list */}
                  {secrets.length === 0 ? (
                    <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 16 }}>{t.admin.noKeys}</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                      {secrets.map(s2 => {
                        const revealed = revealedKeys[s2.key_name];
                        const isRevealed = revealed !== undefined;
                        return (
                          <div key={s2.key_name} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 14px", backgroundColor: "var(--bg-surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-geist-mono)" }}>{s2.key_name}</span>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => handleRevealSecret(s2.key_name)} style={s.diagnoseBtn}>
                                  {isRevealed ? t.admin.hide : t.admin.reveal}
                                </button>
                                {isRevealed && (
                                  <button onClick={() => handleCopySecret(s2.key_name)} style={s.copyBtn}>
                                    {copiedSecret[s2.key_name] ? t.admin.copied : t.admin.copy}
                                  </button>
                                )}
                                <button onClick={() => handleDeleteSecret(s2.key_name)} style={s.revokeBtn}>{t.admin.deleteKey}</button>
                              </div>
                            </div>
                            {isRevealed && (
                              <div style={{ fontFamily: "var(--font-geist-mono)", fontSize: "0.78rem", color: "var(--text-secondary)", backgroundColor: "var(--bg-surface)", borderRadius: 6, padding: "6px 10px", border: "1px solid var(--border)", wordBreak: "break-all" as const }}>
                                {revealed}
                              </div>
                            )}
                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{t.admin.updatedAt}: {new Date(s2.updated_at).toLocaleString()}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add new secret */}
                  <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>{t.admin.addKey}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
                      <div>
                        <label style={s.ingestLabel}>{t.admin.keyName}</label>
                        <input type="text" placeholder="ANTHROPIC_API_KEY" style={s.ingestInput}
                          value={newSecret.key_name}
                          onChange={e => setNewSecret(p => ({ ...p, key_name: e.target.value.toUpperCase().replace(/\s+/g, "_") }))} />
                      </div>
                      <div>
                        <label style={s.ingestLabel}>{t.admin.keyValue}</label>
                        <div style={{ position: "relative" as const }}>
                          <input
                            type={showNewSecretValue ? "text" : "password"}
                            placeholder="sk-..."
                            style={{ ...s.ingestInput, paddingRight: 44 }}
                            value={newSecret.value}
                            onChange={e => setNewSecret(p => ({ ...p, value: e.target.value }))} />
                          <button
                            type="button"
                            onClick={() => setShowNewSecretValue(v => !v)}
                            style={{ position: "absolute" as const, right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.8rem", fontWeight: 600, padding: 0 }}>
                            {showNewSecretValue ? t.admin.hide : t.admin.reveal}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: 6 }}>{t.admin.suggestedKeys}:</p>
                      <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
                        {["ANTHROPIC_API_KEY","SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_KEY","STRIPE_SECRET_KEY","STRIPE_PUBLISHABLE_KEY","STRIPE_WEBHOOK_SECRET"].map(k => (
                          <button key={k} onClick={() => setNewSecret(p => ({ ...p, key_name: k }))}
                            style={{ fontSize: "0.68rem", padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", backgroundColor: newSecret.key_name === k ? "var(--accent)" : "var(--bg-surface)", color: newSecret.key_name === k ? "#fff" : "var(--text-muted)", cursor: "pointer" }}>
                            {k}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button onClick={handleSaveSecret} disabled={secretSaving || !newSecret.key_name || !newSecret.value}
                      style={{ ...s.ingestBtn, opacity: secretSaving || !newSecret.key_name || !newSecret.value ? 0.6 : 1 }}>
                      {secretSaving ? t.admin.saving : t.admin.addKey}
                    </button>
                  </div>
                </div>
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

            {/* ── Equipa ── */}
            <div style={s.settingsCard}>
              <p style={s.settingsTitle}>Equipa</p>
              <p style={s.settingsDesc}>Gerencie quem acessa este tenant e com qual papel.</p>

              {/* Role legend */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" as const }}>
                {[
                  { role: "admin",    color: "#6d28d9", bg: "#ede9fe", label: "Admin — acesso total" },
                  { role: "operator", color: "var(--accent)", bg: "var(--accent-subtle)", label: "Operator — aprovar e ingerir" },
                  { role: "viewer",   color: "var(--text-muted)", bg: "var(--bg-surface-2)", label: "Viewer — somente leitura" },
                ].map(({ role, color, bg, label }) => (
                  <span key={role} style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: bg, color, border: "1px solid var(--border)", whiteSpace: "nowrap" as const }}>{label}</span>
                ))}
              </div>

              {/* Members list */}
              {!membersLoaded ? (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>A carregar...</p>
              ) : members.length === 0 ? (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 12 }}>Nenhum membro adicionado ainda. O proprietário da conta sempre tem papel admin.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                  {members.map(m => (
                    <div key={m.email} style={s.keyRow}>
                      <div>
                        <p style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>{m.email}</p>
                        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Convidado por {m.invited_by || "—"}</p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <select
                          value={m.role}
                          onChange={e => handleChangeMemberRole(m.email, e.target.value)}
                          style={{ fontSize: "0.78rem", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", background: "var(--bg-surface-2)", color: "var(--text-secondary)", cursor: "pointer" }}
                        >
                          <option value="admin">admin</option>
                          <option value="operator">operator</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button onClick={() => handleRemoveMember(m.email)} style={s.revokeBtn}>Remover</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Invite form */}
              {memberError && <p style={{ fontSize: "0.78rem", color: "var(--danger)", marginBottom: 8 }}>{memberError}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                <input
                  type="email"
                  placeholder="email@empresa.com"
                  value={newMember.email}
                  onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))}
                  style={{ ...s.ingestInput, flex: 1, minWidth: 200 }}
                />
                <select
                  value={newMember.role}
                  onChange={e => setNewMember(p => ({ ...p, role: e.target.value }))}
                  style={{ fontSize: "0.82rem", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--bg-surface-2)", color: "var(--text-secondary)", cursor: "pointer" }}
                >
                  <option value="operator">operator</option>
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  onClick={handleAddMember}
                  disabled={memberSaving || !newMember.email}
                  style={{ ...s.ingestBtn, opacity: memberSaving || !newMember.email ? 0.6 : 1 }}
                >
                  {memberSaving ? "Adicionando..." : "Adicionar membro"}
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
                  onClick={() => { setBulkStep("idle"); fetchData(); }}
                  style={{ ...s.ingestBtn, width: "100%", textAlign: "center" }}
                >
                  {t.bulk.btnClose}
                </button>
              </>
            )}

          </div>
        </div>
      )}

      {/* ── ENTERPRISE TIER MODAL ── */}
      {showTierModal && (
        <div style={{ position: "fixed" as const, inset: 0, zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)", padding: 24 }}>
          <div style={{ backgroundColor: "var(--bg-surface)", borderRadius: 18, border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", width: "100%", maxWidth: 880, maxHeight: "90vh", overflowY: "auto" as const, padding: "32px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)", marginBottom: 6, letterSpacing: "-0.02em" }}>
                  Plano Enterprise
                </h2>
                <p style={{ fontSize: "0.84rem", color: "var(--text-muted)", margin: 0 }}>
                  Escolha o volume que melhor se encaixa na sua operação. Todos os planos incluem SLA, suporte dedicado e recursos ilimitados de compliance.
                </p>
              </div>
              <button onClick={() => setShowTierModal(false)}
                style={{ background: "none", border: "none", fontSize: "1.4rem", color: "var(--text-muted)", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>
                ×
              </button>
            </div>

            {!tiersLoaded ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.84rem" }}>A carregar...</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
                {enterpriseTiers.map(tier => {
                  const isUnlimited = tier.records_per_month === 0;
                  const loading = tierCheckoutLoading[tier.id];
                  return (
                    <div key={tier.id} style={{
                      backgroundColor: "var(--bg-surface-2)", borderRadius: 14,
                      border: "1px solid var(--border)", padding: "22px 20px",
                      display: "flex", flexDirection: "column" as const, gap: 12,
                    }}>
                      <div>
                        <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", textTransform: "uppercase" as const, marginBottom: 4 }}>ENTERPRISE</p>
                        <p style={{ fontSize: "1rem", fontWeight: 800, color: "var(--text-primary)", marginBottom: 6 }}>{tier.name}</p>
                        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.5 }}>{tier.description}</p>
                      </div>
                      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column" as const, gap: 6 }}>
                        {[
                          { label: "Registros/mês", val: isUnlimited ? "Ilimitado" : tier.records_per_month.toLocaleString("pt-BR") },
                          { label: "API Keys",      val: tier.api_keys_limit >= 999 ? "Ilimitado" : String(tier.api_keys_limit) },
                          { label: "Campos custom", val: tier.field_limit >= 999 ? "Ilimitado" : String(tier.field_limit) },
                          { label: "Diagnósticos",  val: "Ilimitado" },
                          { label: "Webhooks",      val: "Ilimitado" },
                          { label: "Suporte",       val: "Dedicado 24/7" },
                        ].map(f => (
                          <div key={f.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                            <span style={{ color: "var(--text-muted)" }}>{f.label}</span>
                            <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{f.val}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                        <p style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--text-primary)", marginBottom: 2 }}>
                          R${tier.price_monthly.toLocaleString("pt-BR")}
                          <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "var(--text-muted)" }}>/mês</span>
                        </p>
                        <button
                          onClick={() => handleTierCheckout(tier.id)}
                          disabled={loading || !tier.stripe_price_id}
                          style={{
                            width: "100%", padding: "10px 0", borderRadius: 9, border: "none",
                            cursor: tier.stripe_price_id ? "pointer" : "not-allowed",
                            fontSize: "0.82rem", fontWeight: 700, marginTop: 10,
                            backgroundColor: tier.stripe_price_id ? "#1e293b" : "var(--bg-surface)",
                            color: tier.stripe_price_id ? "#fff" : "var(--text-muted)",
                            opacity: loading ? 0.6 : 1,
                          }}>
                          {loading ? "A processar..." : tier.stripe_price_id ? "Assinar agora" : "Em breve"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p style={{ fontSize: "0.76rem", color: "var(--text-muted)", textAlign: "center" as const, marginTop: 20 }}>
              Precisa de volume acima de 5M ou condições especiais?{" "}
              <a href="mailto:bitzensoftware@bitzen.app?subject=Trust%20%26%20Tandem%20AI%20%E2%80%94%20Enterprise%20Custom"
                style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                Fale com a nossa equipa
              </a>
            </p>
          </div>
        </div>
      )}

      {/* ── ENTERPRISE CLIENTS DRAWER ── */}
      {showEntDrawer && (
        <div style={{ position: "fixed" as const, inset: 0, zIndex: 300, display: "flex" }}>
          <div onClick={() => setShowEntDrawer(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,.4)" }} />
          <div style={{ width: "min(480px, 95vw)", backgroundColor: "var(--bg-surface)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", overflowY: "auto" as const, display: "flex", flexDirection: "column" as const }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <p style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>{t.admin.enterpriseClientsList}</p>
              <button onClick={() => setShowEntDrawer(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "1.2rem", lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ padding: "20px 24px", flex: 1, display: "flex", flexDirection: "column" as const, gap: 20 }}>
              {/* Existing clients */}
              {entClients.length === 0 ? (
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{t.admin.noEnterpriseClients}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                  {entClients.map(c => (
                    <div key={c.tenant_id} style={{ padding: "12px 14px", backgroundColor: "var(--bg-surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font-geist-mono)", wordBreak: "break-all" as const, flex: 1 }}>{c.tenant_id}</span>
                        <button onClick={() => handleDeleteEnterpriseClient(c.tenant_id)} style={{ ...s.revokeBtn, flexShrink: 0 }}>{t.admin.deleteEnterpriseClient}</button>
                      </div>
                      <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
                        {c.currency_display === "BRL" ? "R$" : "$"}{c.amount_display}/mês · <span style={{ fontFamily: "var(--font-geist-mono)" }}>{c.stripe_price_id}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
              {/* Add new client */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>+ {t.admin.saveEnterpriseClient}</p>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
                  <div>
                    <label style={s.ingestLabel}>{t.admin.clientTenantId}</label>
                    <select style={{ ...s.ingestInput, cursor: "pointer" }}
                      value={newEntClient.tenant_id}
                      onChange={e => setNewEntClient(p => ({ ...p, tenant_id: e.target.value }))}>
                      <option value="">— Selecionar empresa —</option>
                      {tenantOptions.map(opt => (
                        <option key={opt.tenant_id} value={opt.tenant_id}>
                          {opt.company_name ? `${opt.company_name} (${opt.plan ?? "starter"})` : opt.tenant_id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={s.ingestLabel}>{t.admin.clientPriceId}</label>
                    <input type="text" style={s.ingestInput} placeholder="price_xxx"
                      value={newEntClient.stripe_price_id}
                      onChange={e => setNewEntClient(p => ({ ...p, stripe_price_id: e.target.value }))} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                    <div>
                      <label style={s.ingestLabel}>{t.admin.clientAmount}</label>
                      <input type="number" min={0} step={0.01} style={s.ingestInput} placeholder="800.00"
                        value={newEntClient.amount_display}
                        onChange={e => setNewEntClient(p => ({ ...p, amount_display: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.ingestLabel}>{t.admin.clientCurrency}</label>
                      <select style={{ ...s.ingestInput, cursor: "pointer" }}
                        value={newEntClient.currency_display}
                        onChange={e => setNewEntClient(p => ({ ...p, currency_display: e.target.value }))}>
                        <option value="BRL">BRL (R$)</option>
                        <option value="USD">USD ($)</option>
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleSaveEnterpriseClient}
                    disabled={entClientSaving || !newEntClient.tenant_id || !newEntClient.stripe_price_id || !newEntClient.amount_display}
                    style={{ ...s.ingestBtn, opacity: entClientSaving || !newEntClient.tenant_id || !newEntClient.stripe_price_id || !newEntClient.amount_display ? 0.6 : 1 }}>
                    {entClientSaving ? t.admin.saving : t.admin.saveEnterpriseClient}
                  </button>
                </div>
              </div>
            </div>
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
