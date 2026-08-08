-- Migration: 047_create_system_configuration.sql
-- Purpose: Create system_configuration table to store configurable parameters (like target print life limit).

CREATE TABLE IF NOT EXISTS system_configuration (
    key VARCHAR(100) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed default stencil print life cycle limit
INSERT INTO system_configuration (key, value, description)
VALUES ('stencil_target_lifecycle', '60000', 'Default target print life cycle limit for newly registered stencils.')
ON CONFLICT (key) DO NOTHING;
