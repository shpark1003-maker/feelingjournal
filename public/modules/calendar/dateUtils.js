export function formatLocalISO(date) {
    if (!date || isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getTodayKSTDateString() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

export function isEventOnDate(ev, dateStr) {
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999`);

    const eventStart = new Date(ev.start);
    const eventEnd = ev.end ? new Date(ev.end) : eventStart;

    return eventStart <= dayEnd && eventEnd >= dayStart;
}

export function getEventLocalDateString(eventDateStr) {
    if (!eventDateStr) return '';
    if (typeof eventDateStr !== 'string') {
        eventDateStr = String(eventDateStr);
    }
    if (eventDateStr.length === 10 && eventDateStr.includes('-')) {
        return eventDateStr;
    }
    if (eventDateStr.length >= 10 && eventDateStr[4] === '-' && eventDateStr[7] === '-') {
        return eventDateStr.slice(0, 10);
    }
    const d = new Date(eventDateStr);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function parseDateSafe(dateStr) {
    if (!dateStr) return new Date();
    if (typeof dateStr !== 'string') {
        dateStr = String(dateStr);
    }
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    }
    return new Date(dateStr);
}
