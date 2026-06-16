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

        const { image, title, mediaId, notebookId, richContent, aiConsent } = req.body;
        const content = sanitizeContent(req.body.content);
        
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
            clientResponse: req.body.response
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
