const supabase = require('../db/supabaseClient');
const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:4000/api';

const COMPANIES = {
    A: {
        id: '89951a8e-6fef-46fe-8bab-b6403ca594f2',
        email: 'test-new-a@example.com',
        password: 'TestPassword123!',
        role: 2 // Supervisor/Admin
    },
    B: {
        id: 'e5825a49-25df-459c-9136-2ab25c217169',
        email: 'test-new-b@example.com',
        password: 'TestPassword123!',
        role: 2
    }
};

async function setupUsers() {
    console.log('🚀 Setting up test users...');

    for (const [key, company] of Object.entries(COMPANIES)) {
        try {
            console.log(`\nProcessing Company ${key}...`);

            // 1. Create Invitation
            const token = crypto.randomUUID();
            const { error: inviteError } = await supabase
                .from('invitations')
                .insert([{
                    token: token,
                    email: company.email,
                    role: company.role,
                    company_id: company.id,
                    used: false,
                    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
                }]);

            if (inviteError) {
                console.error(`❌ Failed to create invitation for ${company.email}:`, inviteError);
                continue;
            }
            console.log(`✓ Invitation created (token: ${token})`);

            // 2. Register User via API
            try {
                await axios.post(`${BASE_URL}/register`, {
                    email: company.email,
                    password: company.password,
                    username: `User ${key}`,
                    token: token
                });
                console.log(`✓ User registered: ${company.email}`);
            } catch (regError) {
                if (regError.response?.status === 409) {
                    console.log(`⚠️ User already exists: ${company.email}`);
                } else {
                    console.error(`❌ Registration failed for ${company.email}:`, regError.response?.data || regError.message);
                }
            }

        } catch (err) {
            console.error(`❌ Error processing ${key}:`, err);
        }
    }

    console.log('\n✅ Setup complete!');
    process.exit(0);
}

setupUsers();
