export const chatState = {
    localStream: null,
    isCallActive: false,
    callRecognition: null,
    currentFriendSortMode: 'name',
    renderedMessageIds: new Set(),
    messages: [], // To track conversation history for context
    
    addMessage(role, content) {
        if (!content || typeof content !== 'string') return;
        this.messages.push({ role, content });
        if (this.messages.length > 50) {
            this.messages.shift(); // Keep only recent 50 in memory
        }
    },
    
    getHistory() {
        // Return recent 20 messages for AI context
        return this.messages.slice(-20);
    },
    
    clearMessages() {
        this.messages = [];
    }
};
