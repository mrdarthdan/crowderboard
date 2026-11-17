/* CrowderBoard configuration.
   1. Create a Supabase project (free tier is fine) at https://supabase.com
   2. Run sql/schema.sql in the project's SQL Editor
   3. Paste your Project URL and *publishable* (anon) key below.
      Find both under Project Settings -> API. The publishable key is safe to put
      in a public web page; all access control is enforced by the database.
      NEVER put your service_role / secret key here. */
window.CROWDERBOARD_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseKey: 'YOUR-PUBLISHABLE-KEY',
  /* Optional (v1.4) search-engine friendly share links. Hash URLs (#/thread/12) are invisible to
     crawlers, so each topic/board gets a crawlable twin page. Pick one, or leave it out:
       'static' -> t/<id>.html and b/<id>.html next to index.html; generate them with
                   `node tools/prerender.mjs --base https://your-site/forum/`
       'edge'   -> the forum-seo edge function (needs a custom domain on Supabase; see README) */
  // shareMode: 'static',
};
