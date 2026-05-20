# Playbook de Governança e Arquitetura: Trust & Tandem AI

## 1. O Princípio "Human-in-the-loop" (HITL)

Nossa plataforma opera sob o princípio de **autonomia supervisionada**. A Inteligência Artificial (Claude) atua estritamente na camada de triagem, diagnóstico e recomendação. Nenhuma decisão de alteração ou exclusão de dados biográficos ou fiscais é tomada de forma autônoma sem o aval do Operador Humano.

## 2. Protocolo de Vazamento Zero (Privacy by Design)

Para garantir conformidade estrita com o **Art. 46 da LGPD**, o ecossistema adota a arquitetura de **Minimização de Logs de Interface**:

| Camada | Mecanismo | Garantia |
|---|---|---|
| API de Ingestão | Isolamento em memória volátil | Dados corrompidos nunca tocam o banco |
| Interface de Revisão | Mascaramento `_hint` (`joa…`) | IA e logs recebem apenas dica parcial |
| Pipeline Claude | Prompts sem dado bruto | Nenhum dado sensível entra no contexto LLM |
| Banco Seguro | Mascaramento criptográfico visual | Apenas dígitos verificadores preservados |

Se a sessão do terminal ou da interface web for gravada ou sofrer interceptação de tela, os dados do titular permanecem protegidos em todas as camadas.

## 3. Matriz de Papéis e Agentes

### Agente 1 — Supervisor (API FastAPI `src/api.py`)
Orquestra o fluxo de dados, gerencia as filas de revisão e expõe endpoints seguros com schemas Pydantic validados.

### Agente 2 — Executor (Motor de Máscara `src/masking.py`)
Aplica mascaramento defensivo e determinístico (regex `fullmatch`) antes de qualquer persistência. Retorna fallback `invalid_data***` para entradas inválidas sem quebrar o pipeline.

### Agente 3 — Auditor (Claude LLM via `GET /api/v1/analyze`)
Analisa semanticamente os erros na fila de revisão a partir dos hints parciais. Valida se a correção fornecida pelo humano cumpre as regras de integridade antes de reprocessar.

## 4. Fluxo de Dados Certificado

```
Fonte Externa
     │
     ▼
POST /api/v1/ingest
     │
     ├─► Dados válidos ──► mask() ──► /database (banco seguro)
     │
     └─► Dados inválidos ──► fila_revisao (memória volátil)
                                  │
                                  ▼
                        GET /api/v1/review-queue
                        (apenas email_hint / cpf_hint)
                                  │
                                  ▼
                        GET /api/v1/analyze/{name}
                        (Claude diagnostica via hints)
                                  │
                                  ▼
                        Operador Humano decide
                                  │
                                  ▼
                        POST /api/v1/resolve
                        (Claude valida → re-processa)
```

## 5. Conformidade Regulatória

| Artigo LGPD | Mecanismo de Cobertura |
|---|---|
| Art. 6º, III — Necessidade | Mascaramento aplica minimização de dados |
| Art. 46 — Segurança | Nenhum dado bruto trafega em logs ou prompts |
| Art. 18 — Direitos do Titular | Endpoint `/reset` e `/review-queue/{name}` permitem expurgo |
