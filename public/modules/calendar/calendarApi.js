import { store, API_URL } from '../state.js';

export async function fetchCalendarEvents(year, month) {
    const token = await store.getSessionToken();
    if (!token) return [];

    const mStr = String(month + 1).padStart(2, '0');
    try {
        const res = await fetch(`${API_URL}/calendar/events?year=${year}&month=${mStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        return data.success ? data.events : [];
    } catch (err) {
        console.error('Failed to fetch events:', err);
        return [];
    }
}

export async function fetchCalendarTasks(year, month) {
    const token = await store.getSessionToken();
    if (!token) return [];

    const mStr = String(month + 1).padStart(2, '0');
    try {
        const res = await fetch(`${API_URL}/calendar/tasks?year=${year}&month=${mStr}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        return data.success ? data.tasks : [];
    } catch (err) {
        console.error('Failed to fetch tasks:', err);
        return [];
    }
}

export async function saveTaskEvent(eventData) {
    const token = await store.getSessionToken();
    const isEdit = !!eventData.id;
    const url = isEdit ? `${API_URL}/calendar/events/${eventData.id}` : `${API_URL}/calendar/events`;
    const method = isEdit ? 'PATCH' : 'POST';

    const response = await fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(eventData)
    });
    return response.json();
}

export async function deleteCalendarTask(taskId) {
    const token = await store.getSessionToken();
    const response = await fetch(`${API_URL}/calendar/tasks/${taskId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
}

export async function deleteCalendarEvent(eventId) {
    const token = await store.getSessionToken();
    const response = await fetch(`${API_URL}/calendar/events/${eventId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.json();
}

export async function fetchAiSuggestion(history) {
    const token = await store.getSessionToken();
    const res = await fetch(`${API_URL}/ai-tasks/suggest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ history })
    });
    return res.json();
}

export async function confirmAiTasks(payload) {
    const token = await store.getSessionToken();
    const res = await fetch(`${API_URL}/ai-tasks/confirm`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });
    return res.json();
}
