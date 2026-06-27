const { 
    supabase,
    sanitizeContent
} = require('./shared');
const analyzeService = require('../_services/analyzeService');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        
        const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (authError || !user) {
            return res.status(401).json({ error: 'Invalid user' });
        }

        const { image, title, mediaId, notebookId, richContent, aiConsent, createdAt, shared, sharedWith } = req.body;
        const content = sanitizeContent(req.body.content);

        // 1촌 검증 및 입력값 정제 (서버 보안 검증)
        let cleanSharedWith = [];
        if (shared) {
            const friendIds = Array.isArray(sharedWith) ? sharedWith.map(f => (f && typeof f === 'object') ? f.id : f).filter(Boolean) : [];
            const { validateFriends } = require('../_services/friendService');
            const validation = await validateFriends(user.id, friendIds);
            if (!validation.isValid) {
                return res.status(400).json({ error: validation.error });
            }

            // DB에서 실제 닉네임을 조회하여 위변조 방지
            const dbClient = supabaseAdmin || supabase;
            const mockProfiles = [
                { id: 'mock-1', nickname: '다정한 영희 (데모)' },
                { id: 'mock-2', nickname: '든든한 철수 (데모)' },
                { id: 'mock-3', nickname: '행복한 민수 (데모)' }
            ];

            const mockSelected = mockProfiles.filter(m => validation.validIds.includes(m.id));
            const realIds = validation.validIds.filter(id => !id.startsWith('mock-'));
            let realSelected = [];
            if (realIds.length > 0) {
                const { data: profiles } = await dbClient
                    .from('profiles')
                    .select('id, nickname')
                    .in('id', realIds);
                if (profiles) {
                    realSelected = profiles.map(p => ({ id: p.id, nickname: p.nickname }));
                }
            }
            cleanSharedWith = [...realSelected, ...mockSelected];
        }
        
        if (!content && !image && !richContent) {
            return res.status(400).json({ error: '분석할 내용이나 이미지가 없습니다.' });
        }

        const providerToken = req.headers['x-provider-token'];
        const e2eKey = req.headers['x-e2e-key'] || null;

        const { result } = await analyzeService.analyzeDiary({
            userId: user.id,
            userEmail: user.email,
            content,
            richContent,
            image,
            title,
            mediaId,
            notebookId,
            aiConsent,
            providerToken,
            e2eKey,
            clientEmotion: req.body.emotion,
            clientResponse: req.body.response,
            createdAt,
            shared: !!shared,
            sharedWith: cleanSharedWith
        });

        return res.json(result);
    } catch (error) {
        console.error('Critical Analyze Error:', error);
        return res.json({
            success: false,
            answer: '분석 중 문제가 발생했습니다. 조금만 기다려 주시겠어요?'
        });
    }
};
