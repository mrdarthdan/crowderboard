// CrowderBoard "forum-join" edge function.
// Creates a member's forum profile after checking a Cloudflare Turnstile token.
// Only needed when Admin -> Spam Protection -> "Require human check to join" is on.
// Secret needed (Dashboard -> Edge Functions -> Secrets): TURNSTILE_SECRET_KEY
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Please log in first.' }, 401);

    const { username, token } = await req.json();
    if (!/^[A-Za-z0-9_\-]{3,20}$/.test(String(username ?? ''))) {
      return json({ error: 'Username must be 3-20 letters, numbers, _ or -.' }, 400);
    }
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: existing } = await admin.from('forum_profiles').select('id').eq('id', user.id).maybeSingle();
    if (existing) return json({ ok: true });

    const { data: cfg } = await admin.from('forum_spam_settings').select('require_captcha').eq('id', 1).maybeSingle();
    if (cfg?.require_captcha) {
      const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
      if (!secret) return json({ error: 'Joining is temporarily unavailable (human check is not fully set up).' }, 503);
      if (!token) return json({ error: 'Please complete the human check.' }, 400);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret, response: String(token) }),
      });
      const v = await r.json();
      if (!v.success) return json({ error: 'The human check failed. Please try again.' }, 400);
    }

    const { error } = await admin.from('forum_profiles').insert({ id: user.id, username });
    if (error) {
      const m = /duplicate|unique/i.test(error.message) ? 'That username is taken.' : error.message;
      return json({ error: m }, 400);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
