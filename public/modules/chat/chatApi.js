import { store, API_URL } from '../../state.js';

export const chatApi = {
    async fetchPersona() {
        const token = await store.getSessionToken();
        if (!token) return null;
        const res = await fetch(`${API_URL}/persona`, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.json();
    },
    async fetchMessages(roomId) {
        const token = await store.getSessionToken();
        if (!token) return null;
        const res = await fetch(`${API_URL}/chat/messages?roomId=${encodeURIComponent(roomId)}`, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.json();
    },
    async postAiResponse(payload) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/chat/ai-response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        return res.json();
    },
    async postMessage(payload) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/chat/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        return res.json();
    },
    async createChatRoom(payload) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/chat/room`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        return res.json();
    },
    async fetchContacts() {
        const token = await store.getSessionToken();
        if (!token) return null;
        const res = await fetch(`${API_URL}/contacts`, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.json();
    },
    async sendSmsInvite(payload) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        return res.json();
    },
    async fetchFriendSos() {
        const token = await store.getSessionToken();
        if (!token) return null;
        const res = await fetch(`${API_URL}/friends/sos`, { headers: { 'Authorization': `Bearer ${token}` } });
        return res.json();
    },
    async updateFriendSettings(payload) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/friends/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        return res.json();
    },
    async deleteFriend(payload) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/friends/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        return res.json();
    }
};
