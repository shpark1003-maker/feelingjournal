const assert = require('assert');
const path = require('path');

async function runDiagnosis() {
    console.log('=== SYSTEM MODULES INTEGRITY DIAGNOSTIC START ===\n');

    const modules = [
        { name: 'analyzeService', path: '../api/_services/analyzeService' },
        { name: 'briefingService', path: '../api/_services/briefingService' },
        { name: 'calendarService', path: '../api/_services/calendarService' },
        { name: 'chatService', path: '../api/_services/chatService' },
        { name: 'pushService', path: '../api/_services/pushService' }
    ];

    for (const mod of modules) {
        try {
            console.log(`[DIAGNOSTIC] Loading ${mod.name}...`);
            const loaded = require(mod.path);
            console.log(`✅ ${mod.name} loaded successfully.`);
            
            // Check exported functions
            const exportsKeys = Object.keys(loaded);
            console.log(`   Exported functions: ${exportsKeys.join(', ')}`);
            
            if (mod.name === 'analyzeService') {
                assert.ok(typeof loaded.analyzeDiary === 'function', 'analyzeDiary should be a function');
            } else if (mod.name === 'briefingService') {
                assert.ok(typeof loaded.generateBriefing === 'function', 'generateBriefing should be a function');
            } else if (mod.name === 'calendarService') {
                assert.ok(typeof loaded.analyzeCalendarEventsAndDiaries === 'function', 'analyzeCalendarEventsAndDiaries should be a function');
            } else if (mod.name === 'chatService') {
                assert.ok(typeof loaded.getMessages === 'function', 'getMessages should be a function');
                assert.ok(typeof loaded.saveMessage === 'function', 'saveMessage should be a function');
            } else if (mod.name === 'pushService') {
                assert.ok(typeof loaded.isPushEnabled === 'function', 'isPushEnabled should be a function');
                assert.ok(typeof loaded.sendNotification === 'function', 'sendNotification should be a function');
            }
            console.log(`   └─ API contract validated.\n`);
        } catch (e) {
            console.error(`❌ Failed to load or validate ${mod.name}:`, e.stack);
            process.exit(1);
        }
    }

    console.log('=== ALL SYSTEM SERVICES ARE SYNTAX & CONTRACT SAFE! ===');
}

runDiagnosis().catch(err => {
    console.error('Diagnosis failed:', err);
    process.exit(1);
});
