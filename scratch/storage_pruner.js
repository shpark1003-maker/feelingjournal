const { supabaseAdmin, supabase } = require('../api/shared');

/**
 * Supabase Storage 'chat-images' 버킷의 고아 파일(Orphaned Files) 자동 소거 유틸리티
 * 
 * 동작 원리:
 * 1. messages 테이블에서 ![image](url) 마크다운 패턴을 가진 모든 레코드를 가져와 현재 유지해야 하는 활성 이미지 목록을 취합합니다.
 * 2. Supabase Storage의 'chat-images' 버킷에 보관된 모든 유저 폴더 및 실제 물리 파일 목록을 스캔합니다.
 * 3. 스캔한 물리 파일 중, DB에 해당 파일의 URL이 매핑되어 있지 않은 '고아 파일(Orphaned)'을 식별합니다.
 * 4. 식별된 고아 파일들을 스토리지에서 일괄 삭제(Bulk Remove)하여 용량과 비용을 획기적으로 차감합니다.
 */
async function pruneOrphanedChatImages() {
    console.log('--- [CRON START] Supabase Storage Chat-Images Pruning Job ---');
    const client = supabaseAdmin || supabase;
    
    try {
        // 1. DB에서 활성 상태의 마크다운 이미지 URL 목록 추출
        const { data: dbMessages, error: dbError } = await client
            .from('messages')
            .select('content')
            .like('content', '%![image]%');

        if (dbError) throw dbError;

        const activeUrls = new Set();
        const markdownRegex = /!\[image\]\((.*?)\)/g;

        (dbMessages || []).forEach(msg => {
            let match;
            // 한 메시지에 여러 마크다운 이미지가 존재할 수도 있으므로 루프 매칭
            while ((match = markdownRegex.exec(msg.content)) !== null) {
                if (match[1]) activeUrls.add(match[1].trim());
            }
        });

        console.log(`--- [DB] Found ${activeUrls.size} active image URLs in messages database.`);

        // 2. Storage 'chat-images' 버킷에서 전체 사용자 폴더 스캔
        // Supabase Storage 특성상 루트 목록을 불러와 각 유저 디렉토리를 횡단 탐색합니다.
        const { data: folders, error: folderError } = await client.storage
            .from('chat-images')
            .list();

        if (folderError) throw folderError;

        let totalScanned = 0;
        let totalDeleted = 0;
        const orphanedPaths = [];

        for (const folder of folders) {
            // 디렉토리(유저 ID 폴더)인 경우만 내부 스캔 진행
            if (folder.id === null || folder.metadata === undefined) {
                // 폴더명(예: user_uuid)을 기반으로 파일 리스트 추출
                const folderName = folder.name;
                const { data: files, error: fileError } = await client.storage
                    .from('chat-images')
                    .list(folderName);

                if (fileError) {
                    console.warn(`--- [WARN] Failed to list files in folder: ${folderName}, Error: ${fileError.message}`);
                    continue;
                }

                for (const file of files) {
                    // .emptyKeep 등의 더미 파일 제외
                    if (file.name === '.emptyKeep' || file.name === '.placeholder') continue;

                    totalScanned++;
                    const filePath = `${folderName}/${file.name}`;
                    
                    // 파일의 예상 퍼블릭 URL 구성
                    const { data: { publicUrl } } = client.storage
                        .from('chat-images')
                        .getPublicUrl(filePath);

                    // DB 활성 이미지 세트에 존재하는지 교차 점검
                    if (!activeUrls.has(publicUrl.trim())) {
                        orphanedPaths.push(filePath);
                    }
                }
            }
        }

        console.log(`--- [SCAN] Scanned ${totalScanned} storage files. Identified ${orphanedPaths.length} orphaned files.`);

        // 3. 고아 파일들 일괄 소거 (Bulk Remove)
        if (orphanedPaths.length > 0) {
            console.log(`--- [PRUNE] Initiating bulk deletion of ${orphanedPaths.length} orphaned files...`);
            
            // Supabase 스토리지 API는 배열 단위로 일괄 삭제가 가능하여 API 호출 횟수를 아낄 수 있습니다.
            const { data: deletedFiles, error: deleteError } = await client.storage
                .from('chat-images')
                .remove(orphanedPaths);

            if (deleteError) throw deleteError;

            totalDeleted = deletedFiles ? deletedFiles.length : orphanedPaths.length;
            console.log(`--- [PRUNE SUCCESS] Successfully deleted ${totalDeleted} orphaned files from Storage.`);
        } else {
            console.log('--- [PRUNE] Storage is clean! No orphaned files found.');
        }

        console.log('--- [CRON END] Pruning Job Completed successfully. ---');
        return { success: true, totalScanned, totalDeleted };

    } catch (err) {
        console.error('--- [CRON CRITICAL ERROR] Pruning job failed:', err.message);
        return { success: false, error: err.message };
    }
}

// 스크립트 직접 호출 시 자동 가동
if (require.main === module) {
    pruneOrphanedChatImages();
}

module.exports = { pruneOrphanedChatImages };
