/**
 * KST (한국 표준시) 날짜 문자열 반환 (YYYY-MM-DD 형식)
 * @param {Date|number|string} [dateVal] - 변환할 기준 시간. 입력하지 않으면 현재 시간 사용
 * @returns {string} - KST 기준 YYYY-MM-DD 포맷
 */
function getKstDateKey(dateVal) {
    const now = dateVal ? new Date(dateVal) : new Date();
    // KST는 UTC보다 9시간 빠름
    const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kstTime.toISOString().split('T')[0];
}

module.exports = {
    getKstDateKey
};
