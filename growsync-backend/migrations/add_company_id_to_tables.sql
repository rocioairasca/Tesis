-- Add company_id to products
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Add company_id to lots
ALTER TABLE lots 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Add company_id to vehicles
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Add company_id to notifications
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Add company_id to usage_logs (assuming table name is usage_logs based on context, will verify if fails)
-- Actually, let's check table name first or use IF EXISTS. 
-- But better to be sure. I will assume 'usage_logs' or 'usages'. 
-- Let's stick to standard ones first.
-- Checking previous file list, I saw 'usage.js'.

-- Add company_id to planning (if it's a separate table)
-- Checking planning.js might reveal table name.

-- For now, let's do the ones we are sure of.
