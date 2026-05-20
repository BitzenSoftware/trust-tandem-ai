import os
import requests
import streamlit as st
import pandas as pd
from urllib.parse import quote

st.set_page_config(page_title="Trust & Tandem AI", page_icon="shield", layout="wide")

API = os.environ.get("API_BASE_URL", "https://trust-tandem-ai.onrender.com") + "/api/v1"
_API_KEY = os.environ.get("API_GATEWAY_KEY", "")
_HEADERS = {"X-API-Key": _API_KEY} if _API_KEY else {}

st.markdown("""
<style>
.stMetric { background-color:#ffffff; padding:15px; border-radius:10px; border:1px solid #e9ecef; }
</style>
""", unsafe_allow_html=True)

st.title("Trust & Tandem AI")
st.caption("Plataforma de Governança de Dados, Mitigação de Riscos e Simbiose Humano-IA")

# --- cache de diagnósticos Claude por sessão ---
if "diagnosticos" not in st.session_state:
    st.session_state.diagnosticos = {}

# --- dados da API ---
try:
    queue: list[dict] = requests.get(f"{API}/review-queue", headers=_HEADERS, timeout=5).json()
    db: list[dict]    = requests.get(f"{API}/database",      headers=_HEADERS, timeout=5).json()
except requests.exceptions.ConnectionError:
    st.error("API FastAPI offline. Execute: uvicorn src.api:app --reload")
    st.stop()

total = len(queue) + len(db)
taxa_conformidade = (len(db) / total * 100) if total > 0 else 100.0

# --- abas ---
tab_dash, tab_triagem, tab_docs = st.tabs([
    "Dashboard de Operacoes",
    "Centro de Triagem HITL",
    "Documentacao & API",
])

# ==========================================================
# ABA 1 — DASHBOARD
# ==========================================================
with tab_dash:
    st.markdown("### Indicadores de Compliance e Saúde de Dados")

    m1, m2, m3 = st.columns(3)
    m1.metric("Total de Ingestões", total)
    m2.metric("Taxa de Conformidade LGPD", f"{taxa_conformidade:.1f}%")
    m3.metric("Tempo Economizado (est.)", f"{len(db) * 15} min")

    st.divider()
    st.markdown("#### Banco de Dados Seguro")

    if db:
        df = pd.DataFrame(db)
        st.dataframe(df, use_container_width=True, hide_index=True)
        st.download_button(
            label="Exportar Relatorio de Impacto a Protecao de Dados (RIPD)",
            data=df.to_csv(index=False).encode("utf-8"),
            file_name="relatorio_compliance_trust_tandem.csv",
            mime="text/csv",
        )
    else:
        st.info("Nenhum registro no banco seguro ainda. Envie dados pelo endpoint /ingest.")

