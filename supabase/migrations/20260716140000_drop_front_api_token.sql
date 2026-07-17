-- =========================================================
-- Remove the Front API token store
--
-- Chief no longer uses Front's Core REST API (API token path). The Inbox is
-- email-only again, and Front is reached solely through its official hosted
-- MCP server (front_oauth_config, unchanged). Drop the API-token table so the
-- unused full-access credential does not linger in the database.
-- =========================================================

drop table if exists public.front_api_config;
