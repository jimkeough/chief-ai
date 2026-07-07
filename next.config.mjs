/** @type {import('next').NextConfig} */
const nextConfig = {
  // The first-render setup flow runs the repo's own SQL migrations against the
  // user's database — make sure the .sql files ship inside the serverless
  // bundle that serves the setup routes.
  outputFileTracingIncludes: {
    "/api/setup/migrate": ["./supabase/migrations/*.sql"],
    "/api/setup/health": ["./supabase/migrations/*.sql"],
  },
};

export default nextConfig;
