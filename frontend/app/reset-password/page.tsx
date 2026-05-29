"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password,    setPassword]    = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [error,       setError]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [ready,       setReady]       = useState(false);
  const [done,        setDone]        = useState(false);
  const [exchanging,  setExchanging]  = useState(true);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setError("Link inválido ou expirado. Solicite um novo link de redefinição.");
          setExchanging(false);
          return;
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) setReady(true);
      else setError("Link inválido ou expirado. Solicite um novo link de redefinição.");
      setExchanging(false);
    }
    init();
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    if (password.length < 8)  { setError("A senha deve ter pelo menos 8 caracteres."); return; }
    setLoading(true); setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) setError("Erro ao redefinir senha. Tente novamente.");
    else { setDone(true); setTimeout(() => router.push("/login"), 3000); }
  }

  const s = {
    page:  { minHeight: "100vh", backgroundColor: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
    card:  { width: "100%", maxWidth: 400, backgroundColor: "var(--bg-surface)", borderRadius: 18, border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", padding: "40px 36px" },
    title: { fontSize: "1.4rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.02em" },
    sub:   { fontSize: "0.84rem", color: "var(--text-muted)", marginBottom: 28 },
    label: { display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 },
    input: { width: "100%", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: "0.88rem", color: "var(--text-primary)", backgroundColor: "var(--bg-surface-2)", outline: "none", boxSizing: "border-box" as const },
    error: { backgroundColor: "var(--danger-subtle)", border: "1px solid var(--danger)", color: "var(--danger-text)", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem" },
    btn:   { width: "100%", backgroundColor: "var(--accent)", color: "#fff", borderRadius: 10, padding: "11px 0", fontSize: "0.88rem", fontWeight: 600, border: "none", cursor: "pointer" },
  };

  if (exchanging) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: "center" as const }}>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>A verificar o link...</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: "center" as const }}>
          <p style={{ fontSize: "2rem", marginBottom: 12 }}>✅</p>
          <p style={{ fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Senha redefinida!</p>
          <p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>A redirecionar para o login...</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.title}>Link inválido</h1>
          <div style={s.error}>{error}</div>
          <button type="button" onClick={() => router.push("/login")}
            style={{ ...s.btn, marginTop: 20 }}>
            Voltar ao login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Nova senha</h1>
        <p style={s.sub}>Escolha uma senha segura com pelo menos 8 caracteres.</p>
        <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={s.label}>Nova senha</label>
            <input type="password" required minLength={8} value={password}
              onChange={e => setPassword(e.target.value)}
              style={s.input} placeholder="••••••••" />
          </div>
          <div>
            <label style={s.label}>Confirmar senha</label>
            <input type="password" required minLength={8} value={confirm}
              onChange={e => setConfirm(e.target.value)}
              style={s.input} placeholder="••••••••" />
          </div>
          {error && <div style={s.error}>{error}</div>}
          <button type="submit" disabled={loading} style={{ ...s.btn, opacity: loading ? 0.6 : 1 }}>
            {loading ? "Salvando..." : "Redefinir senha"}
          </button>
        </form>
      </div>
    </div>
  );
}
