#!/usr/bin/env node

/**
 * Admin Dashboard CRUD Test Script
 * Tests all product endpoints to verify they work correctly
 */

const http = require('http');

const API_BASE = 'http://localhost:5000';

function makeRequest(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`\n-> ${method} ${path}`);
    if (body) console.log('   Body:', JSON.stringify(body, null, 2));

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          console.log(`<- ${res.statusCode}`);
          console.log('   Response:', JSON.stringify(parsed, null, 2).slice(0, 200));
          resolve({ status: res.statusCode, data: parsed });
        } catch (err) {
          console.log(`<- ${res.statusCode} (parse error)`);
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('========================================');
  console.log('Admin Dashboard CRUD Tests');
  console.log('========================================');
  
  try {
    // Test 1: Check if server is running
    console.log('\n1. Testing API availability...');
    const healthCheck = await makeRequest('/products');
    if (healthCheck.status === 200) {
      console.log('✅ Server is running and responding');
    } else {
      console.log('❌ Server not responding correctly');
      return;
    }

    // Test 2: Check if GET /admin/products works WITHOUT token
    console.log('\n2. Testing GET /admin/products WITHOUT token (should fail with 401)...');
    const noAuthTest = await makeRequest('/admin/products');
    if (noAuthTest.status === 401 || noAuthTest.status === 403) {
      console.log('✅ Correctly requires authentication');
    } else {
      console.log('⚠️  Expected 401/403, got', noAuthTest.status);
    }

    // Test 3: Login to get token
    console.log('\n3. Testing admin login...');
    const login = await makeRequest('/admin/login', 'POST', {
      username: 'Swapnil22',
      password: 'Paithani#2026'
    });
    
    if (login.status !== 200) {
      console.log('❌ Login failed. Check admin credentials in .env');
      console.log('   Expected credentials:');
      console.log('   - ADMIN_USERNAME=Swapnil22');
      console.log('   - ADMIN_PASSWORD=Paithani#2026 (enclosed in single quotes in .env)');
      return;
    }

    const token = login.data?.token;
    if (!token) {
      console.log('❌ No token in login response');
      return;
    }
    console.log('✅ Login successful, token received');

    // Test 4: GET /admin/products WITH token
    console.log('\n4. Testing GET /admin/products WITH token...');
    const products = await makeRequest('/admin/products', 'GET', null, token);
    if (products.status === 200) {
      console.log('✅ Successfully fetched products');
      console.log(`   Found ${Array.isArray(products.data) ? products.data.length : 0} products`);
    } else {
      console.log('❌ Failed to fetch products');
    }

    // Test 5: POST /admin/products (create)
    console.log('\n5. Testing POST /admin/products (create product)...');
    const newProduct = {
      name: 'Test Product ' + Date.now(),
      price: 5000,
      description: 'Test product for CRUD verification',
      category: 'Pure Silk Paithani',
      status: 'new',
      stock: 10,
      lowStockThreshold: 2,
      featured: false,
      discountType: 'none',
      discountValue: 0
    };
    
    const created = await makeRequest('/admin/products', 'POST', newProduct, token);
    if (created.status === 201 || created.status === 200) {
      console.log('✅ Product created successfully');
      const productId = created.data?._id;
      console.log(`   Product ID: ${productId}`);

      // Test 6: PUT /admin/products/:id (update)
      if (productId) {
        console.log('\n6. Testing PUT /admin/products/:id (update product)...');
        const updated = await makeRequest(`/admin/products/${productId}`, 'PUT', {
          price: 5500,
          stock: 15
        }, token);
        
        if (updated.status === 200) {
          console.log('✅ Product updated successfully');
          console.log(`   New price: ${updated.data?.price}`);
          console.log(`   New stock: ${updated.data?.stock}`);
        } else {
          console.log('❌ Update failed');
        }

        // Test 7: DELETE /admin/products/:id
        console.log('\n7. Testing DELETE /admin/products/:id (delete product)...');
        const deleted = await makeRequest(`/admin/products/${productId}`, 'DELETE', null, token);
        if (deleted.status === 200) {
          console.log('✅ Product deleted successfully');
        } else {
          console.log('❌ Delete failed');
        }
      }
    } else {
      console.log('❌ Failed to create product');
      console.log('   Status:', created.status);
      console.log('   Error:', created.data?.error);
    }

    console.log('\n========================================');
    console.log('Tests Complete!');
    console.log('========================================\n');

  } catch (err) {
    console.error('❌ Test error:', err.message);
  }

  process.exit(0);
}

// Run tests
test();
