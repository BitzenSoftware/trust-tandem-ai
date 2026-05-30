import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/" className="text-lg font-bold text-gray-900">Trust &amp; Tandem AI</Link>
        <Link href="/login" className="text-sm text-blue-600 hover:underline">Entrar</Link>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Política de Privacidade</h1>
        <p className="text-sm text-gray-400 mb-10">Vigência: 1 de janeiro de 2026 · Bitzen Software</p>

        <div className="prose prose-gray max-w-none space-y-8 text-sm text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Identificação do Controlador</h2>
            <p>A Bitzen Software ("Bitzen", "nós", "nosso") é a empresa responsável pelo tratamento de dados pessoais coletados por meio da plataforma Trust &amp; Tandem AI, disponível em <strong>trust-tandem-ai.vercel.app</strong> e APIs relacionadas.</p>
            <p className="mt-2">Encarregado de Dados (DPO): <a href="mailto:dpo@bitzen.app" className="text-blue-600 hover:underline">dpo@bitzen.app</a></p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Dados Coletados</h2>
            <p>Coletamos apenas os dados estritamente necessários para a prestação do serviço:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong>Dados de conta:</strong> e-mail e senha (autenticação via Supabase Auth).</li>
              <li><strong>Dados de empresa:</strong> nome da empresa fornecido no registo.</li>
              <li><strong>Dados ingeridos pelo cliente:</strong> registos enviados via API ou CSV para validação LGPD (nome, CPF, e-mail de terceiros). Estes dados são tratados como dados de operador — a responsabilidade pelo seu tratamento é do cliente (controlador final).</li>
              <li><strong>Logs de auditoria:</strong> timestamps de operações de expurgo e aprovação (sem dados sensíveis em claro).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">3. Finalidade e Base Legal</h2>
            <table className="w-full text-xs border-collapse mt-2">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2 border border-gray-200">Dado</th>
                  <th className="text-left p-2 border border-gray-200">Finalidade</th>
                  <th className="text-left p-2 border border-gray-200">Base Legal (LGPD)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["E-mail / senha", "Autenticação e acesso à plataforma", "Art. 7º, V — execução de contrato"],
                  ["Nome da empresa", "Isolamento multi-tenant e faturamento", "Art. 7º, V — execução de contrato"],
                  ["Dados ingeridos", "Validação de conformidade LGPD do cliente", "Art. 7º, V — execução de contrato"],
                  ["Logs de auditoria", "Rastreabilidade para fiscalização ANPD", "Art. 7º, II — obrigação legal"],
                ].map(([d, f, b]) => (
                  <tr key={d} className="border-b border-gray-100">
                    <td className="p-2 border border-gray-200">{d}</td>
                    <td className="p-2 border border-gray-200">{f}</td>
                    <td className="p-2 border border-gray-200">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">4. Mascaramento e Minimização</h2>
            <p>Os dados brutos ingeridos (CPF, e-mail completo) <strong>nunca são transmitidos a modelos de IA externos</strong>. Apenas hints parciais (primeiros 3 caracteres) são utilizados para diagnóstico. O mascaramento ocorre na borda da aplicação, antes de qualquer chamada à API da Anthropic.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">5. Compartilhamento de Dados</h2>
            <p>Não vendemos nem compartilhamos dados pessoais com terceiros para fins comerciais. Os dados são processados pelos seguintes suboperadores:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong>Supabase Inc.</strong> — armazenamento de banco de dados (PostgreSQL) com isolamento por tenant.</li>
              <li><strong>Anthropic PBC</strong> — inferência de IA, recebendo apenas dados parcialmente mascarados.</li>
              <li><strong>Render Inc.</strong> / <strong>Vercel Inc.</strong> — hospedagem de API e frontend.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">6. Direitos do Titular (Art. 18 LGPD)</h2>
            <p>O titular pode exercer os seguintes direitos a qualquer momento:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Confirmação da existência de tratamento</li>
              <li>Acesso aos dados</li>
              <li>Correção de dados incompletos ou inexatos</li>
              <li>Anonimização, bloqueio ou eliminação</li>
              <li>Portabilidade</li>
              <li>Revogação do consentimento</li>
            </ul>
            <p className="mt-2">Solicitações: <a href="mailto:privacidade@bitzen.app" className="text-blue-600 hover:underline">privacidade@bitzen.app</a> — prazo de resposta: 15 dias úteis.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">7. Retenção e Exclusão</h2>
            <p>Dados de conta são mantidos enquanto o contrato estiver ativo. Dados ingeridos podem ser expurgados pelo operador a qualquer momento via painel (Art. 18). Após o encerramento da conta, todos os dados são eliminados em até 30 dias.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Segurança</h2>
            <p>A plataforma implementa: autenticação JWT assinada, isolamento multi-tenant por Row-Level Security no PostgreSQL, criptografia em trânsito (TLS 1.3), e logs de auditoria imutáveis para todas as operações de expurgo.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">9. Alterações nesta Política</h2>
            <p>Notificaremos alterações materiais por e-mail com 15 dias de antecedência. O uso continuado da plataforma após esse prazo constitui aceitação.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Contato</h2>
            <p>Bitzen Software · <a href="mailto:privacidade@bitzen.app" className="text-blue-600 hover:underline">privacidade@bitzen.app</a></p>
          </section>

        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 mt-16">
        <div className="max-w-3xl mx-auto px-6 flex gap-6 text-sm text-gray-400">
          <Link href="/terms" className="hover:text-gray-600">Termos de Serviço</Link>
          <Link href="/dpa" className="hover:text-gray-600">DPA</Link>
          <Link href="/" className="hover:text-gray-600">Início</Link>
        </div>
      </footer>
    </div>
  );
}
