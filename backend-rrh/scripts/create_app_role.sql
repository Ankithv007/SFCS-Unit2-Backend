-- ====================================================================================================
-- LEAST-PRIVILEGE DATABASE ROLE SETUP SCRIPT (create_app_role.sql)
-- PURPOSE: Provisions a dedicated application user for backend-rrh with minimum required privileges.
-- EXECUTION: Run once by superuser (postgres) against rrh_db.
-- ====================================================================================================

-- 1. Create dedicated application user if it does not already exist
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrh_app_user') THEN
        CREATE ROLE rrh_app_user WITH LOGIN PASSWORD 'change_me_in_production_secure_password';
    END IF;
END $$;

-- 2. Grant connection rights to target database
GRANT CONNECT ON DATABASE rrh_db TO rrh_app_user;

-- 3. Grant schema usage
GRANT USAGE ON SCHEMA public TO rrh_app_user;

-- 4. Grant DML rights on existing tables and sequences
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rrh_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rrh_app_user;

-- 5. Set default privileges for future objects created in schema public
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rrh_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rrh_app_user;

-- Revoke dangerous superuser/admin rights explicitly
REVOKE CREATE ON SCHEMA public FROM rrh_app_user;
