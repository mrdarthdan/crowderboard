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
};
