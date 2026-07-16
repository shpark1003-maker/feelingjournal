const trimmed = '오늘 선호께서 가장 먼저 집중하셔야 할 핵심 과제는 바로 **"관심 분야의 최근 3년 내 주요 학술지 논';
const finishReason = 'MAX_TOKENS';
function looksTruncatedBriefing(text, finishReason) {
    if (!text) return true;
    if (finishReason === 'MAX_TOKENS') return true;
    if (/제목\s*:\s*오늘 가장 먼저 해야 할 일|오늘 가장 먼저 해야 할 일/i.test(text)) return false;
    if (/[,:;\-]\s*$/.test(text)) return true;
    if (text.length >= 220 && !/[.!?…]\s*$/.test(text)) return true;
    
    // Check if it ends without punctuation and no closing quotes/stars if opened
    if (!/[.!?…]\s*$/.test(text)) return true; // Let's test if we just add this

    return false;
}
console.log(looksTruncatedBriefing(trimmed, finishReason));
