window.FORTUNE_SCENES = {
    '대길 (大吉)': { character: 'angel', intro: 'portalRise', animation: 'bless', duration: 1800, color: '#ff4757', text: '모든 일이 뜻대로 풀리는 대길!' },
    '길 (吉)': { character: 'angel', intro: 'portalRise', animation: 'smile', duration: 1800, color: '#ff6b81', text: '기분 좋은 일이 생길 길!' },
    '평 (平)': { character: 'fairy', intro: 'portalRise', animation: 'float', duration: 1800, color: '#2ed573', text: '무난하고 평화로운 하루' },
    '소길 (小吉)': { character: 'wizard', intro: 'portalRise', animation: 'advise', duration: 1800, color: '#1e90ff', text: '작은 행운이 찾아오는 소길' },
    '흉 (凶)': { character: 'wizard', intro: 'portalRise', animation: 'shock', duration: 1800, color: '#747d8c', text: '조금 조심하면 괜찮아요!' }
};

window.SYSTEM_SCENES = {
    error: {
        character: 'wizard',
        intro: 'portalRise',
        animation: 'concern',
        duration: 2000,
        color: '#8c7ae6',
        text: '별들이 늦게 이야기해주고 있어요...'
    }
};

let fortuneAbortController = null;

// The state machine for briefing loading transition
window.loadingState = {
    phase: 'idle', // idle -> playing -> waiting -> transitioning -> ready (or error/cancelled)
    animationDone: false,
    briefingStatus: 'idle',
    requestId: 0
};

window.playFortuneSequence = async function(sceneData, isFastCache, requestId) {
    const container = document.getElementById('fortune-game-container');
    if (!container) return;

    if (fortuneAbortController) {
        fortuneAbortController.abort();
    }
    fortuneAbortController = new AbortController();
    const signal = fortuneAbortController.signal;

    const characterId = `fortune-${sceneData.character}`;
    const symbol = document.getElementById(characterId);
    
    if (!symbol) return;

    container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-4 min-h-[250px] relative overflow-hidden" aria-live="polite">
            <svg width="200" height="200" class="fortune-scene-svg ${isFastCache ? 'fast-cache' : ''}" aria-hidden="true" viewBox="${symbol.getAttribute('viewBox')}">
                ${symbol.innerHTML}
            </svg>
            <div id="fortune-text-container" class="mt-4 opacity-0 transition-opacity duration-300">
                <h4 class="font-bold text-lg text-center" style="color: ${sceneData.color}">${sceneData.text}</h4>
            </div>
        </div>
    `;

    const svgEl = container.querySelector('.fortune-scene-svg');
    const textContainer = container.querySelector('#fortune-text-container');
    
    // Accessibility: text for screen readers
    textContainer.setAttribute('role', 'status');
    
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (isFastCache || prefersReducedMotion) {
        svgEl.classList.add('animation-done');
        textContainer.classList.remove('opacity-0');
        
        // Custom text updates for specific symbols
        const textTarget = svgEl.querySelector(`#${sceneData.character}-text`);
        if (textTarget) {
            textTarget.textContent = sceneData.text.split(' ')[0]; // short version for flag/bubble
        }
        
        window.loadingState.animationDone = true;
        window.tryCompleteTransition();
        return;
    }

    try {
        window.loadingState.animationDone = false;
        
        // Update short text in SVG
        const textTarget = svgEl.querySelector(`#${sceneData.character}-text`);
        if (textTarget) {
            textTarget.textContent = sceneData.text.split(' ')[0];
        }

        // 1. Portal appears
        svgEl.classList.add('play-intro');
        await waitForAnimationOrTime(svgEl.querySelector('.fortune-portal'), 'animationend', 1000, signal);
        
        // 2. Character appears
        svgEl.classList.add('play-character');
        await waitForAnimationOrTime(svgEl.querySelector('.fortune-character'), 'animationend', 1000, signal);

        // 3. Message appears
        textContainer.classList.remove('opacity-0');
        svgEl.classList.add('play-message');
        
        // Wait for minimum duration
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, Math.max(0, sceneData.duration - 2000));
            signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
        });
        
        window.loadingState.animationDone = true;
        window.tryCompleteTransition();
    } catch (e) {
        if (e.name !== 'AbortError') console.error(e);
        window.loadingState.phase = 'cancelled';
    }
};

window.tryCompleteTransition = function() {
    if (
        window.loadingState.animationDone &&
        window.loadingState.briefingStatus === 'ready' &&
        window.loadingState.phase !== 'transitioning'
    ) {
        window.loadingState.phase = 'transitioning';
        // Trigger the callback in persona.js to show the briefing
        if (typeof window.onFortuneTransitionComplete === 'function') {
            window.onFortuneTransitionComplete(window.loadingState.requestId);
        }
    }
};

function waitForAnimationOrTime(element, eventName, fallbackTime, signal) {
    return new Promise((resolve, reject) => {
        if (!element) {
            resolve();
            return;
        }
        
        let timeout;
        
        const cleanup = () => {
            element.removeEventListener(eventName, handler);
            clearTimeout(timeout);
            signal.removeEventListener('abort', abortHandler);
        };

        const handler = () => {
            cleanup();
            resolve();
        };

        const abortHandler = () => {
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };

        element.addEventListener(eventName, handler, { once: true });
        signal.addEventListener('abort', abortHandler, { once: true });
        
        timeout = setTimeout(() => {
            cleanup();
            resolve();
        }, fallbackTime);
    });
}
