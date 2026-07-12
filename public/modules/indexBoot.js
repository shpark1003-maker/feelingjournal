function onReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
        callback();
    }
}

function setupLoginButtonPressEffect() {
    const loginBtn = document.getElementById('google-login-btn');
    if (!loginBtn) return;

    loginBtn.addEventListener('mousedown', () => loginBtn.classList.add('scale-95'));
    loginBtn.addEventListener('mouseup', () => loginBtn.classList.remove('scale-95'));
    loginBtn.addEventListener('mouseleave', () => loginBtn.classList.remove('scale-95'));
}

function setupScrollParallax() {
    window.addEventListener('scroll', () => {
        const scroll = window.pageYOffset;
        document.body.style.backgroundPositionY = `${scroll * 0.1}px`;
    }, { passive: true });
}

function setupButtonAnchorGuard() {
    document.querySelectorAll('button, a').forEach(el => {
        el.addEventListener('click', (e) => {
            if (el.tagName === 'A' && el.getAttribute('href') === '#') {
                e.preventDefault();
            }
        });
    });
}

function setupWeatherAndBriefingSync() {
    const toggleWeather = document.getElementById('toggle-weather');
    const weatherOn = document.getElementById('weather-on');
    const weatherOff = document.getElementById('weather-off');

    if (toggleWeather && weatherOn && weatherOff) {
        toggleWeather.checked = !weatherOff.checked;

        toggleWeather.addEventListener('change', () => {
            if (toggleWeather.checked) {
                weatherOn.checked = true;
                weatherOff.checked = false;
            } else {
                weatherOn.checked = false;
                weatherOff.checked = true;
            }
        });
    }

    const briefingHourUp = document.getElementById('briefing-hour-up');
    const briefingHourDown = document.getElementById('briefing-hour-down');
    const briefingHourText = document.getElementById('briefing-hour-text');
    const briefingMinuteUp = document.getElementById('briefing-minute-up');
    const briefingMinuteDown = document.getElementById('briefing-minute-down');
    const briefingMinuteText = document.getElementById('briefing-minute-text');
    const briefingAmBtn = document.getElementById('briefing-am-btn');
    const briefingPmBtn = document.getElementById('briefing-pm-btn');
    const briefingTimeInput = document.getElementById('briefing-time-input');

    function updateBriefingTimeInputFromUI() {
        if (!briefingHourText || !briefingMinuteText || !briefingTimeInput) return;
        let hour = parseInt(briefingHourText.textContent, 10);
        const minute = briefingMinuteText.textContent;
        const isPM = briefingPmBtn && briefingPmBtn.classList.contains('bg-primary');

        if (isPM && hour < 12) {
            hour += 12;
        } else if (!isPM && hour === 12) {
            hour = 0;
        }

        const formattedHour = String(hour).padStart(2, '0');
        briefingTimeInput.value = `${formattedHour}:${minute}`;
    }

    function updateBriefingUIFromInput() {
        if (!briefingTimeInput || !briefingTimeInput.value) return;
        const [fullHour, minute] = briefingTimeInput.value.split(':');
        let hour = parseInt(fullHour, 10);
        let isPM = false;

        if (hour >= 12) {
            isPM = true;
            if (hour > 12) hour -= 12;
        } else if (hour === 0) {
            hour = 12;
        }

        if (briefingHourText) briefingHourText.textContent = String(hour).padStart(2, '0');
        if (briefingMinuteText) briefingMinuteText.textContent = minute;

        if (isPM) {
            if (briefingPmBtn) briefingPmBtn.className = 'px-3 py-1 rounded-lg bg-primary text-white text-xs font-bold shadow-sm';
            if (briefingAmBtn) briefingAmBtn.className = 'px-3 py-1 rounded-lg bg-surface-variant/40 text-on-surface-variant text-xs font-bold';
        } else {
            if (briefingAmBtn) briefingAmBtn.className = 'px-3 py-1 rounded-lg bg-primary text-white text-xs font-bold shadow-sm';
            if (briefingPmBtn) briefingPmBtn.className = 'px-3 py-1 rounded-lg bg-surface-variant/40 text-on-surface-variant text-xs font-bold';
        }
    }

    if (briefingHourUp && briefingHourDown && briefingHourText) {
        briefingHourUp.addEventListener('click', () => {
            let h = parseInt(briefingHourText.textContent, 10);
            h = h % 12 + 1;
            briefingHourText.textContent = String(h).padStart(2, '0');
            updateBriefingTimeInputFromUI();
        });
        briefingHourDown.addEventListener('click', () => {
            let h = parseInt(briefingHourText.textContent, 10);
            h = h - 1;
            if (h < 1) h = 12;
            briefingHourText.textContent = String(h).padStart(2, '0');
            updateBriefingTimeInputFromUI();
        });
        briefingMinuteUp.addEventListener('click', () => {
            let m = parseInt(briefingMinuteText.textContent, 10);
            m = (m + 10) % 60;
            briefingMinuteText.textContent = String(m).padStart(2, '0');
            updateBriefingTimeInputFromUI();
        });
        briefingMinuteDown.addEventListener('click', () => {
            let m = parseInt(briefingMinuteText.textContent, 10);
            m = (m - 10 + 60) % 60;
            briefingMinuteText.textContent = String(m).padStart(2, '0');
            updateBriefingTimeInputFromUI();
        });
        if (briefingAmBtn) {
            briefingAmBtn.addEventListener('click', () => {
                briefingAmBtn.className = 'px-3 py-1 rounded-lg bg-primary text-white text-xs font-bold shadow-sm';
                if (briefingPmBtn) briefingPmBtn.className = 'px-3 py-1 rounded-lg bg-surface-variant/40 text-on-surface-variant text-xs font-bold';
                updateBriefingTimeInputFromUI();
            });
        }
        if (briefingPmBtn) {
            briefingPmBtn.addEventListener('click', () => {
                briefingPmBtn.className = 'px-3 py-1 rounded-lg bg-primary text-white text-xs font-bold shadow-sm';
                if (briefingAmBtn) briefingAmBtn.className = 'px-3 py-1 rounded-lg bg-surface-variant/40 text-on-surface-variant text-xs font-bold';
                updateBriefingTimeInputFromUI();
            });
        }
        briefingTimeInput?.addEventListener('change', updateBriefingUIFromInput);
        briefingTimeInput?.addEventListener('input', updateBriefingUIFromInput);
        updateBriefingUIFromInput();
    }

    const alarmHourText = document.getElementById('v2-alarm-hour-text');
    const alarmMinuteText = document.getElementById('v2-alarm-minute-text');
    const alarmHourUp = document.getElementById('v2-alarm-hour-up');
    const alarmHourDown = document.getElementById('v2-alarm-hour-down');
    const alarmMinuteUp = document.getElementById('v2-alarm-minute-up');
    const alarmMinuteDown = document.getElementById('v2-alarm-minute-down');
    const alarm10 = document.getElementById('alarm-10');
    const alarm30 = document.getElementById('alarm-30');
    const alarm60 = document.getElementById('alarm-60');

    function updateAlarmInputsFromUI() {
        if (!alarmHourText || !alarmMinuteText) return;
        const hour = parseInt(alarmHourText.textContent, 10);
        const minute = parseInt(alarmMinuteText.textContent, 10);
        const totalMinutes = hour * 60 + minute;

        if (alarm10) alarm10.checked = (totalMinutes === 10);
        if (alarm30) alarm30.checked = (totalMinutes === 30);
        if (alarm60) alarm60.checked = (totalMinutes === 60);
    }

    function updateAlarmUIFromInputs() {
        if (!alarmHourText || !alarmMinuteText) return;
        if (alarm60 && alarm60.checked) {
            alarmHourText.textContent = '01';
            alarmMinuteText.textContent = '00';
        } else if (alarm30 && alarm30.checked) {
            alarmHourText.textContent = '00';
            alarmMinuteText.textContent = '30';
        } else if (alarm10 && alarm10.checked) {
            alarmHourText.textContent = '00';
            alarmMinuteText.textContent = '10';
        }
    }

    if (alarmHourUp && alarmHourDown && alarmHourText) {
        alarmHourUp.addEventListener('click', () => {
            let h = parseInt(alarmHourText.textContent, 10);
            h = (h + 1) % 24;
            alarmHourText.textContent = String(h).padStart(2, '0');
            updateAlarmInputsFromUI();
        });
        alarmHourDown.addEventListener('click', () => {
            let h = parseInt(alarmHourText.textContent, 10);
            h = (h - 1 + 24) % 24;
            alarmHourText.textContent = String(h).padStart(2, '0');
            updateAlarmInputsFromUI();
        });
        alarmMinuteUp.addEventListener('click', () => {
            let m = parseInt(alarmMinuteText.textContent, 10);
            m = (m + 10) % 60;
            alarmMinuteText.textContent = String(m).padStart(2, '0');
            updateAlarmInputsFromUI();
        });
        alarmMinuteDown.addEventListener('click', () => {
            let m = parseInt(alarmMinuteText.textContent, 10);
            m = (m - 10 + 60) % 60;
            alarmMinuteText.textContent = String(m).padStart(2, '0');
            updateAlarmInputsFromUI();
        });
        [alarm10, alarm30, alarm60].forEach(input => {
            input?.addEventListener('change', updateAlarmUIFromInputs);
        });
        updateAlarmUIFromInputs();
    }
}

