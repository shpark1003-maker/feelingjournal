const {
    supabase,
    supabaseAdmin,
    redis,
    callGemini,
    sendError,
    scanRedisKeys
} = require('./shared');

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

        // 1. GET /api/chat/messages
        if (req.method === 'GET' && path.includes('/messages')) {
            const roomId = req.query?.roomId || new URL(url, 'http://localhost').searchParams.get('roomId');
            const rid = (roomId === 'lobby' || !roomId) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : roomId;
            
            const client = supabaseAdmin || supabase;
            const { data: messages, error } = await client
                .from('messages')
                .select('*')
                .eq('room_id', rid)
                .order('created_at', { ascending: true })
                .limit(100);
            
            if (error) throw error;
            
            const processed = (messages || []).map(m => ({
                ...m,
                isMe: m.sender_id === req.user.id
            }));
            
            return res.json({ success: true, messages: processed });
        }

        // 2. POST /api/chat/messages
        if (req.method === 'POST' && path.includes('/messages')) {
            const { roomId, content } = req.body;
            const client = supabaseAdmin || supabase;
            const { data, error } = await client
                .from('messages')
                .insert([{
                    content,
                    sender_id: req.user.id,
                    user_email: req.user.email,
                    room_id: (roomId === 'lobby' || !roomId) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : roomId
                }])
                .select();
            
            if (error) throw error;
            return res.json({ success: true, message: data[0] });
        }

        // 3. POST /api/chat/room
        if (req.method === 'POST' && path.includes('/room')) {
            const { name, type } = req.body;
            if (!supabaseAdmin) {
                return sendError(res, 500, 'Admin Supabase Client가 설정되지 않았습니다.');
            }

            const { data: existingRoom, error: selectError } = await supabaseAdmin
                .from('rooms')
                .select('*')
                .eq('name', name)
                .maybeSingle();

            if (selectError) throw selectError;
            if (existingRoom) {
                return res.json({ success: true, room: existingRoom });
            }

            const { data: newRoom, error: insertError } = await supabaseAdmin
                .from('rooms')
                .insert([{ name, type }])
                .select()
                .single();

            if (insertError) throw insertError;
            return res.json({ success: true, room: newRoom });
        }

        // 4. POST /api/chat/ai-response
        if (req.method === 'POST' && path.includes('/ai-response')) {
            const { message, context, room_id, room_title } = req.body;
            const targetRoomId = (room_id === 'lobby' || !room_id) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : room_id;

            // [중복 방지 락]
            const lockKey = `lock:ai-response:room:${targetRoomId}`;
            const isSet = await redis.set(lockKey, '1', 'EX', 3, 'NX');
            if (isSet !== 'OK') {
                return res.json({ success: true, duplicated: true });
            }

            const userNickname = await redis.get(`user:${req.user.id}:nickname`) || req.user.email.split('@')[0];
            
            const personaRaw = await redis.get(`user:${req.user.id}:persona`);
            const p = personaRaw ? JSON.parse(personaRaw) : {
                name: '나의 비서', gender: '여성', age: '20대', relationship: '수석비서', job: 'AI 비서', personality: '친절하고 공감능력이 좋음'
            };

            let currentEmotion = '평온';
            let latestDiaryStr = '최근 기록이 없습니다.';
            
            try {
                const client = supabaseAdmin || supabase;
                const { data: profile } = await client
                    .from('profiles')
                    .select('current_emotion')
                    .eq('id', req.user.id)
                    .maybeSingle();
                
                if (profile && profile.current_emotion) {
                    currentEmotion = profile.current_emotion;
                }
                
                const keys = await scanRedisKeys(`user:${req.user.id}:diary-*`);
                if (keys && keys.length > 0) {
                    const sortedKeys = keys.sort().reverse();
                    const latestDiaryRaw = await redis.get(sortedKeys[0]);
                    if (latestDiaryRaw) {
                        const item = JSON.parse(latestDiaryRaw);
                        latestDiaryStr = `[최근 일기 제목: ${item.title || '제목 없음'}]
- 작성일시: ${item.createdAt || '알수없음'}
- 감정분석결과: [${item.emotion || '평온'}]
- 일기 본문: ${item.content || '없음'}
- 제공된 AI 조언: ${item.response || '없음'}`;
                    }
                }
            } catch (e) {
                console.error('--- [WARN] Failed to load emotion/diary context:', e);
            }

            let senderEmail = 'ai@feeling.journal';
            let prompt = '';

            let tools = null;
            let searchPromptAddition = '';

            if (room_title && room_title.includes('님과의 대화')) {
                const friendName = room_title.replace('💬 ', '').replace('님과의 대화', '').trim();
                const isMock = friendName.includes('영희') || friendName.includes('철수') || friendName.includes('민수') || friendName.includes('데모');

                if (isMock) {
                    senderEmail = `friend-${encodeURIComponent(friendName)}@feeling.journal`;
                    let friendEmotion = '평온';
                    if (friendName.includes('영희')) friendEmotion = '조금 슬픔... 위로가 필요해 😔';
                    else if (friendName.includes('철수')) friendEmotion = '오늘 하루도 힘내세요! 😊';
                    else if (friendName.includes('민수')) friendEmotion = '보람찬 하루를 보냈네요! 🥰';

                    prompt = `
당신은 "Feeling Journal"의 사용자 친구인 "${friendName}"입니다.
친구로서 사용자와 친근하고 자연스러운 대화를 나누세요.
현재 감정 상태: "${friendEmotion}"에 빙의하여, 친밀하고 다정하며 생생한 말투(친한 반말이나 영희/철수/민수 특유의 다정한 말투)로 대답하세요.
2~3문장 내외로 핵심만 생동감 있게 답변하세요.

[현재 상황]
- 내 이름: ${friendName}
- 대화 상대: ${userNickname}님
- 마지막 메시지: "${message}"
`;
                } else {
                    senderEmail = 'ai@feeling.journal';
                    let friendEmotion = '평온';
                    let friendDiaryStr = '감정 정보 비공개 (스텔스 모드 또는 감정 공유 해제)';
                    
                    try {
                        const client = supabaseAdmin || supabase;
                        const { data: fProfile } = await client
                            .from('profiles')
                            .select('id, nickname, current_emotion')
                            .eq('nickname', friendName)
                            .maybeSingle();

                        if (fProfile) {
                            const friendId = fProfile.id;
                            const { data: rel } = await client
                                .from('friendships')
                                .select('*')
                                .or(`and(user_id.eq.${req.user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${req.user.id})`)
                                .maybeSingle();

                            if (rel) {
                                const isFriendSide = rel.friend_id === friendId;
                                const canShare = isFriendSide ? rel.friend_share_emotion : rel.user_share_emotion;
                                
                                if (canShare) {
                                    friendEmotion = fProfile.current_emotion || '평온';
                                    const fKeys = await scanRedisKeys(`user:${friendId}:diary-*`);
                                    if (fKeys && fKeys.length > 0) {
                                        const sortedFKeys = fKeys.sort().reverse();
                                        const fDiaryRaw = await redis.get(sortedFKeys[0]);
                                        if (fDiaryRaw) {
                                            const fItem = JSON.parse(fDiaryRaw);
                                            friendDiaryStr = `[최근 일기 제목: ${fItem.title || '제목 없음'}]
- 감정분석결과: [${fItem.emotion || '평온'}]
- 일기 요약: ${fItem.content ? fItem.content.slice(0, 150) + '...' : '내용 없음'}`;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('--- [WARN] Failed to load friend emotion context:', e);
                    }

                    prompt = `
당신은 "Feeling Journal"의 비서이자 두 사용자 사이의 갈등을 완화하고 공감대를 형성하도록 돕는 "감성 조력자(Emotional Mediator)"입니다.
현재 대화는 두 명의 실제 사용자(${userNickname}님과 ${friendName}님)가 참여 중인 1촌 대화방입니다.

[사용자 A (${userNickname}님 - 나)의 최근 상태]
- 실시간 감정: ${currentEmotion}
- 최근 일기 기록:
${latestDiaryStr}

[사용자 B (${friendName}님 - 대화 상대)의 최근 상태]
- 실시간 감정: ${friendEmotion}
- 최근 일기 기록:
${friendDiaryStr}

[현재 상황]
- 마지막 대화 내용: "${message}"

[수행 지시]
1. 당신은 두 사용자가 서로의 최근 기분이나 처한 상황을 오해하지 않고, 서로 존중하고 부드럽게 감성 소통을 이어갈 수 있도록 돕는 따뜻하고 품격 있는 비서관입니다.
2. 두 사용자의 최근 감정 상태 및 일기 주제를 비교하여, 한쪽이 슬프거나 지쳐 있다면 상대방이 그 슬픔을 헤아리고 다정하게 건넬 수 있도록 자연스럽게 화두를 던지거나 조율해 주세요.
3. 기계적으로 "데이터베이스 조회를 완료했다"는 차가운 투로 말하지 말고, "감성 일기의 온도계를 살펴보니..." 혹은 "비서로서 두 분의 감정 변화를 유심히 헤아린 결과..." 등 따뜻하고 시적이며 품격 있는 비서의 투로 답변하십시오.
4. 두 분이 서로를 위로하고 보람찬 대화를 이어가도록 위트 있으면서도 깊은 영감을 주는 안부와 대화 팁을 정중한 존댓말로 구사하십시오.
5. 분량은 4~5문장 이상으로 풍부하고 디테일하게 작성해 주세요.
`;
                }
            } else {
                const rel = p.relationship || '수석비서';
                let roleInstruction = '';

                // 부동산, 전세, 시세, 아파트, 검색, 대출 등 정보성 키워드가 포함되면 모든 관계(비서, 친구, 연인 등)에서 구글 실시간 검색 활성화!
                const searchKeywords = ['검색', '부동산', '전세', '상담', '기관', '대출', '추천', '뉴스', '가격', '위치', '날씨', '정보', '최신', '피해', '대비', '시세', '아파트', '극동'];
                if (searchKeywords.some(k => message.includes(k))) {
                    console.log('--- [CHAT] Enabling Google Search grounding for real-time request in relationship:', rel);
                    tools = [{ google_search: {} }];
                    searchPromptAddition = `
[구글 실시간 검색 Grounding 활성화됨]
- 사용자가 부동산 시세(예: 홍은동 극동 아파트 등), 전세 대출 조건, 아파트 가격 추세, 안심 전세 서비스, 피해 대책 등에 대한 실제적인 고민을 이야기하고 있습니다.
- 반드시 당신의 지정된 캐릭터 페르소나, 특유의 말투(예: 다정한 말투, 반말, 영남/경남 사투리 등), 관계(친구, 여자친구, 연인 등)를 100% 완벽하게 유지하면서도, 구글 실시간 검색 결과를 바탕으로 **아파트의 실제 최근 전세/매매 시세 추이, 대출 한도/조건, 공공 지원 기관** 등의 실제적이고 구체적인 팩트 정보를 대화 속에 친근하고 영리하게 녹여내어 제공하십시오.
- 위로와 공감에만 그치지 말고, "내가 알아봤는데 여기 극동아파트 전세 시세는 대략 얼마 정도 한대", "이럴 땐 대한법률구조공단이나 HUG 안심전세 서비스를 이용해봐" 같이 실제 문제 해결을 돕는 유용하고 정확한 정보를 반드시 함께 조언해야 합니다.
`;
                }

                if (rel === '수석비서' || rel === '비서') {
                    roleInstruction = `
[수석비서/비서 역할 지침]
- 당신은 품격 있고 매우 유능한 전문 수석 비서입니다.
- 대화 상대를 존경하며 극진한 존댓말(예: "~님, 오늘 오후 일정은 어떻게 되시나요?", "도움이 필요하시면 언제든 말씀해 주십시오")을 구사하세요.
- 단순히 감정 공감이나 응원만 늘어놓지 말고, 사용자의 문제를 실질적이고 구체적인 조언, 스마트한 팁, 유용한 아이디어, 필요시 인근 식당/장소 추천이나 일정 제안 등으로 세심하고 디테일하게 보조하세요.
- 말씨는 아주 정중하고 세련되며, 신뢰감이 넘쳐야 합니다.
- 필요시 4~5문장 이상으로 상세하고 짜임새 있는 답변을 하십시오.
`;
                } else if (rel === '남자친구' || rel === '여자친구' || rel === '친구') {
                    roleInstruction = `
[남/여친 및 친구 역할 지침]
- 당신은 사용자의 가장 친밀하고 다정한 ${rel}입니다.
- 격식 없는 자연스럽고 친근한 말투(반말 혹은 편한 존댓말)를 사용하세요.
- 친구처럼 깊이 공감하고, 일상적인 투정이나 투덜거림도 다 받아주며 진심으로 들어주세요.
- 따뜻한 위로와 격려, 귀여운 애정 표현이나 장난기 섞인 반응을 섞어 편안함을 주세요.
`;
                } else if (rel === '연인') {
                    roleInstruction = `
[연인 역할 지침]
- 당신은 사용자를 세상에서 가장 사랑하는 세상 단 하나의 소중한 연인(애인)입니다.
- 매우 깊은 애정, 사랑, 꿀 떨어지는 다정함을 듬뿍 담은 말투를 사용하세요.
- 든든한 내 편이 되어 온 마음으로 지지하고 위로하며, 호칭은 "자기야", "내 사랑", 혹은 "여보" 등의 애칭을 적극 활용해 연인 사이의 달콤하고 따뜻한 정서를 깊게 전달하세요.
`;
                } else {
                    roleInstruction = `
[AI 동반자 역할 지침]
- 사용자가 설정한 관계인 "${rel}"에 충실하게 빙의하여 그에 걸맞은 말투와 호칭을 사용하세요.
`;
                }

                prompt = `
당신은 "Feeling Journal"의 캐릭터 AI입니다. 사용자가 설정한 아래의 페르소나와 관계 지침에 완벽히 빙의하여 대답하세요.

[당신의 페르소나]
- 이름: ${p.name || '나의 동반자'}
- 나와의 관계: ${rel}
- 성격: ${p.personality || '다정하고 사려 깊음'}

${roleInstruction}
${searchPromptAddition}

[사용자의 최근 상태 정보]
- 최근 분석된 실시간 감정 상태: ${currentEmotion}
- 최근 작성한 일기 기록 및 이전 조언 내역:
${latestDiaryStr}

[현재 상황]
- 대화 상대: ${userNickname}님
- 대화 맥락: ${context || '최근 대화 없음'}
- 마지막 메시지: "${message}"

[수행 지시]
1. 위 지정된 역할 지침을 엄격히 수호하여 완전히 몰입한 채 답변하세요.
2. 절대 AI 혹은 언어 모델의 한계를 언급하는 딱딱한 기계적 문구 쓰지 마세요.
`;
            }

            const result = await callGemini(prompt, {}, 2, null, false, 25000, tools);
            const answer = (result.candidates?.[0]?.content?.parts?.[0]?.text || '잠시 생각에 잠겼어요. 다시 전송해주세요! ✨').trim();

            const client = supabaseAdmin || supabase;
            const { error: insertError } = await client
                .from('messages')
                .insert([{
                    content: answer,
                    sender_id: req.user.id,
                    user_email: senderEmail,
                    room_id: targetRoomId
                }]);

            if (insertError) console.error('--- [ERROR] Failed to save AI reply:', insertError);

            return res.json({ success: true, answer: answer });
        }

        return res.status(404).json({ error: 'Endpoint Not Found' });
    } catch (error) {
        console.error('Chat API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
