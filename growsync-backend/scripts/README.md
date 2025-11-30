# Scripts Directory

## Multi-tenancy Testing Scripts

### 🌱 seed_two_companies.js

Creates test data for multi-tenancy verification.

**Usage:**
```bash
# Create test data
node scripts/seed_two_companies.js

# Remove test data
node scripts/seed_two_companies.js --cleanup
```

**Creates:**
- 2 companies (Empresa A and Empresa B)
- 1 admin user per company
- 2-3 products per company
- 1-2 lots per company

**Test Credentials:**
- Company A: `test-company-a@example.com` / `TestPassword123!`
- Company B: `test-company-b@example.com` / `TestPassword123!`

---

### 🧪 test_multitenancy_simple.js

Automated tests to verify data isolation between companies.

**Usage:**
```bash
# Run after seeding test data
node scripts/test_multitenancy_simple.js
```

**Tests:**
- User authentication
- Product creation
- Data isolation (list operations)
- Cross-company access prevention
- Stats isolation

**Expected Result:**
```
✓ Passed: 10
✗ Failed: 0
🎉 All tests passed!
```

---

## Other Scripts

### run_migration_*.js

Temporary scripts for running database migrations. These were used during development and can be removed after migrations are applied.

### test_multitenancy_products.js

Earlier test script for products only. Superseded by `test_multitenancy_simple.js`.

### test_invite_flow.js

Tests the invitation system for restricted access.