function setupGalleryTabs() {
    document.querySelectorAll('.active-tab, #tab-shared, #tab-mine').forEach(tab => {
        tab.addEventListener('click', () => {
            const filterTabs = tab.parentElement.querySelectorAll('button');
            filterTabs.forEach(button => {
                button.classList.remove('active-tab');
                button.classList.add('text-on-surface-variant');
            });
            tab.classList.remove('text-on-surface-variant');
            tab.classList.add('active-tab');
        });
    });
}

function setupOverlayControls() {
    const taskEditorCloseBtn = document.getElementById('v2-task-editor-close');
    if (taskEditorCloseBtn) {
        taskEditorCloseBtn.addEventListener('click', () => {
            const sheet = document.getElementById('v2-task-editor-container');
            const scrim = document.getElementById('v2-editor-scrim');
            if (sheet && scrim) {
                sheet.style.transform = 'translateY(100%)';
                scrim.classList.add('opacity-0');
                setTimeout(() => {
                    scrim.classList.add('hidden');
                    sheet.classList.add('hidden');
                }, 400);
            }
        });
    }

    const taskDetailCloseBtn = document.getElementById('v2-task-detail-back-btn');
    if (taskDetailCloseBtn) {
        taskDetailCloseBtn.addEventListener('click', () => {
            const detail = document.getElementById('v2-task-detail-container');
            if (detail) {
                detail.style.transform = 'translateY(100%)';
                setTimeout(() => detail.classList.add('hidden'), 300);
            }
        });
    }

    const btnFemale = document.getElementById('gender-btn-female');
    const btnMale = document.getElementById('gender-btn-male');
    const radioFemale = document.getElementById('gender-female');
    const radioMale = document.getElementById('gender-male');

    if (btnFemale && btnMale && radioFemale && radioMale) {
        btnFemale.addEventListener('click', () => {
            radioFemale.checked = true;
            btnFemale.className = 'flex-1 py-2.5 rounded-xl bg-white shadow-sm text-primary font-label-md';
            btnMale.className = 'flex-1 py-2.5 rounded-xl text-on-surface-variant font-label-md';
        });
        btnMale.addEventListener('click', () => {
            radioMale.checked = true;
            btnMale.className = 'flex-1 py-2.5 rounded-xl bg-white shadow-sm text-primary font-label-md';
            btnFemale.className = 'flex-1 py-2.5 rounded-xl text-on-surface-variant font-label-md';
        });
    }
}

onReady(() => {
    setupButtonAnchorGuard();
    setupLoginButtonPressEffect();
    setupScrollParallax();
    setupWeatherAndBriefingSync();
    setupGalleryTabs();
    setupOverlayControls();
});