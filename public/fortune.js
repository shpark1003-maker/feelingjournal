window.playFortuneGame = function() {
    const today = new Date().toISOString().split('T')[0];
    
    const fortunes = [
        { title: '대길 (大吉)', text: '모든 일이 뜻대로 풀리는 최고의 하루가 될 거예요!', color: '#ff4757' },
        { title: '길 (吉)', text: '기분 좋은 일이 생길지도 모르는 즐거운 하루입니다.', color: '#ff6b81' },
        { title: '평 (平)', text: '무난하고 평화로운 하루입니다. 이 평온함을 즐기세요.', color: '#2ed573' },
        { title: '소길 (小吉)', text: '작은 행운이 찾아올 수 있습니다. 주변을 잘 살펴보세요.', color: '#1e90ff' },
        { title: '흉 (凶)', text: '조금 조심하면 액운을 피할 수 있습니다. 긍정적인 마음을 유지하세요!', color: '#747d8c' }
    ];

    const container = document.getElementById('fortune-game-container');
    if (!container) return;

    // 1. Play animation
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-4">
            <div class="text-6xl mb-4 animate-shake-cylinder" style="transform-origin: bottom center; display: inline-block;">🎋</div>
            <p class="text-sm font-bold text-primary animate-pulse">산가지를 흔들고 있습니다...</p>
        </div>
    `;

    setTimeout(() => {
        // Pick random
        const result = fortunes[Math.floor(Math.random() * fortunes.length)];
        localStorage.setItem('todayFortune_' + today, JSON.stringify(result));
        
        window.renderFortuneResult(result);
    }, 1800);
};

window.renderFortuneResult = function(result) {
    const container = document.getElementById('fortune-game-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/30 animate-in fade-in zoom-in duration-500 shadow-sm relative overflow-hidden">
            <div class="absolute top-0 left-0 w-full h-1" style="background: linear-gradient(to right, transparent, ${result.color}, transparent); opacity: 0.5;"></div>
            <div class="text-4xl mb-2 animate-pop-stick inline-block">🔖</div>
            <h4 class="font-bold text-lg mb-1" style="color: ${result.color}">${result.title}</h4>
            <p class="text-xs text-on-surface-variant text-center leading-relaxed">${result.text}</p>
        </div>
    `;
};
