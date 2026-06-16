const assert = require('assert');
const { saveDiary, getDiary } = require('../api/_repositories/diaryRepository');
const { redis } = require('../api/_routes/shared');

async function runDiaryRepositoryTest() {
    console.log('=== STARTING DIARY REPOSITORY INTEGRITY TESTS ===');

    const mockUserId = '91fdf57d-a069-4eab-820b-68180886d487'; // Valid UUID format matching mock user
    const diaryKey = `user:${mockUserId}:diary-test-repo-9999`;

    const originalData = {
        title: '테스트용 일기 제목',
        content: '테스트용 본문 내용',
        richContent: '<p>테스트용 본문 내용</p>',
        response: 'AI 비서의 응답 예시',
        emotion: '기쁨',
        mediaId: 'media-123',
        notebookId: 'nb-test',
        shared: true,
        sharedWith: ['friend-uuid-1']
    };

    try {
        console.log('[TEST 1] Saving diary via repository and checking JSON shape...');
        const savedResult = await saveDiary(diaryKey, mockUserId, originalData);

        // Verify JSON Shape of saved return object
        const expectedKeys = [
            'title', 'content', 'richContent', 'response', 
            'createdAt', 'emotion', 'mediaId', 'notebookId', 
            'shared', 'sharedWith'
        ];

        expectedKeys.forEach(key => {
            assert.ok(savedResult[key] !== undefined, `Saved result should contain key: ${key}`);
        });

        assert.strictEqual(savedResult.title, originalData.title);
        assert.strictEqual(savedResult.content, originalData.content);
        assert.strictEqual(savedResult.shared, originalData.shared);
        console.log('=> Save and JSON shape verification PASSED!');

        console.log('\n[TEST 2] Retrieving diary from repository and comparing shape...');
        const retrievedResult = await getDiary(diaryKey);

        assert.ok(retrievedResult, 'Retrieved result should not be null');
        
        // Check if shapes are identical
        expectedKeys.forEach(key => {
            assert.ok(retrievedResult[key] !== undefined, `Retrieved result should contain key: ${key}`);
            assert.deepStrictEqual(retrievedResult[key], savedResult[key], `Value for key [${key}] must match`);
        });

        console.log('=> Retrieve and shape comparison PASSED!');

        // Cleanup
        await redis.del(diaryKey);
        console.log('\n=== ALL DIARY REPOSITORY INTEGRITY TESTS PASSED! ===');
    } catch (err) {
        console.error('❌ Diary repository test failed:', err);
        process.exit(1);
    }
}

runDiaryRepositoryTest();
