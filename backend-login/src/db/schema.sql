-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255), -- Nullable initially
    is_verified BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'pending_verification', -- pending_verification, active
    avatar TEXT, -- Base64 encoded image
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email OTPs Table
CREATE TABLE IF NOT EXISTS email_otps (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    otp_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
