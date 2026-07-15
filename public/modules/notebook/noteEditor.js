import { API_URL, store, assertIds } from '../state.js';
import { notebookState } from './notebookState.js';
import { notebookApi } from './notebookApi.js';

async function refreshNotebookData() {
    const notebookListMod = await import('./notebookList.js');
    return notebookListMod.loadNotebooks();
}

async function refreshNotebookSelect() {
    const notebookListMod = await import('./notebookList.js');
    return notebookListMod.populateV2NotebookSelect();
}

export async function addNewPage() {
    if (store.quillEditor) {
        store.quillEditor.root.innerHTML = '';
        store.quillEditor.update();
    }
    const titleEl = document.getElementById('note-title');
    if (titleEl) titleEl.value = '';

    const editorLock = document.getElementById('v2-editor-e2e-lock');
    if (editorLock) editorLock.classList.add('hidden');

    const resultArea = document.getElementById('analysis-result-area');
    const resultContent = document.getElementById('analysis-content');
    if (resultContent) {
        resultContent.innerText = '새로운 일기를 작성해 보세요.';
    }
    if (resultArea) {
        resultArea.classList.add('hidden');
    }

    store.currentPageId = null;
    store.currentPageCreatedAt = null;
    document.querySelectorAll('.page-item').forEach(i => i.classList.remove('active'));

    // Clear sharing settings UI for the new page
    const shareToggle = document.getElementById('share-toggle-input');
    if (shareToggle) shareToggle.checked = false;
    window.v2SelectedSharees = [];
    if (window.v2RenderSelectedSharees) window.v2RenderSelectedSharees();
    if (window.checkE2eSharePolicy) window.checkE2eSharePolicy();

    const v2Editor = document.getElementById('v2-editor-container');
    if (v2Editor) {
        await refreshNotebookSelect();
        const select = document.getElementById('v2-notebook-select');
        if (select && store.currentNotebookId) select.value = store.currentNotebookId;
        openV2Editor();
    }
}

export function openV2Editor() {
    const editor = document.getElementById('v2-editor-container');
    if (editor) {
        editor.classList.remove('hidden');
        editor.style.transform = 'translateY(0)';
    }
}

export function closeV2Editor() {
    const editor = document.getElementById('v2-editor-container');
    if (editor) {
        editor.style.transform = 'translateY(100%)';
        setTimeout(() => editor.classList.add('hidden'), 300);
    }
}

export function openV2Gallery() {
    const gallery = document.getElementById('v2-gallery-container');
    if (gallery) {
        gallery.classList.remove('hidden');
        gallery.style.transform = 'translateY(0)';
    }
}

export function closeV2Gallery() {
    const gallery = document.getElementById('v2-gallery-container');
    if (gallery) {
        gallery.style.transform = 'translateY(100%)';
        setTimeout(() => gallery.classList.add('hidden'), 300);
    }
}

export function v2QuickAddPage(nbId) {
    store.currentNotebookId = nbId;
    addNewPage();
}
window.v2QuickAddPage = v2QuickAddPage;

export async function deleteV2Page(pageId) {
    if (!confirm('이 일기 페이지를 정말 삭제하시겠습니까?')) return;

    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/history/${pageId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            alert('페이지가 삭제되었습니다.');
            if (store.currentPageId === pageId) {
                store.currentPageId = null;
                const titleEl = document.getElementById('note-title');
                if (titleEl) titleEl.value = '';
                if (store.quillEditor) {
                    store.quillEditor.root.innerHTML = '';
                    store.quillEditor.update();
                }
                const resultArea = document.getElementById('analysis-result-area');
                if (resultArea) resultArea.classList.add('hidden');
            }
            await refreshNotebookData();
        } else {
            alert('삭제 실패: ' + data.error);
        }
    } catch (err) {
        console.error('Failed to delete page:', err);
        alert('삭제 중 서버 통신 오류가 발생했습니다.');
    }
}

