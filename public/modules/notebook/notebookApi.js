import { API_URL, store } from '../../state.js';

export const notebookApi = {
    async fetchNotebooks() {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/notebooks`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.json();
    },
    async fetchPages() {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/history`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.json();
    },
    async createNotebook(title) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/notebooks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ title, created_at: new Date().toISOString() })
        });
        return res.json();
    },
    async deleteNotebook(id) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/notebooks?notebookId=${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.json();
    },
    async updatePage(id, updates) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/history/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(updates)
        });
        return res.json();
    },
    async deletePage(id) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/history/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.json();
    },
    async analyzePage(pageId) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ pageId })
        });
        return res.json();
    },
    async getSosFriends() {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/friends/sos`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.json();
    },
    async searchUsers(query) {
        const token = await store.getSessionToken();
        const res = await fetch(`${API_URL}/users/search?nickname=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.json();
    }
};
