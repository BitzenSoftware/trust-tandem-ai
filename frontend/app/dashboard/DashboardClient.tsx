"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL + "/api/v1";

type CleanRecord = { name: string; email: string; cpf: string };
type QueueItem = { name: string; email_hint: string; cpf_hint: string };

export default function DashboardClient({ token, userName }: { token: string; userName: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"dashboard" | "queue">("dashboard");
  const [db, setDb] = useState<CleanRecord[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [diagnoses, setDiagnoses] = useState<Record<string, string>>({});

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [dbRes, qRes] = await Promise.all([
      fetch(`${API}/database`, { headers }),
      fetch(`${API}/review-queue`, { headers }),
    ]);
    if (dbRes.ok) setDb(await dbRes.json());
    if (qRes.ok) setQueue(await qRes.json());
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleExpurge(name: string) {
    await fetch(`${API}/review-queue/${encodeURIComponent(name)}`, { method: "DELETE", headers });
    fetchData();
  }

  async function handleDiagnose(name: string) {
    if (diagnoses[name]) return;
    const res = await fetch(`${API}/analyze/${encodeURIComponent(name)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      setDiagnoses((prev) => ({ ...prev, [name]: data.diagnostico }));
    }
  }

  const conformidade = db.length + queue.length > 0
    ? ((db.length / (db.length + queue.length)) * 100).toFixed(1)
    : "100.0";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Trust & Tandem AI</h1>
          <p className="text-xs text-gray-500">Governança de Dados LGPD</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{userName}</span>
          <button onClick={handleLogout} className="text-sm text-red-500 hover:underline">
            Sair
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <nav className="flex gap-6">
          {(["dashboard", "queue"] as const).map((t) => (
            <button
              key={t} onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "dashboard" ? "Dashboard" : `Fila de Revisão ${queue.length > 0 ? `(${queue.length})` : ""}`}
            </button>
          ))}
        </nav>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <p className="text-gray-500 text-sm">A carregar...</p>
        ) : tab === "dashboard" ? (
          <>
            {/* Métricas */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[
                { label: "Total de Ingestões", value: db.length + queue.length },
                { label: "Taxa de Conformidade LGPD", value: `${conformidade}%` },
                { label: "Banco de Dados Seguro", value: db.length },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className="text-2xl font-bold text-gray-900">{value}</p>
                </div>
              ))}
            </div>

            {/* Tabela */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Banco de Dados Seguro</h2>
              </div>
              {db.length === 0 ? (
                <p className="text-sm text-gray-500 p-5">Nenhum registo ainda. Envie dados via /api/v1/ingest.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      {["Nome", "Email", "CPF"].map((h) => (
                        <th key={h} className="text-left px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {db.map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                        <td className="px-5 py-3 text-gray-600 font-mono text-xs">{r.email}</td>
                        <td className="px-5 py-3 text-gray-600 font-mono text-xs">{r.cpf}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          /* Fila de Revisão */
          <div className="space-y-4">
            {queue.length === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
                <p className="text-green-700 font-medium">Fila limpa — nenhuma acao necessaria.</p>
              </div>
            ) : (
              queue.map((item, i) => (
                <div key={i} className="bg-white rounded-xl border border-orange-200 p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <span className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
                        Alerta #{i + 1}
                      </span>
                      <h3 className="font-semibold text-gray-900 mt-0.5">{item.name}</h3>
                    </div>
                    <button
                      onClick={() => handleExpurge(item.name)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      Expurgar (Art. 18 LGPD)
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Email (hint)</p>
                      <p className="font-mono text-sm text-gray-700">{item.email_hint}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">CPF (hint)</p>
                      <p className="font-mono text-sm text-gray-700">{item.cpf_hint}</p>
                    </div>
                  </div>
                  {diagnoses[item.name] ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                      <span className="font-semibold">Diagnostico Claude: </span>
                      {diagnoses[item.name]}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDiagnose(item.name)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Solicitar diagnostico Claude
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
