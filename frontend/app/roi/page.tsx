"use client";

import { useState } from "react";
import Link from "next/link";

export default function RoiPage() {
  const [records, setRecords] = useState(10000);
  const [sector, setSector] = useState("saude");
  const [incidents, setIncidents] = useState(1);

  const sectorMultiplier: Record<string, number> = {
    saude: 2.1,
    financeiro: 1.8,
    varejo: 1.2,
    educacao: 1.0,
    tecnologia: 1.4,
  };

  const baseCostPerRecord = 719; // R$ 719 per record (IBM Cost of a Data Breach 2025 BR)
  const maxFine = 50_000_000;
  const avgBreach = 7_190_000;

  const multiplier = sectorMultiplier[sector] ?? 1.0;
  const exposedCost = Math.min(records * baseCostPerRecord * multiplier, maxFine * incidents);
  const annualRisk = exposedCost * 0.27; // 27% probability of breach in 2 years (IBM)
  const platformCost = 497 * 12; // Business plan annual
  const roi = ((annualRisk - platformCost) / platformCost) * 100;

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `R$${(n / 1_000_000).toFixed(1)}M`
      : `R$${n.toLocaleString("pt-BR")}`;

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/" className="text-lg font-bold text-gray-900">Trust &amp; Tandem AI</Link>
        <div className="flex items-center gap-4">
          <Link href="/#pricing" className="text-sm text-gray-600 hover:text-gray-900">Planos</Link>
          <Link href="/register" className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            Começar grátis
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Calculadora de Risco LGPD</h1>
          <p className="text-gray-500 text-lg">Estime o risco financeiro da sua empresa em caso de violação de dados e o retorno do investimento na conformidade.</p>
        </div>

        <div className="grid grid-cols-2 gap-10">
          {/* Inputs */}
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">Dados da sua empresa</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Registos de dados pessoais tratados
              </label>
              <input
                type="range" min={1000} max={1000000} step={1000}
                value={records}
                onChange={(e) => setRecords(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>1k</span>
                <span className="font-medium text-blue-600">{records.toLocaleString("pt-BR")} registos</span>
                <span>1M</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Setor</label>
              <select
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="saude">Saúde (maior risco)</option>
                <option value="financeiro">Financeiro</option>
                <option value="tecnologia">Tecnologia</option>
                <option value="varejo">Varejo</option>
                <option value="educacao">Educação</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Incidentes de segurança nos últimos 3 anos
              </label>
              <div className="flex gap-3">
                {[0, 1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setIncidents(Math.max(1, n) )}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      incidents === Math.max(1, n)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {n === 0 ? "Nenhum" : n}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
              <p>Baseado em: IBM Cost of a Data Breach Report 2025 (Brasil)</p>
              <p>Custo médio por registo violado: R$719</p>
              <p>Probabilidade de incidente em 2 anos: 27%</p>
              <p>Multa máxima ANPD (Lei 15.352/2026): R$50M</p>
            </div>
          </div>

          {/* Results */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Seu risco estimado</h2>

            <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Exposição máxima</p>
              <p className="text-4xl font-black text-red-600">{fmt(exposedCost)}</p>
              <p className="text-xs text-red-400 mt-1">Custo de uma violação total dos seus dados</p>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
              <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-1">Risco anual ponderado</p>
              <p className="text-4xl font-black text-orange-600">{fmt(annualRisk)}</p>
              <p className="text-xs text-orange-400 mt-1">Exposição × probabilidade de incidente (27%)</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
              <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1">Custo da plataforma (anual)</p>
              <p className="text-4xl font-black text-blue-600">{fmt(platformCost)}</p>
              <p className="text-xs text-blue-400 mt-1">Plano Business — R$497/mês × 12</p>
            </div>

            <div className={`rounded-2xl p-5 ${roi > 0 ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${roi > 0 ? "text-green-500" : "text-gray-500"}`}>ROI da conformidade</p>
              <p className={`text-4xl font-black ${roi > 0 ? "text-green-600" : "text-gray-600"}`}>
                {roi > 0 ? `${roi.toFixed(0)}%` : "—"}
              </p>
              <p className={`text-xs mt-1 ${roi > 0 ? "text-green-400" : "text-gray-400"}`}>
                {roi > 0
                  ? `Para cada R$1 investido, você protege ${(annualRisk / platformCost).toFixed(0)}x mais.`
                  : "Com poucos registos, o custo da não-conformidade é menor — mas o risco reputacional persiste."}
              </p>
            </div>

            <Link
              href="/register"
              className="block w-full text-center bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors mt-2"
            >
              Começar grátis — sem cartão
            </Link>
            <Link
              href="mailto:demo@bitzen.app"
              className="block w-full text-center border border-gray-300 text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-50 transition-colors text-sm"
            >
              Agendar demonstração
            </Link>
          </div>
        </div>

        {/* Context */}
        <div className="mt-16 bg-gray-50 rounded-2xl p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6 text-center">O contexto regulatório</h2>
          <div className="grid grid-cols-3 gap-6 text-center">
            {[
              { value: "R$7,19M", label: "Custo médio de violação no Brasil", source: "IBM 2025" },
              { value: "R$50M", label: "Multa máxima ANPD por infração", source: "Lei 15.352/2026" },
              { value: "27%", label: "Prob. de incidente em 2 anos", source: "IBM 2025" },
            ].map(({ value, label, source }) => (
              <div key={value}>
                <p className="text-3xl font-bold text-blue-600">{value}</p>
                <p className="text-sm text-gray-700 mt-1">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{source}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 mt-16">
        <div className="max-w-4xl mx-auto px-6 flex gap-6 text-sm text-gray-400">
          <Link href="/privacy" className="hover:text-gray-600">Política de Privacidade</Link>
          <Link href="/terms" className="hover:text-gray-600">Termos de Serviço</Link>
          <Link href="/dpa" className="hover:text-gray-600">DPA</Link>
          <Link href="/" className="hover:text-gray-600">Início</Link>
        </div>
      </footer>
    </div>
  );
}
