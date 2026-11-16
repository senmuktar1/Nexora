# Supabase setup (hosted only)

NEXORA uses Supabase as a hosted service. No local Supabase or local database process is required.

1. Create a Supabase project in the Supabase dashboard.
2. Copy the project URL and publishable key from Project Settings → API.
3. In Vercel, open the NEXORA project → Settings → Environment Variables.
4. Add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
5. Apply the variables to Preview first, redeploy, and verify the deployment.
6. Add production values to the Production environment only when ready.

Never expose a Supabase secret/service-role key to browser code. Any future privileged database operation must run server-side and enforce authorization and row-level security.

Database schema and migrations will be added with the first feature that needs persistence. Do not create placeholder tables without a defined use case.
