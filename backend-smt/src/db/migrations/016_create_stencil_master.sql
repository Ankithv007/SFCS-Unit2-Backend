-- Migration to create stencil_master and audit_log tables
CREATE TABLE IF NOT EXISTS stencil_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stencil_id VARCHAR(50) UNIQUE NOT NULL,
    stencil_name VARCHAR(255) NOT NULL,
    revision VARCHAR(50) NOT NULL,
    thickness_mills VARCHAR(50) NOT NULL,
    manufacturing_date DATE NOT NULL,
    side VARCHAR(20) NOT NULL CHECK (side IN ('TOP', 'BOTTOM', 'TOP / BOTTOM')),
    storage_location VARCHAR(100) NULL,
    remarks TEXT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SCRAPPED')),
    
    -- Lifecycle Tracking (for Phase 2 support)
    print_count INTEGER DEFAULT 0,
    cleaning_count INTEGER DEFAULT 0,
    inspection_count INTEGER DEFAULT 0,
    
    created_by VARCHAR(255),
    created_by_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    updated_by_name VARCHAR(255) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_by VARCHAR(255) NULL,
    deleted_at TIMESTAMP NULL
);

-- Centralized SFCS Audit Log table structure
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL, -- CREATE, UPDATE, DELETE
    entity_type VARCHAR(50) NOT NULL,  -- STENCIL_MASTER
    entity_id VARCHAR(100) NOT NULL,
    actor VARCHAR(100) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stencil_master_stencil_id ON stencil_master(stencil_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- Database trigger to automatically refresh updated_at on updates
DROP TRIGGER IF EXISTS trigger_update_stencil_master_updated_at ON stencil_master;
CREATE TRIGGER trigger_update_stencil_master_updated_at
BEFORE UPDATE ON stencil_master
FOR EACH ROW
EXECUTE FUNCTION update_material_management_updated_at();
