const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runRegressionTests() {
    console.log('--- STARTING WRITING HELPER BRAND REGRESSION TESTS ---');

    // 1. Verify index.html changes
    console.log('[TEST 1] Verifying index.html UI changes...');
    const htmlPath = path.resolve(__dirname, '../public/index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    assert.ok(
        htmlContent.includes('👼 글쓰기 가이드 천사 (AI 대화형 일기)'),
        'index.html should contain the updated Writing Guide Angel header'
    );
    assert.ok(
        htmlContent.includes('오늘 어떤 하루를 보내셨나요? 천사에게 들려주세요...'),
        'index.html should contain the updated input placeholder'
    );
    console.log('=> index.html UI checks PASSED!');

    // 2. Verify editor.js changes
    console.log('\n[TEST 2] Verifying editor.js prompt changes...');
    const editorJsPath = path.resolve(__dirname, '../public/modules/editor.js');
    const editorContent = fs.readFileSync(editorJsPath, 'utf8');

    assert.ok(
        editorContent.includes('당신의 기록을 도와드리는 글쓰기 가이드 천사예요. 👼'),
        'editor.js should contain the updated greeting message'
    );
    assert.ok(
        editorContent.includes('[⚠️ AI 안전 수칙 (위기 대응)]'),
        'editor.js prompt context should contain crisis safety guidelines'
    );
    assert.ok(
        editorContent.includes('글쓰기 가이드 천사(Writing Guide Angel)'),
        'editor.js prompt context should define the role as Writing Guide Angel'
    );
    assert.ok(
        editorContent.includes('지나치게 과보호적이거나 의존성을 유발하는 표현'),
        'editor.js prompt context should include guidelines preventing over-protective or dependent tone'
    );
    console.log('=> editor.js prompt checks PASSED!');

    console.log('\n🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY!');
}

try {
    runRegressionTests();
} catch (error) {
    console.error('❌ REGRESSION TEST FAILED:', error.message);
    process.exit(1);
}
