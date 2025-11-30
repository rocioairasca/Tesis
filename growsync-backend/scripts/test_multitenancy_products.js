const axios = require('axios');
const supabase = require('../db/supabaseClient');
require('dotenv').config();

async function testMultiTenancy() {
    console.log('--- Starting Multi-tenancy Test (Products) ---');

    // 1. Setup: Create 2 Companies
    const { data: companyA } = await supabase.from('companies').insert([{ name: 'Company A' }]).select().single();
    const { data: companyB } = await supabase.from('companies').insert([{ name: 'Company B' }]).select().single();

    console.log('1. Companies created:', companyA.id, companyB.id);

    // 2. Setup: Create Users for each company (Simulated via DB insert to skip Auth0 for speed)
    // We need to mock the JWT/Auth flow or insert directly into DB and use a "backdoor" or just test the logic if we could mock req.user.
    // Since we are testing the API, we need valid tokens. 
    // Generating valid Auth0 tokens for test users is hard without interaction.
    // ALTERNATIVE: We can test the CONTROLLER logic directly if we import it, mocking req/res.
    // OR: We can temporarily allow a "test-token" in middleware (dangerous).
    // OR: We can use the existing "invite flow" to create real users, but that requires manual email interaction or more complex Auth0 API usage.

    // Let's try testing the Controller Logic directly by importing it. It's faster and safer for unit testing logic.

    const { listProducts, addProduct } = require('../controllers/products/products');

    // Mock Request/Response
    const mockRes = () => {
        const res = {};
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (data) => { res.data = data; return res; };
        return res;
    };

    // 3. Test: Add Product for Company A
    const reqA = {
        user: { id: 'userA', company_id: companyA.id, role: 1 },
        body: { name: 'Product A', category: 'semillas', unit: 'kg', price: 100 },
        query: {}
    };
    const resA = mockRes();

    await addProduct(reqA, resA, (err) => console.error('Error A:', err));
    console.log('3. Add Product A Result:', resA.statusCode || 200);

    if (!resA.data || !resA.data.product) {
        console.error('❌ Failed to add product A');
        return;
    }
    const productAId = resA.data.product.id;

    // 4. Test: User B tries to list products -> Should NOT see Product A
    const reqB = {
        user: { id: 'userB', company_id: companyB.id, role: 1 },
        query: {}
    };
    const resB = mockRes();

    await listProducts(reqB, resB, (err) => console.error('Error B:', err));

    const productsB = resB.data.data;
    const foundA = productsB.find(p => p.id === productAId);

    if (foundA) {
        console.error('❌ Test Failed: User B can see Company A product!');
    } else {
        console.log('✅ Test Passed: User B cannot see Company A product.');
    }

    // 5. Test: User A tries to list products -> Should SEE Product A
    const resA2 = mockRes();
    await listProducts(reqA, resA2, (err) => console.error('Error A2:', err));

    const productsA = resA2.data.data;
    const foundA2 = productsA.find(p => p.id === productAId);

    if (foundA2) {
        console.log('✅ Test Passed: User A can see Company A product.');
    } else {
        console.error('❌ Test Failed: User A cannot see their own product!');
    }

    // Cleanup
    await supabase.from('products').delete().eq('id', productAId);
    await supabase.from('companies').delete().in('id', [companyA.id, companyB.id]);
}

testMultiTenancy();
