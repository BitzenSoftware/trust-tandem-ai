"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
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

function ShieldIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}

function BrainIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}

function UserCheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <polyline points="16 11 18 13 22 9"/>
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3"/>
      <path d="m10.29 10.71 7.5 7.5a1.5 1.5 0 0 1 0 2.12 1.5 1.5 0 0 1-2.12 0L14 19l-1.5 1.5"/>
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  );
}

function ScaleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="3" x2="12" y2="21"/>
      <path d="M5 21H19"/>
      <path d="M3 9l9-6 9 6"/>
      <path d="M3 9c0 3.3 2.7 6 6 6s6-2.7 6-6"/>
      <path d="M15 9c0 3.3 2.7 6 6 6"/>
    </svg>
  );
}

function CheckIcon({ color = "var(--success)" }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

const W: React.CSSProperties = { maxWidth: 1200, margin: "0 auto", width: "100%" };

const PLAN_META: Record<string, { desc: string; highlight: boolean; cta: string; ctaHref: string; features: string[] }> = {
  starter: {
    desc: "Para DPOs e equipes técnicas validarem o fluxo HITL e integrarem a API.",
    highlight: false, cta: "Criar Conta Gratuita", ctaHref: "/register",
    features: ["Até 1.000 registros/mês", "Upload CSV e formulário manual", "50 diagnósticos do Agente/mês", "1 Webhook de saída", "1 API Key por tenant", "Sem SLA garantido"],
  },
  pro: {
    desc: "Para mid-market que processa bases de dados de clientes de forma recorrente.",
    highlight: true, cta: "Agendar Demonstração", ctaHref: "/register",
    features: ["Até 50.000 registros/mês", "Chunking automático de CSV", "Diagnósticos do Agente ilimitados", "Webhooks ilimitados com HMAC-SHA256", "5 API Keys por tenant", "SLA 99,5% de uptime"],
  },
  enterprise: {
    desc: "Para grandes volumes, SLA dedicado e deploys perimetrais on-premise.",
    highlight: false, cta: "Falar com Comercial", ctaHref: "/register",
    features: ["Volume customizado e ilimitado", "Deploy perimetral (on-premise / VPC)", "SLA dedicado com suporte 24/7", "Integração SSO/SAML", "Relatório de conformidade ANPD", "Onboarding e treinamento dedicados"],
  },
};

function formatPrice(planName: string, price: number): { label: string; period: string } {
  if (price === 0) return { label: "Gratuito", period: "" };
  if (planName === "enterprise") return { label: "Sob consulta", period: "" };
  return { label: `R$ ${price.toLocaleString("pt-BR")}`, period: "/mês" };
}

export default function LandingPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [scrolled, setScrolled] = useState(false);
  const [plans, setPlans] = useState<{ plan_name: string; price_monthly: number }[]>([]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_API_URL;
    if (!url) return;
    fetch(`${url}/api/v1/plans/public`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data) && data.length > 0) setPlans(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const saved = (localStorage.getItem("theme") ||
      document.documentElement.getAttribute("data-theme") || "light") as "light" | "dark";
    setTheme(saved);
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }

  return (
    <div style={{ backgroundColor: "var(--bg-base)", color: "var(--text-primary)", minHeight: "100vh", overflowX: "hidden" }}>

      {/* ── NAVBAR ─────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        height: 64, display: "flex", alignItems: "center",
        padding: "0 clamp(16px, 5vw, 80px)",
        backgroundColor: scrolled ? "var(--bg-surface)" : "transparent",
        borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
        boxShadow: scrolled ? "var(--shadow-sm)" : "none",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        transition: "background-color 0.3s, border-color 0.3s, box-shadow 0.3s",
      }}>
        <div style={{ ...W, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ color: "var(--accent)" }}><ShieldIcon size={22} /></div>
            <span style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              Trust & Tandem <span style={{ color: "var(--accent)" }}>AI</span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {[
              { label: "Funcionalidades", href: "#features" },
              { label: "Segurança", href: "#enterprise" },
              { label: "Planos", href: "#pricing" },
            ].map(link => (
              <a key={link.label} href={link.href} style={{
                fontSize: "0.84rem", color: "var(--text-secondary)",
                textDecoration: "none", fontWeight: 500,
              }}>
                {link.label}
              </a>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={toggleTheme} style={{
              padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)",
              backgroundColor: "var(--bg-surface)", color: "var(--text-secondary)",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              fontSize: "0.75rem", fontWeight: 500, boxShadow: "var(--shadow-sm)",
            }}>
              {theme === "light" ? <MoonIcon /> : <SunIcon />}
              {theme === "light" ? "Dark" : "Light"}
            </button>
            <Link href="/login" style={{
              padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border)",
              color: "var(--text-primary)", textDecoration: "none",
              fontSize: "0.84rem", fontWeight: 600,
            }}>
              Entrar
            </Link>
            <Link href="/register" style={{
              padding: "7px 16px", borderRadius: 8, backgroundColor: "var(--accent)",
              color: "#fff", textDecoration: "none", fontSize: "0.84rem", fontWeight: 700,
            }}>
              Criar Conta
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ───────────────────────────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        padding: "100px clamp(16px, 5vw, 80px) 80px",
        background: "radial-gradient(ellipse 80% 60% at 65% 40%, var(--accent-subtle) 0%, transparent 70%)",
      }}>
        <div style={{ ...W, display: "flex", alignItems: "center", gap: 56, flexWrap: "wrap" }}>

          {/* Left copy */}
          <div style={{ flex: "1 1 460px", maxWidth: 600 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "5px 14px", backgroundColor: "var(--accent-subtle)",
              color: "var(--accent-text)", borderRadius: 20,
              fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase" as const, border: "1px solid var(--accent)",
              marginBottom: 24,
            }}>
              <ShieldIcon size={11} /> Conformidade LGPD · Auditado pela ANPD
            </div>

            <h1 style={{
              fontSize: "clamp(2.2rem, 5vw, 3.5rem)", fontWeight: 800,
              lineHeight: 1.1, letterSpacing: "-0.04em", marginBottom: 24,
            }}>
              O Airbag da IA para{" "}
              <span style={{
                background: "linear-gradient(135deg, var(--accent) 0%, #6366F1 100%)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>
                Suas Bases de Dados
              </span>
            </h1>

            <p style={{
              fontSize: "1.05rem", lineHeight: 1.7, color: "var(--text-secondary)",
              maxWidth: 500, marginBottom: 36,
            }}>
              Use Inteligência Artificial para higienizar, auditar e corrigir dados de clientes com{" "}
              <strong style={{ color: "var(--text-primary)" }}>isolamento multi-tenant</strong>,{" "}
              <strong style={{ color: "var(--text-primary)" }}>mascaramento defensivo na borda</strong>{" "}
              e validação humana obrigatória — sem risco de vazamento e em conformidade absoluta com a LGPD.
            </p>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href="/register" style={{
                padding: "13px 28px", backgroundColor: "var(--accent)", color: "#fff",
                borderRadius: 10, textDecoration: "none", fontSize: "0.9rem", fontWeight: 700,
                boxShadow: "0 4px 14px rgba(59,130,246,.35)",
              }}>
                Agendar Demonstração →
              </Link>
              <Link href="/login" style={{
                padding: "13px 28px", backgroundColor: "var(--bg-surface)",
                color: "var(--text-primary)", borderRadius: 10, textDecoration: "none",
                fontSize: "0.9rem", fontWeight: 600, border: "1px solid var(--border)",
                boxShadow: "var(--shadow-sm)",
              }}>
                Ver Documentação da API
              </Link>
            </div>

            <div style={{
              display: "flex", gap: 32, marginTop: 48, paddingTop: 32,
              borderTop: "1px solid var(--border)", flexWrap: "wrap",
            }}>
              {[
                { value: "100k+", label: "Registros por importação" },
                { value: "LGPD", label: "Art. 18 nativo" },
                { value: "R$0", label: "Custo de IA na ingestão" },
              ].map(stat => (
                <div key={stat.label}>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent)", letterSpacing: "-0.03em" }}>{stat.value}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 500 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right mock UI */}
          <div style={{ flex: "1 1 300px", maxWidth: 440 }}>
            <div style={{
              backgroundColor: "var(--bg-surface)", borderRadius: 18,
              border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)", overflow: "hidden",
            }}>
              <div style={{
                padding: "13px 20px", borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                backgroundColor: "var(--bg-surface-2)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ color: "var(--accent)" }}><ShieldIcon size={15} /></div>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>Banco de Dados Seguro</span>
                </div>
                <span style={{
                  fontSize: "0.65rem", fontWeight: 700, padding: "3px 8px",
                  backgroundColor: "var(--success-subtle)", color: "var(--success-text)",
                  borderRadius: 6, border: "1px solid var(--success)",
                }}>
                  ✓ Conforme LGPD
                </span>
              </div>

              <div style={{ padding: "14px 20px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                  <thead>
                    <tr>
                      {["Nome", "Email", "CPF"].map(h => (
                        <th key={h} style={{
                          textAlign: "left", padding: "5px 8px",
                          color: "var(--text-muted)", fontWeight: 600,
                          fontSize: "0.67rem", textTransform: "uppercase" as const,
                          letterSpacing: "0.06em", borderBottom: "1px solid var(--border)",
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { n: "João S.", e: "j***@g***.com", c: "***.789-**" },
                      { n: "Maria C.", e: "m***@o***.com", c: "***.456-**" },
                      { n: "Pedro R.", e: "p***@h***.com", c: "***.123-**" },
                      { n: "Carla M.", e: "c***@y***.com", c: "***.321-**" },
                    ].map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 8px", fontWeight: 500 }}>{row.n}</td>
                        <td style={{ padding: "8px 8px", color: "var(--text-muted)", fontFamily: "monospace" }}>{row.e}</td>
                        <td style={{ padding: "8px 8px", color: "var(--text-muted)", fontFamily: "monospace" }}>{row.c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{
                padding: "10px 20px", borderTop: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                backgroundColor: "var(--warning-subtle)",
              }}>
                <span style={{ fontSize: "0.73rem", color: "var(--warning-text)", fontWeight: 600 }}>
                  ⚠️ 3 na Fila de Revisão Humana
                </span>
                <span style={{ fontSize: "0.67rem", color: "var(--text-muted)" }}>via Agente IA</span>
              </div>
            </div>

            {/* Floating diagnosis badge */}
            <div style={{
              marginTop: 14, padding: "10px 16px",
              backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: 12, display: "flex", alignItems: "center", gap: 12,
              boxShadow: "var(--shadow-md)",
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                backgroundColor: "var(--accent-subtle)", color: "var(--accent)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <BrainIcon size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.73rem", fontWeight: 700 }}>Agente diagnosticou:</div>
                <div style={{ fontSize: "0.67rem", color: "var(--text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  email · wanderley#gmail.com → wanderley@gmail.com
                </div>
              </div>
              <div style={{
                padding: "5px 12px", backgroundColor: "var(--success)", color: "#fff",
                borderRadius: 6, fontSize: "0.68rem", fontWeight: 700, flexShrink: 0,
              }}>
                Aprovar
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: "96px clamp(16px, 5vw, 80px)", backgroundColor: "var(--bg-surface)" }}>
        <div style={W}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <span style={{
              display: "inline-block", padding: "4px 14px",
              backgroundColor: "var(--accent-subtle)", color: "var(--accent-text)",
              borderRadius: 20, fontSize: "0.7rem", fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 14,
            }}>
              Arquitetura
            </span>
            <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
              Três Pilares da Governança com IA
            </h2>
            <p style={{ fontSize: "1rem", color: "var(--text-secondary)", maxWidth: 520, margin: "0 auto" }}>
              Uma arquitetura defensiva onde a IA sugere e o operador humano decide — sem comprometer dados brutos.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 22 }}>
            {[
              {
                icon: <UploadIcon />,
                title: "Ingestão Massiva",
                description: "Processe até 100 mil registros via CSV com chunking automático de 500 por lote. Barra de progresso em tempo real. Detecção automática de colunas name, email e cpf.",
                tags: ["CSV Upload", "100k linhas", "Chunking automático"],
                iconColor: "var(--accent)", iconBg: "var(--accent-subtle)",
              },
              {
                icon: <ShieldIcon size={28} />,
                title: "Trust Layer — Mascaramento na Borda",
                description: "Dados brutos nunca armazenados em claro. Hashes e hints defensivos aplicados na borda (j***@g***.com). Isolamento lógico estrito por Tenant ID via JWT Bearer.",
                tags: ["Mascaramento", "Multi-Tenant", "LGPD Art. 5"],
                iconColor: "var(--success)", iconBg: "var(--success-subtle)",
              },
              {
                icon: <UserCheckIcon />,
                title: "Triagem Humana — HITL",
                description: "A IA gera diagnóstico estruturado em JSON com campo afetado e sugestão de correção. O operador valida com um clique. Auditoria completa de cada decisão tomada.",
                tags: ["Human-in-the-Loop", "Agente IA", "JSON Diagnosis"],
                iconColor: "#8B5CF6", iconBg: "rgba(139,92,246,0.1)",
              },
            ].map(f => (
              <div key={f.title} style={{
                backgroundColor: "var(--bg-base)", border: "1px solid var(--border)",
                borderRadius: 18, padding: "30px 26px", boxShadow: "var(--shadow-sm)",
              }}>
                <div style={{
                  width: 54, height: 54, borderRadius: 14,
                  backgroundColor: f.iconBg, color: f.iconColor,
                  display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20,
                }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 10, letterSpacing: "-0.02em" }}>{f.title}</h3>
                <p style={{ fontSize: "0.86rem", lineHeight: 1.65, color: "var(--text-secondary)", marginBottom: 20 }}>{f.description}</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {f.tags.map(tag => (
                    <span key={tag} style={{
                      padding: "3px 10px", backgroundColor: "var(--bg-surface)",
                      border: "1px solid var(--border)", borderRadius: 6,
                      fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 600,
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DEMO HITL ──────────────────────────────────────────────────────── */}
      <section id="demo" style={{ padding: "96px clamp(16px, 5vw, 80px)" }}>
        <div style={W}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <span style={{
              display: "inline-block", padding: "4px 14px",
              backgroundColor: "var(--warning-subtle)", color: "var(--warning-text)",
              borderRadius: 20, fontSize: "0.7rem", fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 14,
            }}>
              Na Prática
            </span>
            <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
              O Fluxo HITL em 4 Passos
            </h2>
            <p style={{ fontSize: "1rem", color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto" }}>
              Desde a ingestão até a aprovação humana, cada etapa é rastreável e auditável pela ANPD.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 18, marginBottom: 40 }}>
            {[
              { step: "01", icon: "📥", title: "Ingestão & Triagem", color: "var(--accent)", desc: "CSV com milhares de registros é importado. Validação de regras detecta emails malformados e CPFs inválidos automaticamente." },
              { step: "02", icon: "🧠", title: "Diagnóstico do Agente", color: "#8B5CF6", desc: 'O operador clica em "Solicitar Diagnóstico". O Agente retorna JSON estruturado com campo afetado e sugestão de correção.' },
              { step: "03", icon: "✅", title: "Validação Humana", color: "var(--success)", desc: "O operador revisa a sugestão, ajusta se necessário, e aprova com um clique — ou expurga o registro conforme Art. 18 LGPD." },
              { step: "04", icon: "🔗", title: "Webhook de Saída", color: "var(--warning)", desc: "O registro limpo é enviado automaticamente via Webhook assíncrono para o CRM/ERP com assinatura HMAC-SHA256." },
            ].map(item => (
              <div key={item.step} style={{
                backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)",
                borderRadius: 16, padding: "26px 22px", boxShadow: "var(--shadow-sm)",
                position: "relative",
              }}>
                <div style={{
                  position: "absolute", top: 18, right: 18,
                  fontSize: "0.67rem", fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.1em",
                }}>
                  {item.step}
                </div>
                <div style={{ fontSize: "1.8rem", marginBottom: 12 }}>{item.icon}</div>
                <h3 style={{ fontSize: "0.92rem", fontWeight: 700, marginBottom: 8, color: item.color }}>{item.title}</h3>
                <p style={{ fontSize: "0.8rem", lineHeight: 1.6, color: "var(--text-secondary)" }}>{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Mock diagnosis panel */}
          <div style={{
            backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)",
            borderRadius: 18, overflow: "hidden", boxShadow: "var(--shadow-md)",
          }}>
            <div style={{
              padding: "13px 22px", backgroundColor: "var(--bg-surface-2)",
              borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>🧠 Diagnóstico do Agente — Wanderley Pinto</span>
              <span style={{
                fontSize: "0.65rem", padding: "2px 8px",
                backgroundColor: "var(--warning-subtle)", color: "var(--warning-text)",
                borderRadius: 4, fontWeight: 700, border: "1px solid var(--warning)",
              }}>
                Aguardando revisão humana
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, backgroundColor: "var(--border)" }}>
              {[
                { label: "Campo Afetado", value: "email", danger: false, success: false, mono: false },
                { label: "Valor Original", value: "wanderley#gmail.com", danger: true, success: false, mono: true },
                { label: "Sugestão do Agente", value: "wanderley@gmail.com", danger: false, success: true, mono: true },
                { label: "Motivo", value: "Caractere '#' inválido no lugar do '@'", danger: false, success: false, mono: false },
              ].map(cell => (
                <div key={cell.label} style={{ padding: "16px 18px", backgroundColor: "var(--bg-surface)" }}>
                  <div style={{
                    fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 700,
                    letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 6,
                  }}>
                    {cell.label}
                  </div>
                  <div style={{
                    fontSize: "0.85rem", fontWeight: 600,
                    fontFamily: cell.mono ? "monospace" : "inherit",
                    color: cell.danger ? "var(--danger-text)" : cell.success ? "var(--success-text)" : "var(--text-primary)",
                    backgroundColor: cell.danger ? "var(--danger-subtle)" : cell.success ? "var(--success-subtle)" : "transparent",
                    padding: (cell.danger || cell.success) ? "3px 7px" : 0,
                    borderRadius: 4, display: "inline-block",
                  }}>
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>
            <div style={{
              padding: "14px 22px", display: "flex", gap: 10,
              alignItems: "center", justifyContent: "flex-end", borderTop: "1px solid var(--border)",
            }}>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginRight: "auto" }}>
                E-mail corrigido: <strong style={{ color: "var(--text-primary)" }}>wanderley@gmail.com</strong>
              </span>
              <button style={{
                padding: "7px 16px", borderRadius: 8, border: "1px solid var(--border)",
                backgroundColor: "var(--bg-surface-2)", color: "var(--danger-text)",
                fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
              }}>
                Expurgar (Art. 18)
              </button>
              <button style={{
                padding: "7px 18px", borderRadius: 8, border: "none",
                backgroundColor: "var(--success)", color: "#fff",
                fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
              }}>
                ✓ Aprovar & Enviar
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── ENTERPRISE ─────────────────────────────────────────────────────── */}
      <section id="enterprise" style={{ padding: "96px clamp(16px, 5vw, 80px)", backgroundColor: "var(--bg-surface)" }}>
        <div style={W}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <span style={{
              display: "inline-block", padding: "4px 14px",
              backgroundColor: "var(--success-subtle)", color: "var(--success-text)",
              borderRadius: 20, fontSize: "0.7rem", fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 14,
            }}>
              Enterprise
            </span>
            <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
              Segurança de Nível Empresarial
            </h2>
            <p style={{ fontSize: "1rem", color: "var(--text-secondary)", maxWidth: 500, margin: "0 auto" }}>
              Construída para atender os requisitos mais exigentes de DPOs, CTOs e auditorias da ANPD.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 22 }}>
            {[
              {
                icon: <KeyIcon />,
                title: "Isolamento Multi-Tenant",
                iconColor: "var(--accent)", iconBg: "var(--accent-subtle)",
                items: [
                  "JWT Bearer Token nativo via Supabase Auth",
                  "Tenant ID validado em cada requisição",
                  "Dados nunca compartilhados entre tenants",
                  "API Keys estáveis por tenant com rotação",
                ],
              },
              {
                icon: <ZapIcon />,
                title: "Integração Programável",
                iconColor: "#8B5CF6", iconBg: "rgba(139,92,246,0.1)",
                items: [
                  "API RESTful com OpenAPI/Swagger completo",
                  "API Keys por tenant para HubSpot e Salesforce",
                  "Webhooks assíncronos com HMAC-SHA256",
                  "Chunking automático de CSV até 100k linhas",
                ],
              },
              {
                icon: <ScaleIcon />,
                title: "Conformidade ANPD",
                iconColor: "var(--success)", iconBg: "var(--success-subtle)",
                items: [
                  "Direito ao Esquecimento — Art. 18 LGPD nativo",
                  "Logs de auditoria por operação e operador",
                  "Mascaramento obrigatório antes do armazenamento",
                  "Validação humana forçada para dados sensíveis",
                ],
              },
            ].map(card => (
              <div key={card.title} style={{
                backgroundColor: "var(--bg-base)", border: "1px solid var(--border)",
                borderRadius: 18, padding: "30px 26px", boxShadow: "var(--shadow-sm)",
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 12,
                  backgroundColor: card.iconBg, color: card.iconColor,
                  display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20,
                }}>
                  {card.icon}
                </div>
                <h3 style={{ fontSize: "1.02rem", fontWeight: 700, marginBottom: 16, letterSpacing: "-0.02em" }}>{card.title}</h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  {card.items.map(item => (
                    <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: "0.84rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      <span style={{ flexShrink: 0, marginTop: 2 }}><CheckIcon color={card.iconColor} /></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: "96px clamp(16px, 5vw, 80px)" }}>
        <div style={W}>
          <div style={{ textAlign: "center", marginBottom: 60 }}>
            <span style={{
              display: "inline-block", padding: "4px 14px",
              backgroundColor: "var(--accent-subtle)", color: "var(--accent-text)",
              borderRadius: 20, fontSize: "0.7rem", fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 14,
            }}>
              Planos
            </span>
            <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
              Preços Transparentes por Volume
            </h2>
            <p style={{ fontSize: "1rem", color: "var(--text-secondary)", maxWidth: 460, margin: "0 auto" }}>
              Pague proporcionalmente ao uso. Sem surpresas, sem lock-in.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22, maxWidth: 940, margin: "0 auto" }}>
            {(plans.length > 0 ? plans : [
              { plan_name: "starter", price_monthly: 0 },
              { plan_name: "pro",     price_monthly: 497 },
              { plan_name: "enterprise", price_monthly: -1 },
            ]).map(p => {
              const meta = PLAN_META[p.plan_name] ?? PLAN_META["starter"];
              const { label, period } = formatPrice(p.plan_name, p.price_monthly);
              return (
                <div key={p.plan_name} style={{
                  backgroundColor: meta.highlight ? "var(--accent)" : "var(--bg-surface)",
                  border: meta.highlight ? "2px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 18, padding: "34px 26px",
                  boxShadow: meta.highlight ? "0 8px 32px rgba(59,130,246,.3)" : "var(--shadow-sm)",
                  position: "relative",
                }}>
                  {meta.highlight && (
                    <div style={{
                      position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)",
                      backgroundColor: "#fff", color: "var(--accent)",
                      padding: "3px 14px", borderRadius: 20,
                      fontSize: "0.67rem", fontWeight: 800,
                      border: "2px solid var(--accent)", letterSpacing: "0.06em",
                      textTransform: "uppercase" as const, whiteSpace: "nowrap" as const,
                    }}>
                      Mais Popular
                    </div>
                  )}
                  <div style={{ marginBottom: 4 }}>
                    <span style={{
                      fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em",
                      textTransform: "uppercase" as const,
                      color: meta.highlight ? "rgba(255,255,255,0.75)" : "var(--text-muted)",
                    }}>
                      {p.plan_name}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                    <span style={{
                      fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.04em",
                      color: meta.highlight ? "#fff" : "var(--text-primary)",
                    }}>
                      {label}
                    </span>
                    {period && (
                      <span style={{ fontSize: "0.82rem", color: meta.highlight ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}>
                        {period}
                      </span>
                    )}
                  </div>
                  <p style={{
                    fontSize: "0.82rem", lineHeight: 1.55, marginBottom: 22,
                    color: meta.highlight ? "rgba(255,255,255,0.8)" : "var(--text-secondary)",
                  }}>
                    {meta.desc}
                  </p>
                  <Link href={meta.ctaHref} style={{
                    display: "block", textAlign: "center", padding: "10px 0",
                    backgroundColor: meta.highlight ? "#fff" : "var(--accent)",
                    color: meta.highlight ? "var(--accent)" : "#fff",
                    borderRadius: 10, textDecoration: "none",
                    fontSize: "0.86rem", fontWeight: 700, marginBottom: 22,
                  }}>
                    {meta.cta}
                  </Link>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 9 }}>
                    {meta.features.map(f => (
                      <li key={f} style={{
                        display: "flex", alignItems: "flex-start", gap: 8,
                        fontSize: "0.82rem", lineHeight: 1.45,
                        color: meta.highlight ? "rgba(255,255,255,0.9)" : "var(--text-secondary)",
                      }}>
                        <span style={{ flexShrink: 0, marginTop: 1 }}>
                          <CheckIcon color={meta.highlight ? "#fff" : "var(--success)"} />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ─────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px clamp(16px, 5vw, 80px)", backgroundColor: "var(--accent)" }}>
        <div style={{ ...W, textAlign: "center" }}>
          <h2 style={{
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 800, color: "#fff",
            letterSpacing: "-0.03em", marginBottom: 14,
          }}>
            Elimine o Risco de Multas da ANPD
          </h2>
          <p style={{
            fontSize: "1.02rem", color: "rgba(255,255,255,0.82)",
            maxWidth: 500, margin: "0 auto 34px", lineHeight: 1.6,
          }}>
            Empresas com mais de 50 mil clientes já estão expostas. Cada dia sem governança é responsabilidade direta do DPO.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/register" style={{
              padding: "13px 30px", backgroundColor: "#fff", color: "var(--accent)",
              borderRadius: 10, textDecoration: "none", fontSize: "0.9rem", fontWeight: 700,
              boxShadow: "0 4px 16px rgba(0,0,0,.15)",
            }}>
              Criar Conta Gratuita
            </Link>
            <Link href="/login" style={{
              padding: "13px 30px", backgroundColor: "transparent", color: "#fff",
              borderRadius: 10, textDecoration: "none", fontSize: "0.9rem", fontWeight: 600,
              border: "2px solid rgba(255,255,255,0.5)",
            }}>
              Já tenho conta →
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────────── */}
      <footer style={{
        backgroundColor: "var(--bg-surface)", borderTop: "1px solid var(--border)",
        padding: "56px clamp(16px, 5vw, 80px) 36px",
      }}>
        <div style={W}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 40, marginBottom: 44 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ color: "var(--accent)" }}><ShieldIcon size={18} /></div>
                <span style={{ fontSize: "0.9rem", fontWeight: 700, letterSpacing: "-0.02em" }}>Trust & Tandem AI</span>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 210 }}>
                Governança de dados com IA, conformidade LGPD e Human-in-the-Loop para médias e grandes empresas.
              </p>
            </div>

            <div>
              <h4 style={{
                fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)",
                letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 14,
              }}>
                Produto
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { label: "Funcionalidades", href: "#features" },
                  { label: "Segurança Enterprise", href: "#enterprise" },
                  { label: "Planos e Preços", href: "#pricing" },
                  { label: "Documentação da API", href: "/login" },
                ].map(l => (
                  <a key={l.label} href={l.href} style={{ fontSize: "0.83rem", color: "var(--text-secondary)", textDecoration: "none" }}>
                    {l.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 style={{
                fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)",
                letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 14,
              }}>
                Legal & Conformidade
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  "Política de Privacidade",
                  "Termos de Serviço",
                  "LGPD — Art. 18 (DPA)",
                  "Relatório de Conformidade ANPD",
                ].map(l => (
                  <a key={l} href="#" style={{ fontSize: "0.83rem", color: "var(--text-secondary)", textDecoration: "none" }}>
                    {l}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h4 style={{
                fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)",
                letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 14,
              }}>
                Acesso
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Link href="/login" style={{
                  padding: "8px 0", textAlign: "center",
                  backgroundColor: "var(--bg-base)", border: "1px solid var(--border)",
                  borderRadius: 8, color: "var(--text-primary)", textDecoration: "none",
                  fontSize: "0.82rem", fontWeight: 600,
                }}>
                  Entrar
                </Link>
                <Link href="/register" style={{
                  padding: "8px 0", textAlign: "center",
                  backgroundColor: "var(--accent)", borderRadius: 8,
                  color: "#fff", textDecoration: "none",
                  fontSize: "0.82rem", fontWeight: 700,
                }}>
                  Criar Conta
                </Link>
              </div>
            </div>
          </div>

          <div style={{
            paddingTop: 22, borderTop: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
          }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              © {new Date().getFullYear()} Bitzen Software — Todos os direitos reservados.
            </span>
            <div style={{ display: "flex", gap: 16 }}>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>🔒 LGPD Compliant</span>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>🇧🇷 Lei 13.709/2018</span>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>🛡️ Powered by Agente IA</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
