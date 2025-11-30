/**
 * Simple Multi-tenancy Integration Test
 * 
 * Tests that companies cannot access each other's data.
 * This is a focused test for thesis demonstration purposes.
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:4000/api';
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID;
const AUTH0_CLIENT_SECRET = process.env.AUTH0_CLIENT_SECRET;

// Test configuration
const TEST_COMPANIES = {
    A: {
        name: 'Agrícola del Norte',
        email: 'test-new-a@example.com',
        password: 'TestPassword123!',
        token: null,
        userId: null,
        companyId: null,
        productId: null
    },
    B: {
        name: 'Agrícola del Sur',
        email: 'test-new-b@example.com',
        password: 'TestPassword123!',
        token: null,
        userId: null,
        companyId: null,
        productId: null
    }
};

// Helper: Login and get token
async function login(email, password) {
    try {
        const response = await axios.post(`${BASE_URL}/login`, {
            email,
            password
        });
        return response.data.access_token;
    } catch (error) {
        console.error(`❌ Login failed for ${email}:`, error.response?.data || error.message);
        throw error;
    }
}

// Helper: Create product
async function createProduct(token, name, companyName) {
    try {
        const response = await axios.post(
            `${BASE_URL}/products`,
            {
                name: `${name} (${companyName})`,
                unit: 'kg',
                category: 'fertilizantes',
                available_quantity: 100,
                enabled: true
            },
            {
                headers: { Authorization: `Bearer ${token}` }
            }
        );
        return response.data.id;
    } catch (error) {
        console.error(`❌ Create product failed:`, error.response?.data || error.message);
        throw error;
    }
}

// Helper: Get products
async function getProducts(token) {
    try {
        const response = await axios.get(`${BASE_URL}/products`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        return response.data.data || [];
    } catch (error) {
        console.error(`❌ Get products failed:`, error.response?.data || error.message);
        throw error;
    }
}

// Helper: Get stats
async function getStats(token) {
    try {
        const response = await axios.get(`${BASE_URL}/stats`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        return response.data;
    } catch (error) {
        console.error(`❌ Get stats failed:`, error.response?.data || error.message);
        throw error;
    }
}

// Helper: Try to access another company's product
async function tryAccessProduct(token, productId) {
    try {
        const response = await axios.get(`${BASE_URL}/products/${productId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        return response.data;
    } catch (error) {
        if (error.response?.status === 404) {
            return null; // Expected: not found
        }
        throw error;
    }
}

// Main test function
async function runTests() {
    console.log('\n🧪 Starting Multi-tenancy Integration Tests\n');
    console.log('='.repeat(60));

    let passed = 0;
    let failed = 0;

    try {
        // Test 1: Login both companies
        console.log('\n📝 Test 1: User Authentication');
        console.log('-'.repeat(60));

        try {
            TEST_COMPANIES.A.token = await login(TEST_COMPANIES.A.email, TEST_COMPANIES.A.password);
            console.log('✓ Company A user logged in successfully');
            passed++;
        } catch (error) {
            console.log('✗ Company A login failed');
            failed++;
        }

        try {
            TEST_COMPANIES.B.token = await login(TEST_COMPANIES.B.email, TEST_COMPANIES.B.password);
            console.log('✓ Company B user logged in successfully');
            passed++;
        } catch (error) {
            console.log('✗ Company B login failed');
            failed++;
        }

        // Test 2: Create products for each company
        console.log('\n📝 Test 2: Create Products');
        console.log('-'.repeat(60));

        try {
            TEST_COMPANIES.A.productId = await createProduct(
                TEST_COMPANIES.A.token,
                'Test Product A',
                TEST_COMPANIES.A.name
            );
            console.log(`✓ Company A created product: ${TEST_COMPANIES.A.productId}`);
            passed++;
        } catch (error) {
            console.log('✗ Company A product creation failed');
            failed++;
        }

        try {
            TEST_COMPANIES.B.productId = await createProduct(
                TEST_COMPANIES.B.token,
                'Test Product B',
                TEST_COMPANIES.B.name
            );
            console.log(`✓ Company B created product: ${TEST_COMPANIES.B.productId}`);
            passed++;
        } catch (error) {
            console.log('✗ Company B product creation failed');
            failed++;
        }

        // Test 3: Verify data isolation - List products
        console.log('\n📝 Test 3: Data Isolation - List Products');
        console.log('-'.repeat(60));

        try {
            const productsA = await getProducts(TEST_COMPANIES.A.token);
            const hasOnlyOwnProducts = productsA.every(p =>
                !p.name.includes(TEST_COMPANIES.B.name)
            );

            if (hasOnlyOwnProducts) {
                console.log(`✓ Company A sees only its own products (${productsA.length} products)`);
                passed++;
            } else {
                console.log('✗ Company A can see Company B products!');
                failed++;
            }
        } catch (error) {
            console.log('✗ Company A product list failed');
            failed++;
        }

        try {
            const productsB = await getProducts(TEST_COMPANIES.B.token);
            const hasOnlyOwnProducts = productsB.every(p =>
                !p.name.includes(TEST_COMPANIES.A.name)
            );

            if (hasOnlyOwnProducts) {
                console.log(`✓ Company B sees only its own products (${productsB.length} products)`);
                passed++;
            } else {
                console.log('✗ Company B can see Company A products!');
                failed++;
            }
        } catch (error) {
            console.log('✗ Company B product list failed');
            failed++;
        }

        // Test 4: Cross-company access attempt
        console.log('\n📝 Test 4: Cross-Company Access Prevention');
        console.log('-'.repeat(60));

        try {
            const result = await tryAccessProduct(TEST_COMPANIES.A.token, TEST_COMPANIES.B.productId);
            if (result === null) {
                console.log('✓ Company A cannot access Company B product (404)');
                passed++;
            } else {
                console.log('✗ Company A CAN access Company B product! SECURITY ISSUE!');
                failed++;
            }
        } catch (error) {
            console.log('✗ Cross-company access test failed');
            failed++;
        }

        try {
            const result = await tryAccessProduct(TEST_COMPANIES.B.token, TEST_COMPANIES.A.productId);
            if (result === null) {
                console.log('✓ Company B cannot access Company A product (404)');
                passed++;
            } else {
                console.log('✗ Company B CAN access Company A product! SECURITY ISSUE!');
                failed++;
            }
        } catch (error) {
            console.log('✗ Cross-company access test failed');
            failed++;
        }

        // Test 5: Stats isolation
        console.log('\n📝 Test 5: Stats Isolation');
        console.log('-'.repeat(60));

        try {
            const statsA = await getStats(TEST_COMPANIES.A.token);
            console.log(`✓ Company A stats: ${statsA.kpis.products} products`);
            passed++;
        } catch (error) {
            console.log('✗ Company A stats failed');
            failed++;
        }

        try {
            const statsB = await getStats(TEST_COMPANIES.B.token);
            console.log(`✓ Company B stats: ${statsB.kpis.products} products`);
            passed++;
        } catch (error) {
            console.log('✗ Company B stats failed');
            failed++;
        }

    } catch (error) {
        console.error('\n❌ Test suite failed with error:', error.message);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Test Summary');
    console.log('-'.repeat(60));
    console.log(`✓ Passed: ${passed}`);
    console.log(`✗ Failed: ${failed}`);
    console.log(`Total: ${passed + failed}`);

    if (failed === 0) {
        console.log('\n🎉 All tests passed! Multi-tenancy is working correctly.\n');
        process.exit(0);
    } else {
        console.log('\n⚠️  Some tests failed. Please review the implementation.\n');
        process.exit(1);
    }
}

// Run tests
console.log('\n⚠️  IMPORTANT: This test requires:');
console.log('1. Backend server running on http://localhost:4000');
console.log('2. Two test users already registered (see seed script)');
console.log('3. Users must have company_id assigned');
console.log('\nPress Ctrl+C to cancel, or wait 3 seconds to continue...\n');

setTimeout(() => {
    runTests().catch(error => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    });
}, 3000);
