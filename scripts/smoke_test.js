import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 4000;
const BASE_URL = `http://localhost:${PORT}`;

async function runSmokeTests() {
  console.log('--- ZYNQ PRE-FLIGHT AUTOMATED verification test SUITE ---');
  let passed = 0;
  let failed = 0;

  // Test 1: GET /health/baseline
  try {
    const res = await axios.get(`${BASE_URL}/health/baseline`);
    if (res.status === 200 && res.data.component === 'zynq-backend') {
      console.log('✅ GET /health/baseline - PASSED');
      passed++;
    } else {
      console.log(`❌ GET /health/baseline - FAILED (Invalid response): status=${res.status}`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ GET /health/baseline - FAILED (Error): ${err.message}`);
    failed++;
  }

  // Test 2: GET /api/v1/health/baseline
  try {
    const res = await axios.get(`${BASE_URL}/api/v1/health/baseline`);
    if (res.status === 200 && res.data.component === 'zynq-backend') {
      console.log('✅ GET /api/v1/health/baseline - PASSED');
      passed++;
    } else {
      console.log(`❌ GET /api/v1/health/baseline - FAILED (Invalid response): status=${res.status}`);
      failed++;
    }
  } catch (err) {
    console.log(`❌ GET /api/v1/health/baseline - FAILED (Error): ${err.message}`);
    failed++;
  }

  console.log(`Result: ${passed} PASSED, ${failed} FAILED`);
  if (failed > 0) {
    console.log('Status: FAILED');
    process.exit(1);
  } else {
    console.log('Status: READY FOR ANNA RETESTING (Exit Code 0)');
    process.exit(0);
  }
}

runSmokeTests();
