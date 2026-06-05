-- Migração: adiciona a coluna updated_at à tabela tenant_field_schemas
-- Objetivo: registar quando a estrutura de um campo do schema foi atualizada.
--
-- IMPORTANTE — ORDEM DE EXECUÇÃO:
--   1) Correr este SQL no Supabase (Dashboard -> SQL Editor) PRIMEIRO.
--   2) Só depois fazer deploy do código (merge da branch feat/field-schema-updated-at).
-- Se o código que lê/escreve updated_at chegar a produção antes da coluna existir,
-- toda a criação/edição de campos falha com "column updated_at does not exist".

-- 1) Adiciona a coluna (idempotente)
ALTER TABLE public.tenant_field_schemas
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- 2) Backfill das linhas existentes a partir de created_at (fallback now())
UPDATE public.tenant_field_schemas
  SET updated_at = COALESCE(updated_at, created_at, now())
  WHERE updated_at IS NULL;

-- 3) Default para novas linhas (o app também envia o valor explicitamente no upsert)
ALTER TABLE public.tenant_field_schemas
  ALTER COLUMN updated_at SET DEFAULT now();

-- OPCIONAL (defesa em profundidade): trigger que força updated_at em qualquer UPDATE,
-- mesmo que algum caminho não envie o valor. Não é necessário com o código atual,
-- que já carimba updated_at app-side em todos os writes.
--
-- CREATE OR REPLACE FUNCTION public.set_updated_at()
-- RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN
--   NEW.updated_at = now();
--   RETURN NEW;
-- END $$;
--
-- DROP TRIGGER IF EXISTS trg_field_schemas_updated_at ON public.tenant_field_schemas;
-- CREATE TRIGGER trg_field_schemas_updated_at
--   BEFORE UPDATE ON public.tenant_field_schemas
--   FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
