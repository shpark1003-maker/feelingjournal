const axios = require('axios');
const cheerio = require('cheerio');
const { redis } = require('../_routes/clients/redis');
const { callGemini } = require('../_routes/clients/gemini');

const YONHAP_RSS_MAP = {
    politics: 'https://www.yna.co.kr/rss/politics.xml',
    business: 'https://www.yna.co.kr/rss/economy.xml',
    society: 'https://www.yna.co.kr/rss/society.xml',
    culture: 'https://www.yna.co.kr/rss/culture.xml',
    science: 'https://www.yna.co.kr/rss/industry.xml',
    world: 'https://www.yna.co.kr/rss/international.xml',
    entertainment: 'https://www.yna.co.kr/rss/entertainment.xml',
    sports: 'https://www.yna.co.kr/rss/sports.xml'
};

const BLACKLIST_REGEX = /\[부고\]|\[인사\]|\[동정\]|\[게시판\]|\[프로필\]|부고|인사|동정|모집|헤드라인|이 시각|인터뷰|대담|동행취재|프로필/;

async function getNewsHeadlines(categories = ['business']) {
    const activeCategories = Array.isArray(categories) && categories.length > 0 ? categories : ['business'];
    
    // YYYYMMDDHH Format in KST
    const nowKST = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
    const dateHour = nowKST.toISOString().replace(/[-T:]/g, '').slice(0, 10);

    const finalHeadlines = [];
    let overallAiFiltered = true;

    // Cross-category deduplication sets (Moved outside loop to prevent duplicates between culture, science, business etc.)
    const seenLinks = new Set();
    const seenTitles = new Set();

    for (const cat of activeCategories) {
        const cacheKey = `system:news-cache:${cat}:${dateHour}`;
        
        // 1. Try Cache
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && Array.isArray(parsed.headlines)) {
                    for (const h of parsed.headlines) {
                        // Extract plain title by stripping category prefix e.g., "[science] "
                        const titleOnly = h.replace(/^\[[^\]]+\]\s*/, '');
                        const normalized = titleOnly.replace(/[^a-zA-Z0-9가-힣]/g, '');
                        
                        if (seenTitles.has(normalized)) continue;
                        seenTitles.add(normalized);
                        finalHeadlines.push(h);
                    }
                    if (parsed.aiFiltered === false) {
                        overallAiFiltered = false;
                    }
                    continue;
                }
            }
        } catch (e) {
            console.warn(`--- [NEWS CACHE READ ERROR] Category: ${cat}, Error: ${e.message} ---`);
        }

        const url = YONHAP_RSS_MAP[cat] || 'https://www.yna.co.kr/rss/news.xml';
        let articles = [];

        // Fetch RSS Feed
        try {
            const res = await axios.get(url, { timeout: 1500 });
            const $ = cheerio.load(res.data, { xmlMode: true });
            
            $('item').slice(0, 10).each((i, el) => {
                const title = $(el).find('title').text().replace(/ - [^-]+$/, '').trim();
                const link = $(el).find('link').text().trim();
                if (title) {
                    articles.push({ title, link });
                }
            });
        } catch (fetchErr) {
            console.error(`--- [NEWS FETCH ERROR] URL: ${url}, Error: ${fetchErr.message} ---`);
            continue;
        }

        // --- Step 1: Rule-based Filtering & Deduplication ---
        const ruleFilteredArticles = [];

        for (const art of articles) {
            // Secondary absolute check for matching key-words
            const strippedTitle = art.title.replace(/[^a-zA-Z0-9가-힣]/g, '');
            const hasObjectionableWord = ['부고', '인사', '동정', '모집', '헤드라인', '이시각', '인터뷰', '대담', '동행취재', '프로필'].some(word => strippedTitle.includes(word));

            // Static blacklist regex check or word containment check
            if (hasObjectionableWord || BLACKLIST_REGEX.test(art.title)) {
                console.log(`[NEWS FILTERED - BLACKLIST] Title: "${art.title}"`);
                continue;
            }

            // Deduplication: URL check
            if (seenLinks.has(art.link)) {
                console.log(`[NEWS FILTERED - DUP LINK] Title: "${art.title}"`);
                continue;
            }

            // Deduplication: Normalized title check
            const normalizedTitle = art.title.replace(/[^a-zA-Z0-9가-힣]/g, '');
            if (seenTitles.has(normalizedTitle)) {
                console.log(`[NEWS FILTERED - DUP TITLE] Title: "${art.title}"`);
                continue;
            }

            seenLinks.add(art.link);
            seenTitles.add(normalizedTitle);
            ruleFilteredArticles.push(art);
        }

        if (ruleFilteredArticles.length === 0) {
            continue;
        }

        // --- Step 2: Gemini AI Semantic Filtering & Classification ---
        let currentCatHeadlines = [];
        let isAiSuccessful = false;

        const prompt = `너는 뉴스 헤드라인 정제 전문가이자 심리학 서비스(Feeling Journal)의 뉴스 품질 관리자다.
다음은 "${cat}" 카테고리 RSS 피드에서 수집한 기사 제목 목록이다.
이 기사 목록을 평가하여 반드시 구조화된 JSON 데이터 규격에 맞게 기사별 유지 여부(keep)를 판정하라.

[판정 조건]
1. categoryMatch: 해당 기사가 "${cat}" 카테고리(정치, 경제, 사회, 문화, 과학/IT, 세계, 연예, 스포츠 등)의 대표적인 과학/기술, 시사 이슈와 높은 적합도를 지니는가?
   - **중요**: "${cat}"이 "science"인 경우, 단순 IT 가전 출시 홍보나 가벼운 잡담성 기사는 제외하고, 연구 성과, 신기술 발표, 우주/생명과학 등 **학술적이고 전문적인 내용**을 적극 우선하십시오.
2. careSafe: 자살, 테러, 자극적인 살인/폭행 사건사고, 혐오 발언, 부고 등 심리학 서비스 사용자에게 불필요한 부정적 자극이나 트리거를 주지 않는 정서적으로 안전한 기사인가?
3. exclusionRules: 인물의 동정(동향, 근황, 프로필성 소식)이나 기자의 인터뷰(대담, 독점 인터뷰 등) 형식의 기사는 정서 환기 및 고품질 정보 제공 목적에 어긋나므로 **절대로 노출하지 말고 keep을 false로 처리하십시오**.
4. keep: categoryMatch와 careSafe가 모두 true이고, exclusionRules에 걸리지 않는 경우에만 true로 지정하십시오.

[평가할 기사 제목 목록]
${ruleFilteredArticles.map((a, idx) => `${idx + 1}. ${a.title}`).join('\n')}
`;

        const schema = {
            type: "OBJECT",
            properties: {
                curatedHeadlines: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            title: { type: "STRING" },
                            keep: { type: "BOOLEAN" },
                            categoryMatch: { type: "BOOLEAN" },
                            careSafe: { type: "BOOLEAN" },
                            reason: { type: "STRING" }
                        },
                        required: ["title", "keep", "categoryMatch", "careSafe"]
                    }
                }
            },
            required: ["curatedHeadlines"]
        };

        try {
            // Structuring response using JSON MimeType and responseSchema constraints
            const response = await callGemini(prompt, {
                responseMimeType: "application/json",
                responseSchema: schema
            }, 2, null, true, 10000); // 10s timeout for fast response

            const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
                const parsedResult = JSON.parse(text);
                if (parsedResult && Array.isArray(parsedResult.curatedHeadlines)) {
                    // Extract kept headlines
                    parsedResult.curatedHeadlines.forEach(item => {
                        if (item.keep) {
                            currentCatHeadlines.push(`[${cat}] ${item.title}`);
                        }
                    });
                    isAiSuccessful = true;
                }
            }
        } catch (aiErr) {
            console.warn(`--- [NEWS AI FILTER FAILURE] Category: ${cat}. Fallback to Rule-based Filter. Reason:`, aiErr.message);
        }

        // --- Step 3: Fallback Handler ---
        if (!isAiSuccessful) {
            overallAiFiltered = false;
            // Fallback: Use all ruleFilteredArticles (max 3 to keep it clean)
            ruleFilteredArticles.slice(0, 3).forEach(art => {
                currentCatHeadlines.push(`[${cat}] ${art.title}`);
            });
        }

        // Cap output to maximum 3 headlines per category to avoid cluttering (2~3 articles)
        const cappedHeadlines = currentCatHeadlines.slice(0, 3);

        // Cache the result (expire in 1 hour)
        const cacheData = {
            headlines: cappedHeadlines,
            aiFiltered: isAiSuccessful
        };
        
        try {
            await redis.set(cacheKey, JSON.stringify(cacheData), 'EX', 3600);
        } catch (cacheErr) {
            console.error('--- [NEWS CACHE SAVE ERROR] Failed to cache news:', cacheErr.message);
        }

        cappedHeadlines.forEach(h => finalHeadlines.push(h));
    }

    return {
        headlines: finalHeadlines,
        aiFiltered: overallAiFiltered
    };
}

module.exports = {
    getNewsHeadlines
};
