"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { translations, Lang, T } from "./translations";

type LangCtxType = { lang: Lang; setLang: (l: Lang) => void; t: T };

const LangCtx = createContext<LangCtxType>({
  lang: "pt-BR",
  setLang: () => {},
  t: translations["pt-BR"] as T,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("pt-BR");

  useEffect(() => {
    const saved = localStorage.getItem("lang") as Lang | null;
    if (saved && saved in translations) setLangState(saved as Lang);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("lang", l);
  }

  return (
    <LangCtx.Provider value={{ lang, setLang, t: translations[lang] as T }}>
      {children}
    </LangCtx.Provider>
  );
}

export function useTranslation() {
  return useContext(LangCtx);
}

const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "pt-BR", label: "Português", flag: "🇧🇷" },
  { code: "en",    label: "English",   flag: "🇺🇸" },
];

export function LangSelector({ style }: { style?: React.CSSProperties }) {
  const { lang, setLang } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGS.find(l => l.code === lang) ?? LANGS[0];

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          backgroundColor: "var(--bg-surface)",
          color: "var(--text-secondary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: "0.75rem",
          fontWeight: 500,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <span>{current.flag}</span>
        <span>{current.label}</span>
        <span style={{ opacity: 0.5, fontSize: "0.6rem" }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "var(--shadow-md)",
            minWidth: 150,
            overflow: "hidden",
            zIndex: 200,
          }}
        >
          {LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => { setLang(l.code); setOpen(false); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "10px 14px",
                fontSize: "0.82rem",
                color: "var(--text-primary)",
                backgroundColor: lang === l.code ? "var(--accent-subtle)" : "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontWeight: lang === l.code ? 600 : 400,
              }}
            >
              <span>{l.flag}</span>
              <span style={{ flex: 1 }}>{l.label}</span>
              {lang === l.code && (
                <span style={{ color: "var(--accent)", fontSize: "0.75rem" }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
