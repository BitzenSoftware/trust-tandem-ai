# Multi-Agent Pipeline

Trio de agentes Claude orquestrando tarefas técnicas com supervisão, execução e auditoria.

## Estrutura

```
├── agents/
│   ├── supervisor.txt   # Orquestrador: decompõe e delega
│   ├── executor.txt     # Especialista técnico: gera código/conteúdo
│   └── auditor.txt      # Auditor: segurança, qualidade, LGPD/GDPR
├── src/
│   └── main.py          # Orquestração do pipeline
└── README.md
```

## Fluxo

```
Usuário → Supervisor → Executor → Auditor
                          ↑           │
                          └─ REJEITADO┘ (até 2 retentativas)
                                      │
                                   APROVADO
                                      │
                               Supervisor (síntese final)
                                      │
                                   Usuário
```

## Setup

```bash
pip install anthropic
export ANTHROPIC_API_KEY="sua-chave-aqui"   # Linux/Mac
$env:ANTHROPIC_API_KEY="sua-chave-aqui"    # Windows PowerShell
```

## Uso

```bash
python src/main.py
```

## Configuração

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API Anthropic |
| `MODEL` | Modelo Claude usado (padrão: `claude-sonnet-4-6`) |
| `MAX_AUDIT_RETRIES` | Máximo de rejeições antes de desistir (padrão: `2`) |