# ==========================================================
# ABA 2 — TRIAGEM HITL
# ==========================================================
with tab_triagem:
    st.markdown("### Tickets Retidos por Inconsistência Crítica")
    st.caption("A IA bloqueou estes registros para evitar vazamento ou penalidades. Atue abaixo:")

    if not queue:
        st.success("Fila de risco zerada. Nenhuma ação humana é necessária.")
        st.stop()

    for idx, item in enumerate(queue):
        name = item["name"]

        with st.expander(f"Alerta #{idx + 1} — {name}", expanded=True):
            c1, c2, c3 = st.columns([1, 1, 2])
            c1.text_input("E-mail (hint seguro)", value=item["email_hint"], disabled=True, key=f"eh_{idx}")
            c2.text_input("CPF (hint seguro)",    value=item["cpf_hint"],   disabled=True, key=f"ch_{idx}")

            # diagnóstico Claude real — chama API uma vez por registro por sessão
            if name not in st.session_state.diagnosticos:
                with c3:
                    with st.spinner("Claude analisando..."):
                        resp = requests.get(f"{API}/analyze/{quote(name)}", headers=_HEADERS, timeout=30)
                        st.session_state.diagnosticos[name] = (
                            resp.json()["diagnostico"] if resp.ok else "Diagnóstico indisponível."
                        )

            c3.info(f"Diagnostico Claude: {st.session_state.diagnosticos[name]}")

            st.divider()
            op = st.radio(
                "Decisao de Governanca:",
                ["Manter em Quarentena", "Corrigir e Validar", "Expurgar Registro (Art. 18 LGPD)"],
                key=f"op_{idx}",
                horizontal=True,
            )

            if op == "Corrigir e Validar":
                s1, s2 = st.columns(2)
                n_email = s1.text_input("Novo e-mail válido:", key=f"ne_{idx}")
                n_cpf   = s2.text_input("Novo CPF válido (11 dígitos):", key=f"nc_{idx}")

                if st.button("Aprovar Entrada", key=f"btn_ok_{idx}", type="primary"):
                    if not n_email or not n_cpf:
                        st.error("Preencha os dois campos antes de enviar.")
                    else:
                        res = requests.post(
                            f"{API}/resolve",
                            json={"name": name, "email": n_email, "cpf": n_cpf},
                            headers=_HEADERS,
                            timeout=30,
                        )
                        if res.ok:
                            st.success(f"'{name}' corrigido e promovido ao banco seguro.")
                            st.session_state.diagnosticos.pop(name, None)
                            st.rerun()
                        else:
                            st.error(f"Erro ao resolver: {res.text}")

            elif op == "Expurgar Registro (Art. 18 LGPD)":
                st.warning(f"Remove '{name}' permanentemente da fila.")
                if st.button("Confirmar Expurgo Definitivo", key=f"btn_del_{idx}", type="secondary"):
                    res = requests.delete(f"{API}/review-queue/{quote(name)}", headers=_HEADERS, timeout=10)
                    if res.status_code == 204:
                        st.success(f"'{name}' expurgado com sucesso.")
                        st.session_state.diagnosticos.pop(name, None)
                        st.rerun()
                    else:
                        st.error(f"Erro ao expurgar: {res.text}")

# ==========================================================
# ABA 3 — DOCUMENTAÇÃO
# ==========================================================
with tab_docs:
    st.markdown("### Guia de Integração")
    st.write("Conecte qualquer CRM, ERP ou sistema legado à API Gateway em menos de 5 minutos.")

    st.markdown("#### Endpoint de Ingestão")
    st.code("POST http://127.0.0.1:8000/api/v1/ingest", language="text")

    st.markdown("#### Exemplo Python")
    st.code("""\
import requests

payload = [
    {"name": "Nome do Cliente", "email": "cliente@email.com", "cpf": "12345678900"}
]
response = requests.post("http://127.0.0.1:8000/api/v1/ingest", json=payload)
print(response.json())
""", language="python")

    st.markdown("#### Todos os Endpoints")
    st.dataframe(
        pd.DataFrame([
            {"Método": "POST",   "Endpoint": "/api/v1/ingest",              "Descrição": "Ingerir lote de clientes"},
            {"Método": "GET",    "Endpoint": "/api/v1/review-queue",        "Descrição": "Listar fila de revisão (hints)"},
            {"Método": "GET",    "Endpoint": "/api/v1/analyze/{name}",      "Descrição": "Diagnóstico Claude por registro"},
            {"Método": "POST",   "Endpoint": "/api/v1/resolve",             "Descrição": "Submeter correção humana"},
            {"Método": "GET",    "Endpoint": "/api/v1/database",            "Descrição": "Banco de dados seguro mascarado"},
            {"Método": "DELETE", "Endpoint": "/api/v1/review-queue/{name}", "Descrição": "Expurgar registro (Art. 18 LGPD)"},
            {"Método": "DELETE", "Endpoint": "/api/v1/reset",               "Descrição": "Limpar estado da sessão"},
        ]),
        use_container_width=True,
        hide_index=True,
    )

    st.markdown("#### Documentação Interativa (Swagger)")
    st.link_button("Abrir /docs", "http://127.0.0.1:8000/docs")
