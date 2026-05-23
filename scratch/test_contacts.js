const { redis } = require('../api/_routes/shared');

async function test() {
    console.log('--- [DIAGNOSTIC] Retrieving user Google provider token from Redis... ---');
    
    // Find the active google provider token key in Redis
    const keys = await redis.keys('user:*:google_provider_token');
    if (keys.length === 0) {
        console.error('No Google provider tokens found in Redis. Please make sure you are logged in via Google OAuth.');
        process.exit(1);
    }

    console.log(`Found keys: ${keys.join(', ')}`);
    const key = keys[0];
    const providerToken = await redis.get(key);
    console.log(`Using token: ${providerToken.slice(0, 10)}... (length: ${providerToken.length})`);

    // 1. Fetch connections
    console.log('\n--- 1. Fetching people/me/connections ---');
    const connUrl = 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=100';
    try {
        const res = await fetch(connUrl, {
            headers: { Authorization: `Bearer ${providerToken}` }
        });
        const data = await res.json();
        console.log(`Connections Status: ${res.status}`);
        console.log(`Connections Response: ${JSON.stringify(data, null, 2)}`);
    } catch (err) {
        console.error('Error fetching connections:', err);
    }

    // 2. Fetch otherContacts
    console.log('\n--- 2. Fetching otherContacts ---');
    const otherUrl = 'https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses&pageSize=100';
    try {
        const res = await fetch(otherUrl, {
            headers: { Authorization: `Bearer ${providerToken}` }
        });
        const data = await res.json();
        console.log(`OtherContacts Status: ${res.status}`);
        console.log(`OtherContacts Response: ${JSON.stringify(data, null, 2)}`);
    } catch (err) {
        console.error('Error fetching otherContacts:', err);
    }

    process.exit(0);
}

test();
