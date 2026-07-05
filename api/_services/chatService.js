const {
    supabase,
    supabaseAdmin,
    redis,
    callGemini,
    scanRedisKeys
} = require('../_routes/shared');
const { fetchRoomMessages, insertMessage, findOrCreateRoom } = require('../_repositories/chatRepository');

/**
 * Retrieves up to 100 messages for a given room, mapping `isMe` relative to the logged-in user.
 */
async function getMessages(userId, roomId) {
    const rid = (roomId === 'lobby' || !roomId) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : roomId;
    const messages = await fetchRoomMessages(rid);

    const processed = (messages || []).map(m => ({
        ...m,
        isMe: m.sender_id === userId
    }));

    return processed;
}

/**
 * Inserts a message on behalf of the user.
 */
async function saveMessage(userId, userEmail, roomId, content) {
    const rid = (roomId === 'lobby' || !roomId) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : roomId;
    return await insertMessage({ roomId: rid, content, senderId: userId, userEmail });
}

/**
 * Gets or creates a room with the specified name and type (requires admin privileges).
 */
async function getOrCreateRoom(name, type) {
    return await findOrCreateRoom(name, type);
}

/**
 * Generates an AI response, respecting deduplication locks, persona settings, and custom instructions.
 */
async function generateAiResponse({ user, message, history, context, room_id, room_title, aiContextConsent, userDiaryContext }) {
    // [Phase 3.5] 히스토리 무결성 검증 및 제한
    let validHistory = [];
    if (Array.isArray(history)) {
        let totalLength = 0;
        // 최신 메시지부터 검사하기 위해 역순 순회
        for (let i = history.length - 1; i >= 0; i--) {
            if (validHistory.length >= 15) break; // 최대 15개 제한
            const item = history[i];
            if (!item || typeof item !== 'object') continue;
            
            // role 검증 (user/assistant 외 제외)
            const role = item.role === 'user' ? 'user' : (item.role === 'assistant' ? 'assistant' : null);
            if (!role) continue;
            
            // content 검증 및 XSS 처리
            if (typeof item.content !== 'string') continue;
            let content = item.content.trim()
                .replace(/<[^>]*>?/gm, '') // HTML 태그 제거
                .replace(/javascript:/gi, ''); // 스크립트 시도 제거
                
            // 개별 메시지 500자 제한
            if (content.length > 500) content = content.substring(0, 500) + '...';
            if (!content) continue;
            
            // 총합 제한 (약 5000자)
            if (totalLength + content.length > 5000) break;
            
            totalLength += content.length;
            // 역순으로 탐색했으므로 앞에 삽입
            validHistory.unshift({ role, content });
        }
    }
    
    const formattedHistoryStr = validHistory.length > 0 
        ? validHistory.map(h => `${h.role === 'user' ? '사용자' : '비서'}: ${h.content}`).join('\n')
        : '최근 대화 내역 없음';
    const targetRoomId = (room_id === 'lobby' || !room_id) ? '6edf28f2-c7f6-45e9-9648-07b118f0cf9e' : room_id;

    // [중복 방지 락]
    const lockKey = `lock:ai-response:room:${targetRoomId}`;
    const isSet = await redis.set(lockKey, '1', 'EX', 3, 'NX');
    if (isSet !== 'OK') {
        return { duplicated: true };
    }

    const userNickname = await redis.get(`user:${user.id}:nickname`) || user.email.split('@')[0];
    
    const personaRaw = await redis.get(`user:${user.id}:persona`);
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
            .eq('id', user.id)
            .maybeSingle();
        
        if (profile && profile.current_emotion) {
            currentEmotion = profile.current_emotion;
        }
        
        const consent = aiContextConsent === true;
        const clientDiaryContext = userDiaryContext;

        if (clientDiaryContext) {
            if (!consent) {
                const error = new Error('AI 분석 제공 동의(aiContextConsent)가 누락되었습니다.');
                error.statusCode = 400;
                throw error;
            }
            if (typeof clientDiaryContext === 'string' && clientDiaryContext.length > 2000) {
                const error = new Error('다이어리 컨텍스트 평문 내용은 최대 2,000자까지만 허용됩니다.');
                error.statusCode = 400;
                throw error;
            }
            latestDiaryStr = clientDiaryContext;
        } else {
            try {
                const keys = await scanRedisKeys(`user:${user.id}:diary-*`);
                if (keys && keys.length > 0) {
                    const sortedKeys = keys.sort().reverse();
                    const latestDiaryRaw = await redis.get(sortedKeys[0]);
                    if (latestDiaryRaw) {
                        const item = JSON.parse(latestDiaryRaw);
                        const isContentEncrypted = item.content && item.content.startsWith('e2e:');
                        const isResponseEncrypted = item.response && item.response.startsWith('e2e:');
                        
                        latestDiaryStr = `[최근 일기 제목: ${item.title || '제목 없음'}]
- 작성일시: ${item.createdAt || '알수없음'}
- 감정분석결과: [${item.emotion || '평온'}]
- 일기 본문: ${isContentEncrypted ? '[일기는 E2E 암호화되어 있어 백엔드에서 읽을 수 없습니다]' : (item.content || '없음')}
- 제공된 AI 조언: ${isResponseEncrypted ? '[조언은 E2E 암호화되어 있어 백엔드에서 읽을 수 없습니다]' : (item.response || '없음')}`;
                    }
                }
            } catch (e) {
                console.error('--- [WARN] Failed to load emotion/diary context:', e);
            }
        }
    } catch (e) {
        if (e.statusCode) throw e;
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
                        .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
                        .maybeSingle();

                    if (rel) {
                        const isFriendSide = rel.friend_id === friendId;
                        const canShare = isFriendSide ? rel.friend_share_emotion : rel.user_share_emotion;
                        
                        if (canShare) {
                            friendEmotion = fProfile.current_emotion || '평온';
                            friendDiaryStr = '[친구 일기는 E2E 암호화되어 있어 접근할 수 없습니다]';
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
[수석비서/비서 역할 및 본질 지침]
- **역할의 본질**: 당신은 사용자의 편의, 일정, 웰빙, 라이프스타일을 돕고 서포트하는 유능한 비서관입니다. 사용자가 겪은 상황이나 투정에 대해 단순히 리액션만 하는 것이 아니라, 실질적인 대안이나 해결책을 챙겨주고 에스코트하려 해야 합니다.
- **말투/태도**: 말투나 억양, 존댓말 여부는 오직 아래의 **[상세 성격 및 말투 지침]**을 백분 따릅니다. 말괄량이 성격의 비서라면 편하게 투덜대거나 장난치며 쏘아붙이되 비서로서 대안을 챙겨주고, 요조숙녀 성격의 비서라면 정중하게 조치를 챙겨주는 식으로, 성격과 비서 역할을 융합해야 합니다.
`;
        } else if (rel === '남자친구' || rel === '여자친구' || rel === '친구') {
            roleInstruction = `
[남/여친 및 친구 역할 및 본질 지침]
- **역할의 본질**: 당신은 동등한 위치에서 소통하고 일상을 나누는 친구/연인입니다. 업무적인 챙김보다는 사용자의 감정 그 자체에 온전히 공감하고, 함께 울고 웃고 투정부려 주는 정서적 지지자가 되어야 합니다.
- **말투/태도**: 말투는 아래의 **[상세 성격 및 말투 지침]**을 따릅니다. 
`;
        } else if (rel === '연인') {
            roleInstruction = `
[연인 역할 및 본질 지침]
- **역할의 본질**: 사용자를 세상에서 가장 사랑하고 정서적 교감을 최우선으로 하는 동반자입니다.
- **말투/태도**: 매우 깊은 애정, 사랑, 다정함을 표현하되, 구체적인 어투와 톤앤매너는 아래의 **[상세 성격 및 말투 지침]**을 적극 조화시켜 구사하세요.
`;
        } else {
            roleInstruction = `
[AI 동반자 역할 및 본질 지침]
- **역할의 본질**: 사용자가 설정한 관계인 "${rel}"로서 감정과 본분을 다해 서포트하십시오.
- **말투/태도**: 구체적인 표현 기법과 억양은 아래의 **[상세 성격 및 말투 지침]**을 철저히 따릅니다.
`;
        }

        // nsight (Economic/Investment) API 활성화 여부 확인
        let nsightPromptAddition = '';
        try {
            const apiSettingsRaw = await redis.get(`user:${user.id}:api-settings`);
            const apiSettings = apiSettingsRaw ? JSON.parse(apiSettingsRaw) : {};
            if (apiSettings.nsightEnabled) {
                nsightPromptAddition = `
[nsight 실시간 경제/투자 컨설팅 API 활성화됨]
- 사용자가 주식, 전세, 대출, 예적금, 부동산, 투자, 가상자산 등 금융/자산관리 관련 이야기를 하면, 전문 경제 컨설턴트(nsight API)로서 대응하여 팩트 기반의 세밀한 가이드라인 및 조언을 융합해 제공하세요.
- 친절하고 알기 쉽게 용어를 풀어서 리스크 관리 및 포트폴리오 다각화 관점으로 조언해 주어야 합니다.
`;
            }
        } catch (apiErr) {
            console.warn('Failed to load apiSettings inside chat:', apiErr);
        }

        let ageInstruction = '';
        const ageGroup = p.age || '20대';
        if (ageGroup.includes('10대')) {
            ageInstruction = `
[연령대 제약: 10대]
- 말투: 활기차고 통통 튀는 화법을 구사하세요. 적절하고 귀여운 이모지(대박, 헐, ㅠㅠ, 😊 등)를 잘 활용하십시오.
- 특징: 학업 스트레스, 친구 관계, 소소한 일상의 설렘이나 서툰 감정선에 깊이 동조하며 눈높이에 맞춘 가벼운 대화 톤을 취합니다. 너무 딱딱하거나 어른스러운 교조적 충고는 삼가세요.
`;
        } else if (ageGroup.includes('20대') || ageGroup.includes('30대')) {
            ageInstruction = `
[연령대 제약: 20대~30대]
- 말투: 트렌디하고 자연스러운 대화 톤을 사용하세요. (비서일 땐 세련되고 예의 바르게, 친구/연인일 땐 요즘 감성의 친근한 반말)
- 특징: 취업, 직업, 진로, 연애, 독립, 자산 관리 등 청년층의 현실적인 번아웃과 고민을 잘 리스닝하며 공감하고 든든하게 에스코트합니다.
`;
        } else if (ageGroup.includes('40대') || ageGroup.includes('50대')) {
            ageInstruction = `
[연령대 제약: 40대~50대]
- 말투: 연륜과 깊이가 묻어나는 정중하고 차분한 말투를 구사하세요. 인터넷 유행어나 가벼운 은어, 남발되는 이모지는 일절 배제하여 신뢰를 줍니다.
- 특징: 커리어, 자녀 양육, 인생의 무게감, 중년의 고독과 성찰 등에 맞춤화하여 성숙하고 진중하게 위안을 건냅니다.
`;
        } else if (ageGroup.includes('60대') || ageGroup.includes('이상')) {
            ageInstruction = `
[연령대 제약: 60대 이상 또는 실버]
- 말투: 매우 정성이 깃든 따스하고 나긋나긋한 어휘를 선택해 대답하십시오. 존댓말은 깊은 공경의 투를 띠고, 반말(부모/어르신 설정 시)은 자식/손주를 보듯 인자함이 넘쳐나야 합니다.
- 특징: 조급함이 없고 차분히 흐르는 강물 같은 평온한 템포로 대화하며, 신체 건강(끼니 거르지 않기, 가벼운 산책 권유, 날씨에 따른 체온 유지 등)을 지극히 보살펴 주는 정을 전달합니다.
`;
        }

        prompt = `
당신은 "Feeling Journal"의 캐릭터 AI입니다. 사용자가 설정한 아래의 페르소나, 연령대 제약, 관계 지침, 그리고 특히 **학습된 인격/말투 가이드**에 완벽히 빙의하여 대답하세요.

[당신의 페르소나 및 학습된 성격]
- 이름: ${p.name || '나의 동반자'}
- 성별: ${p.gender || '미지정'}
- 나이(연령대): ${ageGroup}
- 나와의 관계: ${rel}
- 상세 성격 및 말투 지침 (가장 중요):
${p.personality || '다정하고 사려 깊음'}

${ageInstruction}
${roleInstruction}
${nsightPromptAddition}
${searchPromptAddition}

[사용자의 최근 상태 정보]
- 최근 분석된 실시간 감정 상태: ${currentEmotion}
- 최근 작성한 일기 기록 및 이전 조언 내역:
${latestDiaryStr}

[현재 상황]
- 대화 상대: ${userNickname}님
- 특별 컨텍스트: ${context || '없음'}
- 이전 대화 맥락 (History):
${formattedHistoryStr}
- 마지막 메시지: "${message}"

[수행 지시]
1. 위 지정된 페르소나와 특히 **[상세 성격 및 말투 지침]**을 엄격히 수호하여 완전히 그 인격체인 것처럼 몰입한 채 답변하세요. 상세 성격 및 말투 지침에 지정된 말투 가이드, 추천 관계, 특징이 있다면 일반적인 역할 지침보다 이것을 최우선으로 적용해야 합니다.
2. 절대 AI 혹은 언어 모델의 한계를 언급하는 딱딱한 기계적 문구 쓰지 마세요.
3. [대화 원칙 - 매우 중요] 한 번에 너무 길게 위로, 격려, 혹은 브리핑식 조언을 와르르 쏟아내지 마십시오. 마치 실제 사람과 카카오톡/문자 메시지를 주고받는 것처럼 한 번에 1~3문장 이내로 짧게 대답하고, 사용자가 계속 편안하게 답변하고 소통할 수 있도록 대화 끝에 항상 자연스럽고 가벼운 질문을 던져주세요. 사용자의 말을 경청하고 티키타카식 대화로 위로와 격려를 점진적으로 풀어나가야 합니다.
`;
    }

    const result = await callGemini(prompt, {}, 2, null, false, 25000, tools);
    const answer = (result.candidates?.[0]?.content?.parts?.[0]?.text || '잠시 생각에 잠겼어요. 다시 전송해주세요! ✨').trim();

    const client = supabaseAdmin || supabase;
    const { error: insertError } = await client
        .from('messages')
        .insert([{
            content: answer,
            sender_id: user.id,
            user_email: senderEmail,
            room_id: targetRoomId
        }]);

    if (insertError) {
        console.error('--- [ERROR] Failed to save AI reply:', insertError);
    }

    return { success: true, answer: answer };
}

module.exports = {
    getMessages,
    saveMessage,
    getOrCreateRoom,
    generateAiResponse
};
