export function analyzeEmotionLocally(content) {
    if (!content) return '평온';
    
    const keywords = {
        '기쁨': { words: ['행복', '기쁨', '기뻐', '신나', '좋아', '감사', '사랑', '즐거'], score: 0 },
        '슬픔': { words: ['슬픔', '슬퍼', '눈물', '우울', '힘들어', '외로', '지쳐', '아파'], score: 0 },
        '분노': { words: ['화가', '짜증', '분노', '열받', '욱해', '스트레스', '미워'], score: 0 },
        '불안': { words: ['불안', '걱정', '두려', '무서', '긴장', '초조', '식은땀'], score: 0 }
    };
    
    // Count occurrences
    for (const emotion in keywords) {
        for (const word of keywords[emotion].words) {
            const regex = new RegExp(word, 'g');
            const matches = content.match(regex);
            if (matches) {
                keywords[emotion].score += matches.length;
            }
        }
    }
    
    // Find dominant emotion
    let dominantEmotion = '평온';
    let maxScore = 0;
    
    for (const emotion in keywords) {
        if (keywords[emotion].score > maxScore) {
            maxScore = keywords[emotion].score;
            dominantEmotion = emotion;
        }
    }
    
    return dominantEmotion;
}

export async function encryptClientSide(text, password) {
    if (!text || !password) return text;
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        
        const pwUtf8 = encoder.encode(password);
        const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
        
        const key = await crypto.subtle.importKey(
            'raw', pwHash, { name: 'AES-GCM' }, false, ['encrypt']
        );
        
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, key, data
        );
        
        const encryptedArr = new Uint8Array(encrypted);
        const hexIv = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
        const hexCipher = Array.from(encryptedArr).map(b => b.toString(16).padStart(2, '0')).join('');
        
        return `e2e:${hexIv}:${hexCipher}`;
    } catch (e) {
        console.error('Client encryption error:', e);
        return text;
    }
}

export async function decryptClientSide(encryptedText, password) {
    if (!encryptedText || !encryptedText.startsWith('e2e:')) return encryptedText;
    if (!password) return '[암호화된 문서 - 올바른 E2E 비밀번호를 설정해 주세요]';
    try {
        const parts = encryptedText.split(':');
        const hexIv = parts[1];
        const hexCipher = parts[2];
        
        const iv = new Uint8Array(hexIv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const cipherData = new Uint8Array(hexCipher.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        
        const encoder = new TextEncoder();
        const pwUtf8 = encoder.encode(password);
        const pwHash = await crypto.subtle.digest('SHA-256', pwUtf8);
        
        const key = await crypto.subtle.importKey(
            'raw', pwHash, { name: 'AES-GCM' }, false, ['decrypt']
        );
        
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv }, key, cipherData
        );
        
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error('Client decryption error:', e);
        return '[암호화된 문서 - 복호화에 실패했습니다. 비밀번호를 확인하세요]';
    }
}
