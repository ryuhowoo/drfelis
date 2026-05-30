-- Restrict RLS to the drfelis_team namespace.
-- Tightens the previously permissive USING (true) / WITH CHECK (true)
-- so the publishable anon key cannot read or write other namespaces.
DROP POLICY IF EXISTS "sc_histories_all" ON public.sc_histories;
CREATE POLICY "sc_histories_team_only" ON public.sc_histories
  FOR ALL TO anon, authenticated
  USING (uid = 'drfelis_team')
  WITH CHECK (uid = 'drfelis_team');

DROP POLICY IF EXISTS "sc_presets_all" ON public.sc_presets;
CREATE POLICY "sc_presets_team_only" ON public.sc_presets
  FOR ALL TO anon, authenticated
  USING (uid = 'drfelis_team')
  WITH CHECK (uid = 'drfelis_team');
