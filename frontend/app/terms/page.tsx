import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/" className="text-lg font-bold text-gray-900">Trust &amp; Tandem AI</Link>
        <Link href="/login" className="text-sm text-blue-600 hover:underline">Entrar</Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Termos de Serviço</h1>
        <p className="text-sm text-gray-400 mb-10">Vigência: 1 de janeiro de 2026 · Bitzen Software</p>

        <div className="space-y-8 text-sm text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Definições</h2>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>"Bitzen"</strong> — Bitzen Software, fornecedora da plataforma Trust &amp; Tandem AI.</li>
              <li><strong>"Cliente"</strong> — pessoa jurídica ou física que contrata o serviço e opera como controlador dos dados que ingere.</li>
              <li><strong>"Plataforma"</strong> — conjunto de API, painel web e ferramentas de conformidade LGPD disponibilizados sob estes termos.</li>
              <li><strong>"Dados Ingeridos"</strong> — registos de terceiros submetidos pelo Cliente para validação.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Aceitação</h2>
            <p>Ao criar uma conta ou utilizar a Plataforma, o Cliente aceita estes Termos na íntegra. Se o Cliente não concordar, deve abster-se de usar o serviço.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">3. Licença de Uso</h2>
            <p>A Bitzen concede ao Cliente uma licença não exclusiva, intransferível e revogável para acessar a Plataforma durante a vigência do plano contratado, exclusivamente para os fins descritos nestes Termos.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">4. Planos e Pagamento</h2>
            <table className="w-full text-xs border-collapse mt-2">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2 border border-gray-200">Plano</th>
                  <th className="text-left p-2 border border-gray-200">Valor</th>
                  <th className="text-left p-2 border border-gray-200">Limite de Registos</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Trial", "Gratuito (15 dias)", "500 registos"],
                  ["Business", "R$ 497/mês", "10.000 registos/mês"],
                  ["Professional", "R$ 1.490/mês", "100.000 registos/mês"],
                  ["Enterprise", "Sob consulta", "Ilimitado"],
                ].map(([p, v, l]) => (
                  <tr key={p} className="border-b border-gray-100">
                    <td className="p-2 border border-gray-200 font-medium">{p}</td>
                    <td className="p-2 border border-gray-200">{v}</td>
                    <td className="p-2 border border-gray-200">{l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3">A cobrança é mensal, antecipada. Planos pagos renovam automaticamente salvo cancelamento com 30 dias de antecedência.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">5. Responsabilidades do Cliente</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>O Cliente é o <strong>controlador</strong> dos Dados Ingeridos e é responsável pela legalidade da coleta original.</li>
              <li>O Cliente deve possuir base legal adequada (LGPD) antes de submeter dados de terceiros à Plataforma.</li>
              <li>O Cliente não pode submeter dados de crianças e adolescentes sem consentimento parental específico.</li>
              <li>Uso abusivo (tentativa de exfiltrar dados de outros tenants, fuzzing, DoS) resultará em suspensão imediata.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">6. Responsabilidades da Bitzen</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Manter disponibilidade conforme SLA do plano contratado (99,9% para Professional e Enterprise).</li>
              <li>Notificar incidentes de segurança em até 72 horas após ciência (Art. 48 LGPD).</li>
              <li>Não acessar os Dados Ingeridos do Cliente além do estritamente necessário para prestação do serviço.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">7. Limitação de Responsabilidade</h2>
            <p>A responsabilidade total da Bitzen perante o Cliente, por qualquer causa, limita-se ao valor pago nos 3 meses anteriores ao evento. A Bitzen não responde por danos indiretos, lucros cessantes ou multas regulatórias impostas ao Cliente.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Propriedade Intelectual</h2>
            <p>Todos os direitos sobre a Plataforma pertencem à Bitzen. O Cliente retém todos os direitos sobre os Dados Ingeridos. Ao submeter dados, o Cliente concede à Bitzen licença limitada para processar esses dados exclusivamente para prestação do serviço.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">9. Confidencialidade</h2>
            <p>Ambas as partes comprometem-se a não divulgar informações confidenciais da outra parte. Os Dados Ingeridos são considerados confidenciais da mais alta categoria.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Rescisão</h2>
            <p>Qualquer parte pode rescindir com 30 dias de aviso prévio. A Bitzen pode suspender ou encerrar o serviço imediatamente em caso de violação dos Termos. Após rescisão, os dados do Cliente são eliminados em 30 dias.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">11. Lei Aplicável e Foro</h2>
            <p>Estes Termos regem-se pela lei brasileira. Fica eleito o foro da Comarca de São Paulo/SP para dirimir quaisquer controvérsias, excluindo qualquer outro, por mais privilegiado que seja.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">12. Contato</h2>
            <p>Bitzen Software · <a href="mailto:contato@bitzen.app" className="text-blue-600 hover:underline">contato@bitzen.app</a></p>
          </section>

        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 mt-16">
        <div className="max-w-3xl mx-auto px-6 flex gap-6 text-sm text-gray-400">
          <Link href="/privacy" className="hover:text-gray-600">Política de Privacidade</Link>
          <Link href="/dpa" className="hover:text-gray-600">DPA</Link>
          <Link href="/" className="hover:text-gray-600">Início</Link>
        </div>
      </footer>
    </div>
  );
}