export function setupDirectFragmentUpload() {
    const cameraBtn = document.getElementById('v2-camera-btn');
    const uploadBtn = document.getElementById('v2-upload-btn');
    const scrim = document.getElementById('v2-fragment-scrim');
    const container = document.getElementById('v2-fragment-upload-container');
    const closeBtn = document.getElementById('v2-fragment-upload-close');
    const saveBtn = document.getElementById('v2-fragment-upload-save');
    const fileInput = document.getElementById('v2-fragment-file-input');
    const placeholder = document.getElementById('v2-fragment-dropzone-placeholder');
    const preview = document.getElementById('v2-fragment-preview');
    const descTextarea = document.getElementById('v2-fragment-desc');
    const notebookSelect = document.getElementById('v2-fragment-notebook-select');

    if ((!cameraBtn && !uploadBtn) || !container) return;

    let base64Image = null;

    // Open Modal logic helper
    const openUploadModal = async (isCamera) => {
        // Reset form
        base64Image = null;
        if (fileInput) {
            fileInput.value = '';
            if (isCamera) {
                fileInput.setAttribute('capture', 'environment');
            } else {
                fileInput.removeAttribute('capture');
            }
        }
        if (preview) {
            preview.src = '';
            preview.classList.add('hidden');
        }
        if (placeholder) placeholder.classList.remove('hidden');
        if (descTextarea) descTextarea.value = '';

        // Populate notebook options
        if (notebookSelect) {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/notebooks`, {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-store'
            });
            const data = await res.json();
            const notebooks = (data.success && data.notebooks?.length > 0) ? data.notebooks : [{ id: 'nb-1', name: '내 일기장' }];
            notebookSelect.innerHTML = notebooks.map(nb => `<option value="${nb.id}" ${nb.id === store.currentNotebookId ? 'selected' : ''}>${nb.name}</option>`).join('');
        }

        // Show Container
        container.classList.remove('hidden');
        scrim?.classList.remove('hidden');
        setTimeout(() => {
            scrim?.classList.remove('opacity-0');
            scrim?.classList.add('opacity-100');
            container.style.transform = 'translateY(0)';
            
            // Auto click input to open camera or file system selector immediately
            fileInput?.click();
        }, 10);
    };

    cameraBtn?.addEventListener('click', () => openUploadModal(true));
    uploadBtn?.addEventListener('click', () => openUploadModal(false));

    // Close Modal
    const closeModal = () => {
        container.style.transform = 'translateY(100%)';
        scrim?.classList.remove('opacity-100');
        scrim?.classList.add('opacity-0');
        setTimeout(() => {
            container.classList.add('hidden');
            scrim?.classList.add('hidden');
        }, 400);
    };

    closeBtn?.addEventListener('click', closeModal);
    scrim?.addEventListener('click', closeModal);

    // File selection
    fileInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('사진 크기는 최대 5MB를 초과할 수 없습니다.');
            fileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            base64Image = event.target.result;
            if (preview) {
                preview.src = base64Image;
                preview.classList.remove('hidden');
            }
            if (placeholder) placeholder.classList.add('hidden');
        };
        reader.readAsDataURL(file);
    });

    // Save Fragment
    saveBtn?.addEventListener('click', async () => {
        if (!base64Image) {
            alert('사진을 선택해 주세요.');
            return;
        }

        const description = descTextarea ? descTextarea.value.trim() : '';
        const notebookId = notebookSelect ? notebookSelect.value : 'nb-1';
        
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner"></span> 저장 중...';

        try {
            const token = await store.getSessionToken();
            const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
            
            // Format richContent to include image and short description
            const title = `기억 조각 - ${todayStr}`;
            const richContent = `<p><img src="${base64Image}"></p><p>${description || '설명이 없습니다.'}</p>`;
            
            const res = await fetch(`${API_URL}/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    content: description,
                    richContent,
                    title,
                    notebookId,
                    image: base64Image
                })
            });

            const data = await res.json();
            if (data.success) {
                alert('기억 조각이 성공적으로 등록되었습니다.');
                closeModal();
                // Reload Notebooks list and gallery fragments
                await refreshNotebookData();
            } else {
                alert('저장 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch (err) {
            console.error('Failed to save fragment:', err);
            alert('저장 중 오류가 발생했습니다.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '저장';
        }
    });
}

