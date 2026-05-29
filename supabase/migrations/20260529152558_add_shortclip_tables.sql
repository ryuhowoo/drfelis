-- Shortclip generator: history & presets tables
CREATE TABLE IF NOT EXISTS public.sc_histories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid text NOT NULL DEFAULT 'drfelis_team',
  item jsonb NOT NULL,
  created_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

CREATE INDEX IF NOT EXISTS idx_sc_histories_uid_created
  ON public.sc_histories (uid, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sc_presets (
  uid text PRIMARY KEY,
  presets jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);

-- Enable RLS
ALTER TABLE public.sc_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sc_presets   ENABLE ROW LEVEL SECURITY;

-- Explicit GRANTs (required from May 30, 2026 for new tables in public)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sc_histories TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sc_presets   TO anon, authenticated;

DROP POLICY IF EXISTS "sc_histories_all" ON public.sc_histories;
CREATE POLICY "sc_histories_all" ON public.sc_histories
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "sc_presets_all" ON public.sc_presets;
CREATE POLICY "sc_presets_all" ON public.sc_presets
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
