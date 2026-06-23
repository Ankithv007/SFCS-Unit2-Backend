-- Create qms_file_revisions table to track history of all QMS documents
CREATE TABLE IF NOT EXISTS qms_file_revisions (
    id SERIAL PRIMARY KEY,
    qms_id INTEGER REFERENCES qms_master(id) ON DELETE CASCADE,
    file_type VARCHAR(50) NOT NULL, -- 'bom', 'pfc', 'xy', 'ecn', 'drawing'
    previous_revision VARCHAR(50), -- NULL or '-' if initial upload
    new_revision VARCHAR(50) NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    remarks TEXT NOT NULL
);

-- Copy existing BOM revisions from qms_bom_revisions to qms_file_revisions if any exist
INSERT INTO qms_file_revisions (
    qms_id, file_type, previous_revision, new_revision,
    uploaded_by, uploaded_at, remarks
)
SELECT 
    qms_id, 
    'bom', 
    CASE WHEN revision_number = '1' THEN NULL ELSE (CAST(revision_number AS DECIMAL) - 1)::VARCHAR END, 
    revision_number,
    uploaded_by, 
    uploaded_at, 
    COALESCE(remarks, 'Initial upload')
FROM qms_bom_revisions
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_qms_file_revisions_qms_id ON qms_file_revisions(qms_id);
