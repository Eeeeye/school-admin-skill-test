-- Safe to apply both to the original school database and a fresh installation.
-- Personal student details stay in PostgreSQL; IPFS/on-chain data is public.
CREATE TABLE IF NOT EXISTS student_certificates (
    id VARCHAR(66) PRIMARY KEY CHECK (id ~ '^0x[0-9a-f]{64}$'),
    student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    student_name VARCHAR(100) NOT NULL,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(1000) NOT NULL DEFAULT '',
    recipient_address VARCHAR(42) NOT NULL,
    metadata_cid VARCHAR(256),
    transaction_hash VARCHAR(66),
    revocation_transaction_hash VARCHAR(66),
    chain_id BIGINT,
    contract_address VARCHAR(42),
    issuer_address VARCHAR(42),
    status VARCHAR(12) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'issued', 'revoked', 'failed')),
    error VARCHAR(500),
    request_key VARCHAR(160) UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    issued_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS student_certificates_student_created_idx
    ON student_certificates (student_id, created_at DESC);
