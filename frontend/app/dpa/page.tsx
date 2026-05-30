import Link from "next/link";

export default function DpaPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/" className="text-lg font-bold text-gray-900">Trust &amp; Tandem AI</Link>
        <Link href="/login" className="text-sm text-blue-600 hover:underline">Entrar</Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Acordo de Processamento de Dados</h1>
        <p className="text-sm text-gray-400 mb-2">Data Processing Agreement (DPA)</p>
        <p className="text-sm text-gray-400 mb-10">Vigência: 1 de janeiro de 2026 · Bitzen Software</p>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-10 text-sm text-blue-800">
          Este DPA é incorporado automaticamente aos Termos de Serviço quando o Cliente utiliza a Plataforma. Para contratos Enterprise com cláusulas personalizadas, entre em contato: <a href="mailto:dpo@bitzen.app" className="underline">dpo@bitzen.app</a>
        </div>

        <div className="space-y-8 text-sm text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Partes e Papéis</h2>
            <p><strong>Operador:</strong> Bitzen Software, que processa Dados Pessoais em nome do Cliente conforme as instruções deste DPA.</p>
            <p className="mt-2"><strong>Controlador:</strong> O Cliente, que determina as finalidades e os meios do tratamento dos Dados Ingeridos.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Natureza do Tratamento</h2>
            <table className="w-full text-xs border-collapse mt-2">
              <tbody>
                {[
                  ["Finalidade", "Validação de conformidade LGPD dos registos submetidos pelo Controlador"],
                  ["Tipos de dados", "Nome, CPF, e-mail, e outros campos submetidos via API ou CSV"],
                  ["Titulares", "Terceiros cujos dados foram coletados pelo Controlador"],
                  ["Duração", "Enquanto o contrato estiver vigente; expurgo em 30 dias após rescisão"],
                ].map(([k, v]) => (
                  <tr key={k} className="border-b border-gray-100">
                    <td className="p-2 border border-gray-200 font-medium w-32">{k}</td>
                    <td className="p-2 border border-gray-200">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">3. Obrigações do Operador (Bitzen)</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Tratar os Dados Pessoais exclusivamente conforme as instruções documentadas do Controlador.</li>
              <li>Garantir que as pessoas autorizadas a tratar os dados estejam sujeitas a obrigações de confidencialidade.</li>
              <li>Implementar e manter medidas técnicas e organizacionais adequadas (Art. 46 LGPD).</li>
              <li>Assistir o Controlador no cumprimento de obrigações relativas a direitos dos titulares.</li>
              <li>Notificar o Controlador de qualquer violação de dados em até 24 horas após ciência.</li>
              <li>Eliminar ou devolver todos os Dados Pessoais ao término do serviço, conforme instrução do Controlador.</li>
              <li>Disponibilizar todas as informações necessárias para demonstrar conformidade e cooperar em auditorias.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">4. Obrigações do Controlador (Cliente)</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Garantir que possui base legal válida (LGPD) para submeter os dados dos titulares à Plataforma.</li>
              <li>Fornecer instruções claras e documentadas sobre o tratamento pretendido.</li>
              <li>Notificar a Bitzen sobre quaisquer exercícios de direitos de titulares que exijam ação do Operador.</li>
              <li>Assegurar a exatidão e relevância dos dados submetidos.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">5. Suboperadores</h2>
            <p>O Controlador autoriza o uso dos seguintes suboperadores. A Bitzen permanece responsável pelos atos dos suboperadores como se fossem seus:</p>
            <table className="w-full text-xs border-collapse mt-2">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2 border border-gray-200">Suboperador</th>
                  <th className="text-left p-2 border border-gray-200">Finalidade</th>
                  <th className="text-left p-2 border border-gray-200">Localização</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Supabase Inc.", "Armazenamento de banco de dados (PostgreSQL)", "EUA / UE"],
                  ["Anthropic PBC", "Inferência de IA (dados parcialmente mascarados)", "EUA"],
                  ["Render Inc.", "Hospedagem da API backend", "EUA"],
                  ["Vercel Inc.", "Hospedagem do frontend web", "EUA"],
                ].map(([s, f, l]) => (
                  <tr key={s} className="border-b border-gray-100">
                    <td className="p-2 border border-gray-200 font-medium">{s}</td>
                    <td className="p-2 border border-gray-200">{f}</td>
                    <td className="p-2 border border-gray-200">{l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3">A Bitzen notificará o Controlador de qualquer alteração nos suboperadores com 15 dias de antecedência, concedendo direito de objeção.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">6. Transferências Internacionais</h2>
            <p>Os dados podem ser processados nos EUA pelos suboperadores listados. A Bitzen garante que tais transferências são realizadas com base em cláusulas contratuais padrão (SCCs) ou equivalentes, conforme exigido pela LGPD e regulamentações da ANPD.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">7. Medidas de Segurança</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Autenticação JWT com isolamento multi-tenant por Row-Level Security.</li>
              <li>Dados brutos mascarados na borda; modelos de IA recebem apenas hints parciais.</li>
              <li>Criptografia em trânsito (TLS 1.3) e em repouso (AES-256 via Supabase).</li>
              <li>Logs de auditoria imutáveis para todas as operações de acesso e expurgo.</li>
              <li>Testes de penetração periódicos e revisão de código focada em segurança.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Direitos dos Titulares</h2>
            <p>Quando o Controlador receber solicitação de titular (acesso, retificação, exclusão, portabilidade), a Bitzen assistirá mediante solicitação via <a href="mailto:dpo@bitzen.app" className="text-blue-600 hover:underline">dpo@bitzen.app</a>, no prazo de 5 dias úteis.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">9. Vigência e Rescisão</h2>
            <p>Este DPA entra em vigor na data de aceitação dos Termos de Serviço e permanece vigente enquanto a Bitzen processar Dados Pessoais em nome do Controlador. Após rescisão, aplica-se o Art. 16 da LGPD para eliminação ou anonimização.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Contato DPO</h2>
            <p>Encarregado de Dados: <a href="mailto:dpo@bitzen.app" className="text-blue-600 hover:underline">dpo@bitzen.app</a></p>
            <p className="mt-1">Para versão personalizada (Enterprise): <a href="mailto:vendas@bitzen.app" className="text-blue-600 hover:underline">vendas@bitzen.app</a></p>
          </section>

        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 mt-16">
        <div className="max-w-3xl mx-auto px-6 flex gap-6 text-sm text-gray-400">
          <Link href="/privacy" className="hover:text-gray-600">Política de Privacidade</Link>
          <Link href="/terms" className="hover:text-gray-600">Termos de Serviço</Link>
          <Link href="/" className="hover:text-gray-600">Início</Link>
        </div>
      </footer>
    </div>
  );
}
