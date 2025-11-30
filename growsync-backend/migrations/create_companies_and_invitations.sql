-- Create companies table
CREATE TABLE IF NOT EXISTS companies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create invitations table
CREATE TABLE IF NOT EXISTS invitations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    role INTEGER DEFAULT 0, -- 0: User, 1: Admin, 2: Owner/Supervisor
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add company_id to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

-- Create a default company for existing users (Optional, but good for migration)
-- INSERT INTO companies (id, name) VALUES ('00000000-0000-0000-0000-000000000000', 'Default Company') ON CONFLICT DO NOTHING;
-- UPDATE users SET company_id = '00000000-0000-0000-0000-000000000000' WHERE company_id IS NULL;
