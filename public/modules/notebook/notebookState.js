export const notebookState = {
    selectModeActive: false,
    selectedPageIds: new Set(),
    customAddedRecipients: [],
    
    toggleSelectMode() {
        this.selectModeActive = !this.selectModeActive;
        if (!this.selectModeActive) this.selectedPageIds.clear();
    },
    togglePageSelect(pageId) {
        if (this.selectedPageIds.has(pageId)) this.selectedPageIds.delete(pageId);
        else this.selectedPageIds.add(pageId);
    }
};