export function setupGallerySharing() {
    const selectBtn = document.getElementById('v2-gallery-select-btn');
    const selectBar = document.getElementById('v2-gallery-select-bar');
    const selectCountText = document.getElementById('v2-gallery-select-count');
    const cancelBtn = document.getElementById('v2-gallery-select-cancel-btn');
    const shareBtn = document.getElementById('v2-gallery-share-btn');
    let deleteBtn = document.getElementById('v2-gallery-delete-btn');

    if (shareBtn && !deleteBtn) {
        console.log("--- [DEBUG SELECTION] Delete button not found in HTML. Dynamically injecting fallback button.");
        deleteBtn = document.createElement('button');
        deleteBtn.id = 'v2-gallery-delete-btn';
        deleteBtn.className = 'px-5 py-2 bg-error text-white hover:bg-red-700 active:scale-95 rounded-full font-bold text-xs transition-all flex items-center gap-1.5 shadow-md opacity-50 pointer-events-none';
        deleteBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete</span> 삭제하기';
        shareBtn.parentNode.insertBefore(deleteBtn, shareBtn);
    }
    
    const shareConfirmModal = document.getElementById('v2-share-confirm-modal');
    const shareConfirmScrim = document.getElementById('v2-share-confirm-scrim');
    const shareConfirmClose = document.getElementById('v2-share-confirm-close');
    const finalizeShareBtn = document.getElementById('v2-finalize-share-btn');
    
    const searchBtn = document.getElementById('v2-share-search-btn');
    const searchInput = document.getElementById('v2-share-search-input');
    const searchResultsContainer = document.getElementById('v2-share-search-results-container');
    const searchResults = document.getElementById('v2-share-search-results');
    
    if (!selectBtn || !selectBar) return;

    // Toggle Select Mode
    const toggleSelectMode = (active) => {
        notebookState.selectModeActive = active;
        notebookState.selectedPageIds.clear();
        
        const allPages = store.history || [];
        
        if (active) {
            selectBtn.textContent = '취소';
            selectBtn.classList.add('bg-primary/10');
            selectBar.classList.remove('hidden');
            setTimeout(() => {
                selectBar.classList.remove('translate-y-full');
            }, 10);
        } else {
            selectBtn.textContent = '선택';
            selectBtn.classList.remove('bg-primary/10');
            selectBar.classList.add('translate-y-full');
            setTimeout(() => {
                selectBar.classList.add('hidden');
            }, 300);
        }
        
        updateSelectCount();
        renderV2MemoryFragments(allPages);
    };

    const updateSelectCount = () => {
        if (selectCountText) {
            selectCountText.textContent = `${notebookState.selectedPageIds.size}개 선택됨`;
        }
        if (shareBtn) {
            shareBtn.disabled = notebookState.selectedPageIds.size === 0;
            if (notebookState.selectedPageIds.size === 0) {
                shareBtn.classList.add('opacity-50', 'pointer-events-none');
            } else {
                shareBtn.classList.remove('opacity-50', 'pointer-events-none');
            }
        }
        if (deleteBtn) {
            deleteBtn.disabled = notebookState.selectedPageIds.size === 0;
            if (notebookState.selectedPageIds.size === 0) {
                deleteBtn.classList.add('opacity-50', 'pointer-events-none');
            } else {
                deleteBtn.classList.remove('opacity-50', 'pointer-events-none');
            }
        }
    };

    selectBtn.addEventListener('click', () => {
        toggleSelectMode(!notebookState.selectModeActive);
    });

    cancelBtn?.addEventListener('click', () => {
        toggleSelectMode(false);
    });

    // Bulk Delete Click Handler
    deleteBtn?.addEventListener('click', async () => {
        if (notebookState.selectedPageIds.size === 0) return;

        if (!confirm(`선택한 ${notebookState.selectedPageIds.size}개의 기억 조각(일기 페이지)을 정말 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`)) {
            return;
        }

        const token = await store.getSessionToken();
        if (!token) return;

        deleteBtn.disabled = true;
        deleteBtn.textContent = '삭제 중...';

        const promises = Array.from(notebookState.selectedPageIds).map(pageId => {
            return fetch(`${API_URL}/history/${encodeURIComponent(pageId)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(async res => {
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Server error');
                }
                return { pageId, success: true };
            }).catch(err => {
                return { pageId, success: false, error: err.message };
            });
        });

        try {
            const results = await Promise.allSettled(promises);
            let successes = 0;
            let failures = 0;

            results.forEach(res => {
                if (res.status === 'fulfilled' && res.value.success) {
                    successes++;
                } else {
                    failures++;
                }
            });

            alert(`${successes}개의 기억 조각이 삭제되었습니다.`);
            
            // Reset state
            toggleSelectMode(false);
            await refreshNotebookData();
        } catch (err) {
            console.error(err);
            alert('삭제 과정 중 오류가 발생했습니다.');
        } finally {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">delete</span> 삭제하기';
        }
    });

    // Close confirm modal
    const closeShareModal = () => {
        shareConfirmModal.classList.add('translate-y-full');
        shareConfirmScrim?.classList.remove('opacity-100');
        shareConfirmScrim?.classList.add('opacity-0');
        setTimeout(() => {
            shareConfirmModal.classList.add('hidden');
            shareConfirmScrim?.classList.add('hidden');
        }, 300);
    };

    shareConfirmScrim?.addEventListener('click', closeShareModal);
    shareConfirmClose?.addEventListener('click', closeShareModal);

    // Open Share Modal
    shareBtn?.addEventListener('click', async () => {
        if (notebookState.selectedPageIds.size === 0) return;

        notebookState.customAddedRecipients = [];
        const customContainer = document.getElementById('v2-share-custom-recipients-container');
        if (customContainer) customContainer.classList.add('hidden');
        
        // 1. Render Previews
        const previewsContainer = document.getElementById('v2-share-selected-previews');
        if (previewsContainer) {
            const selectedImages = [];
            document.querySelectorAll('.full-memory-item').forEach(el => {
                const id = el.dataset.id;
                if (notebookState.selectedPageIds.has(id)) {
                    const img = el.querySelector('img')?.src;
                    if (img) selectedImages.push(img);
                }
            });

            previewsContainer.innerHTML = selectedImages.map(img => `
                <div class="w-16 h-16 rounded-lg overflow-hidden border border-outline-variant/30 flex-shrink-0 relative shadow-sm">
                    <img class="w-full h-full object-cover" src="${img}">
                </div>
            `).join('');
        }

        // 2. Fetch 1촌 Friends
        const friendsList = document.getElementById('v2-share-friends-list');
        const badge = document.getElementById('v2-friends-count-badge');
        if (friendsList) {
            friendsList.innerHTML = '<p class="text-xs text-on-surface-variant/50 text-center py-4"><span class="spinner"></span> 친구 목록 로드 중...</p>';
            try {
                const token = await store.getSessionToken();
                const res = await fetch(`${API_URL}/friends/sos`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                
                if (data.success && data.friends?.length > 0) {
                    const friends = data.friends;
                    if (badge) badge.textContent = `${friends.length}명`;
                    friendsList.innerHTML = friends.map(f => `
                        <label class="flex items-center justify-between p-2 hover:bg-surface-container rounded-lg cursor-pointer transition-colors">
                            <div class="flex items-center gap-2.5">
                                <img src="${f.avatar_url || 'https://via.placeholder.com/32'}" class="w-8 h-8 rounded-full object-cover border border-outline-variant/30">
                                <div class="flex flex-col">
                                    <span class="text-xs font-bold text-on-surface">${f.nickname}</span>
                                    <span class="text-[9px] text-on-surface-variant/60">1촌 친구</span>
                                </div>
                            </div>
                            <input type="checkbox" class="friend-share-checkbox w-4 h-4 rounded text-primary focus:ring-primary border-outline-variant" data-id="${f.id}" data-nickname="${f.nickname}" checked>
                        </label>
                    `).join('');
                } else {
                    if (badge) badge.textContent = '0명';
                    friendsList.innerHTML = '<p class="text-xs text-on-surface-variant/50 text-center py-4">등록된 1촌 친구가 없습니다.</p>';
                }
            } catch (err) {
                console.error(err);
                friendsList.innerHTML = '<p class="text-xs text-error/70 text-center py-4">친구 목록 로드 실패</p>';
            }
        }

        // Show Modal
        shareConfirmModal.classList.remove('hidden');
        shareConfirmScrim?.classList.remove('hidden');
        setTimeout(() => {
            shareConfirmScrim?.classList.remove('opacity-0');
            shareConfirmScrim?.classList.add('opacity-100');
            shareConfirmModal.classList.remove('translate-y-full');
        }, 10);
    });

    // Handle user search by nickname
    searchBtn?.addEventListener('click', async () => {
        const query = searchInput?.value?.trim();
        if (!query) return;

        searchBtn.disabled = true;
        searchResultsContainer.classList.remove('hidden');
        searchResults.innerHTML = '<div class="text-xs text-on-surface-variant/50 text-center py-4"><span class="spinner"></span> 사용자 검색 중...</div>';

        try {
            const token = await store.getSessionToken();
            const res = await fetch(`${API_URL}/users/search?nickname=${encodeURIComponent(query)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();

            if (data.success && data.users?.length > 0) {
                searchResults.innerHTML = data.users.map(u => `
                    <div class="flex items-center justify-between p-2 bg-surface rounded-lg border border-outline-variant/10 shadow-sm">
                        <div class="flex items-center gap-2">
                            <img src="${u.avatar_url || 'https://via.placeholder.com/32'}" class="w-8 h-8 rounded-full object-cover">
                            <div class="flex flex-col">
                                <span class="text-xs font-bold text-on-surface">${u.nickname}</span>
                                <span class="text-[9px] text-on-surface-variant/50">${u.email}</span>
                            </div>
                        </div>
                        <button class="px-3 py-1 bg-primary text-white text-[10px] font-bold rounded-full hover:bg-primary-hover active:scale-95 transition-all add-custom-recipient-btn" data-id="${u.id}" data-nickname="${u.nickname}">
                            추가
                        </button>
                    </div>
                `).join('');

                searchResults.querySelectorAll('.add-custom-recipient-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.dataset.id;
                        const nickname = btn.dataset.nickname;
                        
                        if (!notebookState.customAddedRecipients.some(r => r.id === id)) {
                            notebookState.customAddedRecipients.push({ id, nickname });
                            renderCustomRecipients();
                        }
                        searchResultsContainer.classList.add('hidden');
                        if (searchInput) searchInput.value = '';
                    });
                });
            } else {
                searchResults.innerHTML = '<div class="text-xs text-on-surface-variant/50 text-center py-4">검색 결과가 없습니다.</div>';
            }
        } catch (err) {
            console.error(err);
            searchResults.innerHTML = '<div class="text-xs text-error/70 text-center py-4">검색 오류 발생</div>';
        } finally {
            searchBtn.disabled = false;
        }
    });

    const renderCustomRecipients = () => {
        const customContainer = document.getElementById('v2-share-custom-recipients-container');
        const customList = document.getElementById('v2-share-custom-recipients-list');
        if (!customContainer || !customList) return;

        if (notebookState.customAddedRecipients.length > 0) {
            customContainer.classList.remove('hidden');
            customList.innerHTML = notebookState.customAddedRecipients.map(r => `
                <div class="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-xs font-semibold border border-primary/20">
                    <span>${r.nickname}</span>
                    <button class="w-4 h-4 flex items-center justify-center hover:bg-primary/20 rounded-full remove-custom-recipient-btn" data-id="${r.id}">
                        <span class="material-symbols-outlined text-[10px]">close</span>
                    </button>
                </div>
            `).join('');

            customList.querySelectorAll('.remove-custom-recipient-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    notebookState.customAddedRecipients = notebookState.customAddedRecipients.filter(r => r.id !== id);
                    renderCustomRecipients();
                });
            });
        } else {
            customContainer.classList.add('hidden');
        }
    };

    // Finalize Share Click
    finalizeShareBtn?.addEventListener('click', async () => {
        const checkedFriends = [];
        document.querySelectorAll('.friend-share-checkbox:checked').forEach(cb => {
            checkedFriends.push({
                id: cb.dataset.id,
                nickname: cb.dataset.nickname
            });
        });

        const allRecipients = [...checkedFriends, ...notebookState.customAddedRecipients];
        const token = await store.getSessionToken();
        if (!token) return;

        finalizeShareBtn.disabled = true;
        finalizeShareBtn.textContent = '공유 중...';

        const promises = Array.from(notebookState.selectedPageIds).map(pageId => {
            return fetch(`${API_URL}/history/${encodeURIComponent(pageId)}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    shared: allRecipients.length > 0,
                    sharedWith: allRecipients
                })
            }).then(async res => {
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Server error');
                }
                return { pageId, success: true };
            }).catch(err => {
                return { pageId, success: false, error: err.message };
            });
        });

        try {
            const results = await Promise.allSettled(promises);
            let successes = 0;
            let failures = 0;

            results.forEach(res => {
                if (res.status === 'fulfilled' && res.value.success) {
                    successes++;
                } else {
                    failures++;
                }
            });

            if (failures === 0) {
                alert(`${successes}개의 기억 조각이 성공적으로 공유되었습니다.`);
            } else {
                alert(`공유 결과: ${successes}개 성공, ${failures}개 실패`);
            }

            closeShareModal();
            toggleSelectMode(false);
            await refreshNotebookData();
        } catch (err) {
            console.error(err);
            alert('공유 일괄 요청 중 심각한 오류가 발생했습니다.');
        } finally {
            finalizeShareBtn.disabled = false;
            finalizeShareBtn.textContent = '공유 완료';
        }
    });
}

