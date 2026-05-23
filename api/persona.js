const {
    supabase,
    redis,
    sendError
} = require('./shared');

// Zero-dependency pure-Node.js multipart/form-data parser
const parseMultipart = (req) => {
    return new Promise((resolve, reject) => {
        let chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const contentType = req.headers['content-type'];
            if (!contentType) return resolve(null);
            
            const boundaryMatch = contentType.match(/boundary=(.+)$/);
            if (!boundaryMatch) return resolve(null);
            const boundary = boundaryMatch[1];
            
            const boundaryBytes = Buffer.from('--' + boundary);
            let startIdx = buffer.indexOf(boundaryBytes);
            if (startIdx === -1) return resolve(null);
            
            while (startIdx !== -1) {
                const nextBoundaryIdx = buffer.indexOf(boundaryBytes, startIdx + boundaryBytes.length);
                if (nextBoundaryIdx === -1) break;
                
                const part = buffer.subarray(startIdx + boundaryBytes.length, nextBoundaryIdx);
                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd !== -1) {
                    const header = part.subarray(0, headerEnd).toString('utf-8');
                    if (header.includes('name="avatar"') || header.includes('filename=')) {
                        const body = part.subarray(headerEnd + 4, part.length - 2); // trim trailing \r\n
                        return resolve(body);
                    }
                }
                startIdx = nextBoundaryIdx;
            }
            resolve(null);
        });
        req.on('error', (err) => reject(err));
    });
};

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        req.user = user;

        const url = req.url;
        const path = url.split('?')[0];

        // 1. GET /api/persona
        if (req.method === 'GET' && path === '/api/persona') {
            const persona = await redis.get(`user:${req.user.id}:persona`);
            return res.json({ success: true, persona: persona ? JSON.parse(persona) : null });
        }

        // 2. POST /api/persona
        if (req.method === 'POST' && path === '/api/persona') {
            const { persona } = req.body;
            const oldRaw = await redis.get(`user:${req.user.id}:persona`);
            const old = oldRaw ? JSON.parse(oldRaw) : {};
            const merged = { ...old, ...persona };
            await redis.set(`user:${req.user.id}:persona`, JSON.stringify(merged));
            return res.json({ success: true });
        }

        // 3. POST /api/persona/avatar (Base64 conversion)
        if (req.method === 'POST' && path.includes('/avatar')) {
            try {
                const fileBuffer = await parseMultipart(req);
                if (!fileBuffer) {
                    return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
                }

                // Convert to data URI to save in Redis
                const base64Image = fileBuffer.toString('base64');
                const avatarUrl = `data:image/png;base64,${base64Image}`;

                const personaRaw = await redis.get(`user:${req.user.id}:persona`);
                const persona = personaRaw ? JSON.parse(personaRaw) : {};
                persona.avatarUrl = avatarUrl;
                await redis.set(`user:${req.user.id}:persona`, JSON.stringify(persona));

                return res.json({ success: true, avatarUrl });
            } catch (uploadErr) {
                console.error('Avatar Upload Parse Error:', uploadErr);
                return res.status(500).json({ error: '아바타 업로드 파싱 실패' });
            }
        }

        // 4. POST /api/persona/generate-avatar
        if (req.method === 'POST' && path.includes('/generate-avatar')) {
            const personaRaw = await redis.get(`user:${req.user.id}:persona`);
            const p = personaRaw ? JSON.parse(personaRaw) : { gender: '여성', age: '20대' };
            
            const isFemale = p.gender === '여성';
            const is30s = p.age === '30대';
            
            const options = [];
            for (let i = 0; i < 4; i++) {
                const seed = Math.floor(Math.random() * 10000);
                let params = `seed=${seed}`;
                
                if (isFemale) {
                    const tops = is30s 
                        ? 'longHair,bun,straight02,classic01'
                        : 'longHairCurvy,shortHair,straight01,turban';
                    params += `&top=${tops}&accessories=none,prescription01,round`;
                    params += `&clothing=blazer,collarAndSweater,overall`;
                } else {
                    const tops = is30s 
                        ? 'shortHair,shortCurly,classic02'
                        : 'shortHair,frizzle,shaggy,sides';
                    params += `&top=${tops}&facialHair=none,beardLight`;
                    params += `&clothing=blazer,graphicShirt,hoodie`;
                }
                
                options.push(`https://api.dicebear.com/7.x/avataaars/svg?${params}`);
            }
            
            return res.json({ success: true, options });
        }

        // 5. POST /api/persona/learn-video (Fallback)
        if (req.method === 'POST' && path.includes('/learn-video')) {
            return res.json({
                success: true,
                analysis: {
                    name: "스타일리시 원이",
                    gender: "여성",
                    personality: "매우 매력적이고 활발한 성격으로, 사용자에게 건강하고 활기찬 기운을 불어넣습니다.",
                    speech_guide: "안녕! 오늘 하루도 정말 열심히 달렸구나. 곁에서 힘껏 응원할게! ✨",
                    suggested_relationship: "친구/멘토",
                    voice_features: "생기 넘치고 맑은 어조"
                },
                avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=learnMock"
            });
        }

        return res.status(404).json({ error: 'Endpoint Not Found' });
    } catch (error) {
        console.error('Persona API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
