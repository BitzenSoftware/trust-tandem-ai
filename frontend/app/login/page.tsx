"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [theme,    setTheme]    = useState<"light"|"dark">("light");

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

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("email not confirmed") || msg.includes("not confirmed"))
        setError("Email nÃ£o confirmado. Verifique sua caixa de entrada e clique no link de confirmaÃ§Ã£o.");
      else
        setError("Email ou senha incorretos.");
      setLoading(false);
    } else { router.push("/dashboard"); router.refresh(); }
  }

  const s = {
    page:     { minHeight: "100vh", backgroundColor: "var(--bg-base)", display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", padding: 24 },
    topbar:   { position: "fixed" as const, top: 16, right: 16 },
    themeBtn: { padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", backgroundColor: "var(--bg-surface)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", fontWeight: 500, boxShadow: "var(--shadow-sm)" },
    card:     { width: "100%", maxWidth: 400, backgroundColor: "var(--bg-surface)", borderRadius: 18, border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", padding: "40px 36px" },
    badge:    { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", backgroundColor: "var(--accent-subtle)", color: "var(--accent)", borderRadius: 20, fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.04em", marginBottom: 20 },
    title:    { fontSize: "1.6rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.03em", marginBottom: 4 },
    subtitle: { fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 28 },
    label:    { display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6, letterSpacing: "0.01em" },
    input:    { width: "100%", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: "0.88rem", color: "var(--text-primary)", backgroundColor: "var(--bg-surface-2)", outline: "none", boxSizing: "border-box" as const, transition: "border-color 0.15s" },
    error:    { backgroundColor: "var(--danger-subtle)", border: "1px solid var(--danger)", color: "var(--danger-text)", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem" },
    btn:      { width: "100%", backgroundColor: "var(--accent)", color: "#fff", borderRadius: 10, padding: "11px 0", fontSize: "0.88rem", fontWeight: 600, border: "none", cursor: "pointer", letterSpacing: "0.01em", transition: "background-color 0.15s, opacity 0.15s" },
    footer:   { textAlign: "center" as const, fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 24 },
    link:     { color: "var(--accent)", fontWeight: 600, textDecoration: "none" },
  };

  return (
    <div style={s.page}>
      <div style={s.topbar}>
        <button onClick={toggleTheme} style={s.themeBtn}>
          {theme === "light" ? <MoonIcon /> : <SunIcon />}
          {theme === "light" ? "Dark" : "Light"}
        </button>
      </div>

      <div style={s.card}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <span style={s.badge}>ðŸ” Acesso Seguro</span>
          <h1 style={s.title}>Trust & Tandem AI</h1>
          <p style={s.subtitle}>GovernanÃ§a de Dados LGPD</p>
        </div>

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={s.label}>Email</label>
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              style={s.input} placeholder="seu@email.com"
            />
          </div>
          <div>
            <label style={s.label}>Senha</label>
            <input
              type="password" required value={password}
              onChange={e => setPassword(e.target.value)}
              style={s.input} placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
            />
          </div>

          {error && <div style={s.error}>{error}</div>}

          <button type="submit" disabled={loading} style={{ ...s.btn, opacity: loading ? 0.6 : 1 }}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p style={s.footer}>
          NÃ£o tem conta?{" "}
          <Link href="/register" style={s.link}>Criar conta</Link>
        </p>
      </div>
    </div>
  );
}
