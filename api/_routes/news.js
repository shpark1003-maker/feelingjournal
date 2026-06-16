const { verifyUser, redis } = require('./shared');
const { getNewsHeadlines } = require('../_services/newsService');
const pushRepository = require('../_repositories/pushRepository');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const user = req.user;
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        // Force disable CDN and Browser Caching for news updates
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Retrieve settings from Redis (SSOT)
        const config = await pushRepository.getUserSubscriptions(user.id);
        const settings = config?.settings || {};

        // Default newsCategories
        let newsCategories = settings.newsCategories || ['business'];

        // Get news headlines based on categories
        const newsData = await getNewsHeadlines(newsCategories);
        const headlines = Array.isArray(newsData) ? newsData : (newsData.headlines || []);

        // Map headlines into categorized array for clean frontend rendering
        const categorizedNews = headlines.map(item => {
            const match = item.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (match) {
                return {
                    category: match[1],
                    title: match[2]
                };
            }
            return {
                category: 'general',
                title: item
            };
        });

        return res.json({
            success: true,
            news: categorizedNews
        });
    } catch (error) {
        console.error('Fetch News Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
