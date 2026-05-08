import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

export const deleteAccount = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // Delete user-owned rows first (RLS-bypassing admin delete is fine here
    // because we already proved identity via the middleware).
    await supabaseAdmin.from('journal_entries').delete().eq('user_id', userId);
    await supabaseAdmin.from('tracked_events').delete().eq('user_id', userId);
    await supabaseAdmin.from('saved_places').delete().eq('user_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });