const { generateBriefing } = require('./api/_services/briefingService');
const { supabaseAdmin } = require('./api/_routes/shared');

async function test() {
    console.log('Testing briefing generation...');
    // Use the first user in the DB
    const userId = '91fdf57d-a069-4eab-820b-68180886d487';
    
    const result = await generateBriefing(userId, null, null, [], false, 'test@test.com', true, false, false);
    console.log('Briefing Text Length:', result.briefing.length);
    console.log('Briefing Text:', result.briefing);
    process.exit(0);
}

test().catch(console.error);
