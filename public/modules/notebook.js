import { store, API_URL, assertIds } from './state.js?v=5.4.2';

let selectModeActive = false;
let selectedPageIds = new Set();
let customAddedRecipients = [];

export async function loadNotebooks() {
    assertIds('Notebook', ['v2-notebook-accordion-list']);

    const token = await store.getSessionToken();
    if (!token) return;
    
    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
    });
    const data = await res.json();

    const v2Accordion = document.getElementById('v2-notebook-accordion-list');
    const notebooks = (data.success && data.notebooks?.length > 0)
        ? data.notebooks
        : [{ id: 'nb-1', name: '내 일기장', color: '#6366f1' }];

    if (!store.currentNotebookId || store.currentNotebookId === 'nb-1') {
        store.currentNotebookId = notebooks[0].id;
    }

    if (v2Accordion) {
        const resHistory = await fetch(`${API_URL}/history`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const dataHistory = await resHistory.json();
        const allPages = dataHistory.history || [];
        store.history = allPages;

        v2Accordion.innerHTML = notebooks.map(nb => {
            const nbPages = allPages.filter(p => p.notebookId === nb.id || ((!p.notebookId || p.notebookId === 'nb-1') && nb.id === 'nb-1'));
            
            const pagesHtml = nbPages.length > 0 ? nbPages.map(p => {
                const dateStr = new Date(p.createdAt).toLocaleDateString('ko-KR', {year: '2-digit', month: '2-digit', day: '2-digit'});
                return `
                <a class="p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/10 flex justify-between items-center shadow-sm hover:bg-primary-container/10 transition-colors group/item page-item" href="#" data-id="${p.id}">
                    <div class="flex items-center gap-2 overflow-hidden">
                        <span class="material-symbols-outlined text-primary text-[18px]">description</span>
                        <span class="font-body-md text-on-surface truncate">${p.title || '제목 없음'}</span>
                    </div>
                    <div class="flex items-center gap-2 pr-1 pointer-events-auto">
                        <span class="text-[12px] text-outline whitespace-nowrap">${dateStr}</span>
                        <button class="w-6 h-6 flex items-center justify-center rounded-full text-error/60 hover:text-error hover:bg-error/10 active:scale-95 transition-all delete-page-btn" data-action="delete-page" data-id="${p.id}" title="페이지 삭제">
                            <span class="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                    </div>
                </a>`;
            }).join('') : '<p class="font-label-sm text-outline italic py-2 px-4">아직 작성된 노트가 없습니다.</p>';
 
            return `
            <div class="relative group/nb-wrapper mb-3">
                <details class="group bg-surface-container/60 rounded-xl border border-outline-variant/30 overflow-hidden soft-shadow" ${store.currentNotebookId === nb.id ? 'open' : ''}>
                    <summary class="flex justify-between items-center p-4 cursor-pointer list-none hover:bg-surface-container-high/80 transition-colors notebook-item" data-id="${nb.id}" data-name="${nb.name}">
                        <div class="flex items-center gap-3">
                            <span class="material-symbols-outlined text-${nb.id === 'nb-1' ? 'primary' : 'secondary'}" data-icon="${nb.id === 'nb-1' ? 'menu_book' : 'folder'}">${nb.id === 'nb-1' ? 'menu_book' : 'folder'}</span>
                            <span class="font-label-sm text-on-surface">${nb.name}</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button class="w-8 h-8 flex items-center justify-center rounded-full bg-primary/10 hover:bg-primary hover:text-on-primary hover:scale-110 active:scale-95 hover:rotate-90 transition-all duration-300 text-primary v2-quick-add-page-btn" data-action="quick-add-page" data-nb="${nb.id}" title="이 노트에 페이지 추가">
                                <span class="material-symbols-outlined text-[20px]">add</span>
                            </button>
                            ${nb.id !== 'nb-1' ? `
                            <button class="w-8 h-8 flex items-center justify-center rounded-full bg-error/10 hover:bg-error hover:text-on-primary hover:scale-110 active:scale-95 transition-all text-error v2-quick-delete-nb-btn" data-action="delete-nb" data-id="${nb.id}" data-name="${nb.name}" title="이 노트 삭제">
                                <span class="material-symbols-outlined text-[18px]">delete</span>
                            </button>
                            ` : ''}
                            <span class="material-symbols-outlined group-open:rotate-180 transition-transform duration-300 pointer-events-none" data-icon="expand_more">expand_more</span>
                        </div>
                    </summary>
                    <div class="px-4 pb-4 pt-0 flex flex-col" style="max-height: 360px;">
                        <div class="flex-1 overflow-y-auto space-y-2 pr-1 hide-scrollbar" style="max-height: 280px;">
                            ${pagesHtml}
                        </div>
                        <div class="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-surface-container/95 via-surface-container/80 to-transparent pt-3 pb-1 flex gap-2 backdrop-blur-md z-10">
                            <button class="flex-1 py-2 bg-primary text-on-primary rounded-lg font-label-sm hover:opacity-90 active:scale-95 transition-all v2-add-page-btn" data-action="add-page" data-nb="${nb.id}">📝 페이지 추가</button>
                        </div>
                    </div>
                </details>
            </div>`;
        }).join('') + `
        <button id="v2-new-notebook-btn" class="w-full py-3 border-2 border-dashed border-outline-variant/30 rounded-xl text-outline font-label-sm hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center gap-2 bg-surface/40">
            <span class="material-symbols-outlined text-[18px]">add_circle</span>
            새 노트
        </button>`;

        // 이벤트 위임(Event Delegation) 설정 - 아코디언 컨테이너에 단 한번 이벤트 핸들러 바인딩
        if (v2Accordion && !v2Accordion.dataset.delegated) {
            v2Accordion.dataset.delegated = "true";
            v2Accordion.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action], .page-item, .notebook-item');
                if (!target) return;

                // 1. 개별 페이지 클릭 핸들링
                if (target.classList.contains('page-item')) {
                    e.preventDefault();
                    selectPage(target.dataset.id, store.history || []);
                    return;
                }

                // 2. 노트북 서머리 클릭 핸들링
                if (target.classList.contains('notebook-item')) {
                    store.currentNotebookId = target.dataset.id;
                    return;
                }

                // 3. data-action 액션 클릭 핸들링
                const action = target.dataset.action;
                if (action === 'quick-add-page') {
                    e.preventDefault();
                    e.stopPropagation();
                    const nbId = target.dataset.nb;
                    v2QuickAddPage(nbId);
                } else if (action === 'add-page') {
                    e.preventDefault();
                    const nbId = target.dataset.nb;
                    store.currentNotebookId = nbId;
                    addNewPage();
                } else if (action === 'delete-nb') {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = target.dataset.id;
                    const name = target.dataset.name;
                    deleteV2Notebook(id, name);
                } else if (action === 'delete-page') {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = target.dataset.id;
                    deleteV2Page(id);
                }
            });
        }

        const newNbBtn = document.getElementById('v2-new-notebook-btn');
        if (newNbBtn) newNbBtn.addEventListener('click', addNotebook);
        
        const v2BackBtn = document.getElementById('v2-back-btn');
        if (v2BackBtn && !v2BackBtn.dataset.bound) {
            v2BackBtn.dataset.bound = "true";
            v2BackBtn.addEventListener('click', closeV2Editor);
        }
        
        renderV2MemoryFragments(allPages);
        return;
    }

    const list = document.getElementById('notebook-list');
    if (!list) return;

    list.innerHTML = notebooks.map(nb => `
        <li class="notebook-item flex justify-between items-center ${store.currentNotebookId === nb.id ? 'active' : ''}" data-id="${nb.id}" data-name="${nb.name}">
            <div class="flex items-center gap-3">
                <span class="folder-icon">📁</span>
                <span class="name">${nb.name}</span>
            </div>
            <button class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/20 text-white/70 hover:text-white transition-all" data-nb="${nb.id}" title="이 노트에 페이지 추가" onclick="event.preventDefault(); event.stopPropagation(); if (window.v2QuickAddPage) window.v2QuickAddPage('${nb.id}');">
                <span class="material-symbols-outlined text-[18px]">add</span>
            </button>
        </li>
    `).join('');

    const activeNb = notebooks.find(n => n.id === store.currentNotebookId);
    if (activeNb) {
        const sidebarTitle = document.getElementById('sidebar-notebook-title');
        if (sidebarTitle) sidebarTitle.value = activeNb.name;
        
        const displayTitle = document.getElementById('current-notebook-display-title');
        if (displayTitle) displayTitle.innerText = activeNb.name;

        const newPageBtn = document.getElementById('new-page-btn');
        if (newPageBtn) newPageBtn.innerText = `📝 페이지 추가`;
    }

    list.querySelectorAll('.notebook-item').forEach(item => {
        item.addEventListener('click', () => {
            store.currentNotebookId = item.dataset.id;
            const notebookName = item.dataset.name;

            document.querySelectorAll('.notebook-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            const sidebarTitle = document.getElementById('sidebar-notebook-title');
            if (sidebarTitle) sidebarTitle.value = notebookName;

            const displayTitle = document.getElementById('current-notebook-display-title');
            if (displayTitle) displayTitle.innerText = notebookName;

            const newPageBtn = document.getElementById('new-page-btn');
            if (newPageBtn) newPageBtn.innerText = `📝 페이지 추가`;

            // [HOTFIX] 모바일 드로워 조작 - 일기 목록을 확인해야 하므로 1단 폴더만 수축
            if (window.innerWidth <= 768) {
                document.querySelector('.notebook-sidebar')?.classList.remove('active-drawer');
            }

            loadPages();
        });
    });

    await loadPages();
}

export async function loadPages() {
    const token = await store.getSessionToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/history`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    const list = document.getElementById('page-list');
    if (!list) {
        if (document.getElementById('v2-notebook-accordion-list')) {
            return loadNotebooks();
        }
        return;
    }

    const filtered = (data.history || []).filter(h => 
        h.notebookId === store.currentNotebookId || 
        ((!h.notebookId || h.notebookId === 'nb-1') && store.currentNotebookId === 'nb-1')
    );

    list.innerHTML = filtered.length > 0 ? filtered.map(p => `
        <div class="page-item ${store.currentPageId === p.id ? 'active' : ''}" data-id="${p.id}">
            <div class="page-title">${p.title || '제목 없음'}</div>
            <div class="page-meta">
                <span class="emotion-tag">${p.emotion || '평온'}</span>
                <span class="date">${new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('') : '<div class="empty-msg">작성된 페이지가 없습니다.</div>';

    list.querySelectorAll('.page-item').forEach(item => {
        item.addEventListener('click', () => {
            selectPage(item.dataset.id, data.history);

            // [HOTFIX] 모바일 드로워 조작 - 일기 선택 완료 시 1단 및 2단 모두 닫음
            if (window.innerWidth <= 768) {
                document.querySelector('.notebook-sidebar')?.classList.remove('active-drawer');
                document.querySelector('.pages-sidebar')?.classList.remove('active-drawer');
            }
        });
    });
}

export function selectPage(pageId, history) {
    const page = history.find(p => p.id === pageId);
    if (!page) return;

    store.currentPageId = pageId;
    document.querySelectorAll('.page-item').forEach(i => i.classList.remove('active'));
    document.querySelector(`.page-item[data-id="${pageId}"]`)?.classList.add('active');

    document.getElementById('note-title').value = page.title || '';
    if (store.quillEditor) {
        store.quillEditor.root.innerHTML = page.richContent || `<p>${page.originalContent || ''}</p>`;
    }

    const resultArea = document.getElementById('analysis-result-area');
    const resultContent = document.getElementById('analysis-content');
    if (resultContent) {
        resultContent.innerHTML = (page.aiResponse || '비서가 대기 중입니다.').replace(/\n/g, '<br>');
    }
    if (resultArea) {
        if (page.aiResponse) {
            resultArea.classList.remove('hidden');
        } else {
            resultArea.classList.add('hidden');
        }
    }
    const dateDisplay = document.getElementById('note-date-display');
    if (dateDisplay) dateDisplay.innerText = new Date(page.createdAt).toLocaleString();

    const v2Editor = document.getElementById('v2-editor-container');
    if (v2Editor) {
        populateV2NotebookSelect().then(() => {
            const select = document.getElementById('v2-notebook-select');
            if (select && page.notebookId) select.value = page.notebookId;
        });
        openV2Editor();
    }
}

export async function addNotebook() {
    const name = prompt('새 노트의 이름을 입력하세요:', '새 노트');
    if (!name || name.trim() === '') return;
    
    const token = await store.getSessionToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
    });
    const data = await res.json();
    const notebooks = data.notebooks || [];

    const newNb = { id: `nb-${Date.now()}`, name, color: '#6366f1' };
    notebooks.push(newNb);

    await saveNotebooks(notebooks);

    store.currentNotebookId = newNb.id;
    await loadNotebooks();

    const sidebarTitle = document.getElementById('sidebar-notebook-title');
    if (sidebarTitle) {
        sidebarTitle.value = name;
        sidebarTitle.focus();
        sidebarTitle.select();
    }
}

export async function saveNotebooks(notebooks) {
    const token = await store.getSessionToken();
    if (!token) return;

    await fetch(`${API_URL}/notebooks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ notebooks })
    });
}

export async function deleteNotebook() {
    if (store.currentNotebookId === 'nb-1') {
        alert('기본 필기장은 삭제할 수 없습니다.');
        return;
    }
    if (!confirm('현재 필기장을 삭제하시겠습니까? 안의 모든 일기가 사라집니다.')) return;

    const token = await store.getSessionToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
    });
    const data = await res.json();
    let notebooks = data.notebooks || [];

    const deletedId = store.currentNotebookId;
    notebooks = notebooks.filter(n => n.id !== deletedId);

    // 1. 노트북 리스트를 안전하게 대기 업데이트
    await saveNotebooks(notebooks);

    // 2. 백엔드에서 삭제된 노트북에 속했던 고아 일기 기록들 일괄 영구 소독 삭제
    try {
        await fetch(`${API_URL}/notebooks?notebookId=${deletedId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (err) {
        console.warn('Failed to clean up associated diaries on database:', err);
    }

    // 3. 기본 폴더로 복구 및 갱신
    store.currentNotebookId = 'nb-1';
    await loadNotebooks(); // <-- 이제 100% 비동기 렌더링이 완료될 때까지 안전하게 대기합니다!

    // 4. [UX INNOVATION] 비동기 대기 완료 후 첫 일기를 오차 없이 즉각 스마트 로드!
    const pageItems = document.querySelectorAll('#page-list .page-item');
    if (pageItems.length > 0) {
        pageItems[0].click();
    } else {
        addNewPage();
    }
}

export async function addNewPage() {
    if (store.quillEditor) store.quillEditor.root.innerHTML = '';
    const titleEl = document.getElementById('note-title');
    if (titleEl) titleEl.value = '';

    const resultArea = document.getElementById('analysis-result-area');
    const resultContent = document.getElementById('analysis-content');
    if (resultContent) {
        resultContent.innerText = '새로운 일기를 작성해 보세요.';
    }
    if (resultArea) {
        resultArea.classList.add('hidden');
    }

    store.currentPageId = null;
    document.querySelectorAll('.page-item').forEach(i => i.classList.remove('active'));

    const v2Editor = document.getElementById('v2-editor-container');
    if (v2Editor) {
        populateV2NotebookSelect().then(() => {
            const select = document.getElementById('v2-notebook-select');
            if (select && store.currentNotebookId) select.value = store.currentNotebookId;
        });
        openV2Editor();
    }
}

export function setupNotebooksAndPages() {
    // 1. 노트북 추가/삭제 이벤트 바인딩
    document.getElementById('add-notebook-btn')?.addEventListener('click', addNotebook);
    document.getElementById('remove-notebook-btn')?.addEventListener('click', deleteNotebook);
    document.getElementById('new-page-btn')?.addEventListener('click', addNewPage);
    document.getElementById('fab-write-btn')?.addEventListener('click', addNewPage);
    document.getElementById('v2-gallery-more-btn')?.addEventListener('click', openV2Gallery);
    document.getElementById('v2-gallery-back-btn')?.addEventListener('click', closeV2Gallery);

    const quickAddNbBtn = document.getElementById('v2-quick-add-nb-btn');
    if (quickAddNbBtn && !quickAddNbBtn.dataset.bound) {
        quickAddNbBtn.dataset.bound = "true";
        quickAddNbBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addNotebook();
        });
    }

    // 2. [HOTFIX] 모바일 드로워 여닫기 및 자동 닫힘 핫픽스 스크립트
    const drawerToggle = document.getElementById('mobile-drawer-toggle');
    const sidebar1 = document.querySelector('.notebook-sidebar');
    const sidebar2 = document.querySelector('.pages-sidebar');
    const noteArea = document.querySelector('.note-content-area');

    if (drawerToggle && sidebar1 && sidebar2) {
        drawerToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = sidebar1.classList.contains('active-drawer');
            if (isOpen) {
                sidebar1.classList.remove('active-drawer');
                sidebar2.classList.remove('active-drawer');
            } else {
                sidebar1.classList.add('active-drawer');
                sidebar2.classList.add('active-drawer');
            }
        });

        // 에디터 영역 터치/클릭 시 드로워 자동 닫기
        noteArea?.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                sidebar1.classList.remove('active-drawer');
                sidebar2.classList.remove('active-drawer');
            }
        });
    }

    // 3. 노트북 이름 blur 실시간 반영
    document.getElementById('sidebar-notebook-title')?.addEventListener('blur', async (e) => {
        const newName = e.target.value.trim();
        if (!newName) return;

        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/notebooks`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const notebooks = data.notebooks || [];

        const nb = notebooks.find(n => n.id === store.currentNotebookId);
        if (nb && nb.name !== newName) {
            nb.name = newName;
            await saveNotebooks(notebooks);

            const displayTitle = document.getElementById('current-notebook-display-title');
            if (displayTitle) displayTitle.innerText = newName;

            loadNotebooks();
        }
    });

    // 4. 사이드바 Resizers 이벤트 바인딩
    setupResizers();
    
    // 5. 기억 조각 직접 업로드 초기화
    setupDirectFragmentUpload();

    // 6. 기억 조각 다중 선택 및 공유 초기화
    setupGallerySharing();
}

function setupResizers() {
    const resizer1 = document.getElementById('resizer-1');
    const resizer2 = document.getElementById('resizer-2');
    const sidebar1 = document.querySelector('.notebook-sidebar');
    const sidebar2 = document.querySelector('.pages-sidebar');

    if (!resizer1 || !resizer2) return;

    let isResizing = false;

    resizer1.addEventListener('mousedown', () => {
        if (window.innerWidth <= 768) return; // 모바일 가드
        isResizing = true;
        document.addEventListener('mousemove', handleResize1);
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.removeEventListener('mousemove', handleResize1);
        });
    });

    resizer2.addEventListener('mousedown', () => {
        if (window.innerWidth <= 768) return; // 모바일 가드
        isResizing = true;
        document.addEventListener('mousemove', handleResize2);
        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.removeEventListener('mousemove', handleResize2);
        });
    });

    function handleResize1(e) {
        if (!isResizing || window.innerWidth <= 768) return;
        const width = e.clientX - sidebar1.getBoundingClientRect().left;
        if (width > 100 && width < 400) sidebar1.style.width = width + 'px';
    }

    function handleResize2(e) {
        if (!isResizing || window.innerWidth <= 768) return;
        const width = e.clientX - sidebar2.getBoundingClientRect().left;
        if (width > 150 && width < 500) sidebar2.style.width = width + 'px';
    }
}

function renderV2MemoryFragments(allPages) {
    const memoryGrid = document.getElementById('v2-memory-grid');
    if (!memoryGrid) return;
    
    console.log(`--- [DEBUG FRAGMENTS] renderV2MemoryFragments started. Pages size:`, allPages.length);
    
    let fragments = [];
    allPages.forEach(p => {
        const isE2e = p.richContent && p.richContent.startsWith('e2e:');
        if (isE2e) {
            console.log(`--- [DEBUG FRAGMENTS] Page "${p.title || '무제'}" (${p.id}) is E2E Encrypted. Decryption required for image extraction.`);
        }
        if (p.richContent && !isE2e) {
            const regex = /<img[^>]+src=["']([^"']+)["']/g;
            let match;
            while ((match = regex.exec(p.richContent)) !== null) {
                // Remove HTML tags for excerpt
                const tmp = document.createElement('div');
                tmp.innerHTML = p.originalContent || p.richContent || '';
                const text = tmp.textContent || tmp.innerText || '';
                
                fragments.push({ imgUrl: match[1], title: p.title || '제목 없음', excerpt: text.substring(0, 50), date: new Date(p.createdAt), id: p.id });
            }
        }
    });
    console.log(`--- [DEBUG FRAGMENTS] Total extracted fragments:`, fragments.length);

    fragments.sort((a,b) => b.date - a.date);
    
    // Show most recent 10 fragments (naturally containing today's photos first, followed by previous days)
    const recentFragments = fragments.slice(0, 10);

    if (recentFragments.length === 0) {
        memoryGrid.innerHTML = '<div class="swiper-slide w-full"><p class="font-label-sm text-outline italic py-4 text-center">아직 간직된 사진이 없습니다.</p></div>';
        return;
    }

    memoryGrid.innerHTML = recentFragments.map(f => `
    <article class="swiper-slide bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/30 soft-shadow paper-texture flex flex-col cursor-pointer hover:border-primary/50 transition-colors memory-item" data-id="${f.id}">
        <div class="h-40 relative overflow-hidden">
            <img alt="${f.title}" class="w-full h-full object-cover" src="${f.imgUrl}">
        </div>
        <div class="p-4 bg-surface h-full">
            <h4 class="font-label-sm text-on-surface truncate mb-1">${f.title}</h4>
            <p class="font-body-md text-on-surface-variant text-[12px] line-clamp-3 leading-snug mb-2">${f.excerpt}...</p>
        </div>
    </article>`).join('');

    // Setup Event Delegation for clicks (works even for duplicated slides in Swiper loop mode)
    const memorySwiperEl = document.getElementById('memory-swiper');
    if (memorySwiperEl && !memorySwiperEl.dataset.delegated) {
        memorySwiperEl.dataset.delegated = "true";
        memorySwiperEl.addEventListener('click', (e) => {
            const art = e.target.closest('.memory-item');
            if (!art) return;
            if (!art.classList.contains('swiper-slide-active')) {
                return; // Let Swiper slide it to center
            }
            selectPage(art.dataset.id, store.history || allPages);
            window.scrollTo({top: 0, behavior: 'smooth'});
        });
    }

    if (window.memorySwiper) {
        window.memorySwiper.destroy(true, true);
    }
    
    // Initialize Swiper after rendering
    if (typeof Swiper !== 'undefined') {
        window.memorySwiper = new Swiper('#memory-swiper', {
            effect: 'coverflow',
            grabCursor: true,
            centeredSlides: true,
            slidesPerView: 'auto',
            coverflowEffect: {
                rotate: 25,
                stretch: -110, // Pulls the 280px wide slides closer together to create an overlapping accordion effect
                depth: 140,
                modifier: 1,
                slideShadows: true, // Enable shadows to visually separate overlapping cards in 3D space
            },
            loop: recentFragments.length > 5, // Enable infinite loop only if plenty of slides
            slideToClickedSlide: true,
            observer: true,
            observeParents: true,
            pagination: {
                el: '.swiper-pagination',
                dynamicBullets: true
            },
            initialSlide: Math.floor(recentFragments.length / 2) // Start at center
        });
    }

    // Setup Filter Tabs
    const tabs = ['tab-all', 'tab-shared', 'tab-mine'];
    tabs.forEach(tabId => {
        const tabEl = document.getElementById(tabId);
        if (tabEl && !tabEl.hasAttribute('data-bound')) {
            tabEl.setAttribute('data-bound', 'true');
            tabEl.addEventListener('click', () => {
                tabs.forEach(t => {
                    const el = document.getElementById(t);
                    if (el) {
                        el.classList.remove('active-tab');
                        el.classList.add('text-on-surface-variant');
                    }
                });
                tabEl.classList.remove('text-on-surface-variant');
                tabEl.classList.add('active-tab');
                renderV2MemoryFragments(allPages);
            });
        }
    });

    const activeTab = document.querySelector('.active-tab')?.id || 'tab-all';
    let filteredFragments = fragments;
    if (activeTab === 'tab-mine') {
        filteredFragments = fragments.filter(f => !f.isSharedIncoming);
    } else if (activeTab === 'tab-shared') {
        filteredFragments = fragments.filter(f => f.isSharedIncoming || f.shared);
    }

    // Render Full Gallery
    const fullGalleryGrid = document.getElementById('v2-full-gallery-grid');
    if (fullGalleryGrid) {
        if (filteredFragments.length === 0) {
            fullGalleryGrid.innerHTML = '<p class="text-on-surface-variant font-label-sm col-span-2 md:col-span-3 text-center py-10">보관된 기억 조각이 아직 없습니다.</p>';
        } else {
            fullGalleryGrid.innerHTML = filteredFragments.map(f => {
                const isSelected = selectedPageIds.has(f.id);
                const isE2e = !!f.isE2e;
                return `
                <div class="photo-card full-memory-item cursor-pointer relative ${isSelected ? 'ring-2 ring-primary' : ''}" data-id="${f.id}">
                    <div class="aspect-square overflow-hidden rounded-md bg-surface-container relative">
                        <img class="w-full h-full object-cover" src="${f.imgUrl}" alt="${f.title}">
                        
                        ${selectModeActive ? `
                        <!-- Checkbox overlay -->
                        <div class="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center bg-black/40 rounded-full">
                            <input type="checkbox" class="w-4 h-4 rounded border-outline focus:ring-primary text-primary gallery-item-checkbox" data-id="${f.id}" ${isSelected ? 'checked' : ''} ${isE2e ? 'disabled' : ''}>
                        </div>
                        ` : ''}

                        ${isE2e ? `
                        <!-- E2E indicator -->
                        <div class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white p-2 text-center" title="E2E 암호화된 일기는 공유할 수 없습니다.">
                            <span class="material-symbols-outlined text-xl mb-1 text-warning">lock</span>
                            <span class="text-[9px]">공유 불가 (E2E)</span>
                        </div>
                        ` : ''}
                    </div>

                    <!-- Shared incoming indicator badge -->
                    ${f.isSharedIncoming ? `
                    <div class="absolute top-2 left-2 bg-secondary text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow">
                        ${f.sharedBy?.nickname || '친구'}의 기억
                    </div>
                    ` : ''}

                    <!-- Shared outgoing indicator badge -->
                    ${(!f.isSharedIncoming && f.shared) ? `
                    <div class="absolute top-2 left-2 bg-primary text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold shadow">
                        공유 중
                    </div>
                    ` : ''}

                    <p class="mt-1.5 text-[10px] text-outline text-center font-medium">${new Date(f.createdAt).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '')}</p>
                </div>`;
            }).join('');

            fullGalleryGrid.querySelectorAll('.full-memory-item').forEach(art => {
                art.addEventListener('click', (e) => {
                    const id = art.dataset.id;
                    const page = allPages.find(p => p.id === id);
                    if (!page) return;

                    if (selectModeActive) {
                        if (page.isE2e) {
                            alert('E2E 암호화된 일기는 공유할 수 없습니다.');
                            return;
                        }
                        e.stopPropagation();
                        e.preventDefault();

                        if (selectedPageIds.has(id)) {
                            selectedPageIds.delete(id);
                        } else {
                            selectedPageIds.add(id);
                        }

                        // Toggle active border ring
                        if (selectedPageIds.has(id)) {
                            art.classList.add('ring-2', 'ring-primary');
                        } else {
                            art.classList.remove('ring-2', 'ring-primary');
                        }

                        // Sync checkbox input state
                        const cb = art.querySelector('.gallery-item-checkbox');
                        if (cb) cb.checked = selectedPageIds.has(id);

                        // Update selected count
                        const countText = document.getElementById('v2-gallery-select-count');
                        if (countText) countText.textContent = `${selectedPageIds.size}개 선택됨`;

                        const shareBtn = document.getElementById('v2-gallery-share-btn');
                        if (shareBtn) {
                            shareBtn.disabled = selectedPageIds.size === 0;
                            if (selectedPageIds.size === 0) {
                                shareBtn.classList.add('opacity-50', 'pointer-events-none');
                            } else {
                                shareBtn.classList.remove('opacity-50', 'pointer-events-none');
                            }
                        }
                        return;
                    }

                    // Original View Detail
                    const fragment = filteredFragments.find(f => f.id === id);
                    const imgUrl = fragment ? fragment.imgUrl : '';
                    const imgEl = document.getElementById('detail-photo-img');
                    if (imgEl) imgEl.src = imgUrl || 'https://via.placeholder.com/400x500';
                    
                    const titleEl = document.getElementById('detail-photo-title');
                    if (titleEl) titleEl.textContent = page.title || '무제';
                    
                    const dateEl = document.getElementById('detail-photo-date');
                    if (dateEl) {
                        dateEl.textContent = new Date(page.createdAt).toLocaleDateString('ko-KR', { 
                            year: 'numeric', month: 'long', day: 'numeric' 
                        });
                    }

                    // Set current page id in detail view
                    const detailContainer = document.getElementById('v2-photo-detail-container');
                    if (detailContainer) {
                        detailContainer.setAttribute('data-current-page-id', page.id);
                        detailContainer.classList.remove('hidden');
                        detailContainer.style.transform = 'translateY(0)';
                    }

                    // Close share menu if open
                    const shareMenu = document.getElementById('v2-photo-share-menu');
                    if (shareMenu) shareMenu.classList.add('hidden');

                    // Update share badge visibility
                    const shareBadge = document.getElementById('v2-photo-share-badge');
                    if (shareBadge) {
                        if (page.shared) {
                            shareBadge.classList.remove('hidden');
                        } else {
                            shareBadge.classList.add('hidden');
                        }
                    }
                });
            });
            
            // Setup close button for Photo Detail View
            const detailBackBtn = document.getElementById('v2-photo-detail-back-btn');
            if (detailBackBtn && !detailBackBtn.hasAttribute('data-bound')) {
                detailBackBtn.setAttribute('data-bound', 'true');
                detailBackBtn.addEventListener('click', () => {
                    const detailContainer = document.getElementById('v2-photo-detail-container');
                    if (detailContainer) {
                        detailContainer.style.transform = 'translateY(100%)';
                        setTimeout(() => detailContainer.classList.add('hidden'), 300);
                    }
                });
            }

            // Setup Share toggle menu for Photo Detail View
            const detailShareBtn = document.getElementById('v2-photo-detail-share-btn');
            if (detailShareBtn && !detailShareBtn.hasAttribute('data-bound')) {
                detailShareBtn.setAttribute('data-bound', 'true');
                detailShareBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const shareMenu = document.getElementById('v2-photo-share-menu');
                    if (shareMenu) {
                        shareMenu.classList.toggle('hidden');
                    }
                });

                // Hide menu on document click
                document.addEventListener('click', () => {
                    const shareMenu = document.getElementById('v2-photo-share-menu');
                    if (shareMenu) shareMenu.classList.add('hidden');
                });
            }

            // Setup Share option action
            const shareOptBtn = document.getElementById('v2-photo-share-opt-share');
            if (shareOptBtn && !shareOptBtn.hasAttribute('data-bound')) {
                shareOptBtn.setAttribute('data-bound', 'true');
                shareOptBtn.addEventListener('click', async () => {
                    const detailContainer = document.getElementById('v2-photo-detail-container');
                    const currentPageId = detailContainer?.getAttribute('data-current-page-id');
                    if (!currentPageId) return;
                    try {
                        const token = await store.getSessionToken();
                        const res = await fetch(`${API_URL}/history/${currentPageId}`, {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ shared: true })
                        });
                        const data = await res.json();
                        if (data.success) {
                            alert('이 사진이 1촌에게 공유되었습니다.');
                            const shareBadge = document.getElementById('v2-photo-share-badge');
                            if (shareBadge) shareBadge.classList.remove('hidden');
                            // Update local page object
                            const page = allPages.find(p => p.id === currentPageId);
                            if (page) page.shared = true;
                        } else {
                            alert('공유 실패: ' + data.error);
                        }
                    } catch (err) {
                        console.error(err);
                        alert('공유 설정 중 오류가 발생했습니다.');
                    }
                });
            }

            // Setup Unshare option action
            const unshareOptBtn = document.getElementById('v2-photo-share-opt-unshare');
            if (unshareOptBtn && !unshareOptBtn.hasAttribute('data-bound')) {
                unshareOptBtn.setAttribute('data-bound', 'true');
                unshareOptBtn.addEventListener('click', async () => {
                    const detailContainer = document.getElementById('v2-photo-detail-container');
                    const currentPageId = detailContainer?.getAttribute('data-current-page-id');
                    if (!currentPageId) return;
                    try {
                        const token = await store.getSessionToken();
                        const res = await fetch(`${API_URL}/history/${currentPageId}`, {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ shared: false })
                        });
                        const data = await res.json();
                        if (data.success) {
                            alert('공유가 취소되었습니다. (비공개 전환)');
                            const shareBadge = document.getElementById('v2-photo-share-badge');
                            if (shareBadge) shareBadge.classList.add('hidden');
                            // Update local page object
                            const page = allPages.find(p => p.id === currentPageId);
                            if (page) page.shared = false;
                        } else {
                            alert('공유 취소 실패: ' + data.error);
                        }
                    } catch (err) {
                        console.error(err);
                        alert('공유 취소 중 오류가 발생했습니다.');
                    }
                });
            }

            // Setup Delete button for Photo Detail View
            const detailDeleteBtn = document.getElementById('v2-photo-detail-delete-btn');
            if (detailDeleteBtn && !detailDeleteBtn.hasAttribute('data-bound')) {
                detailDeleteBtn.setAttribute('data-bound', 'true');
                detailDeleteBtn.addEventListener('click', async () => {
                    const detailContainer = document.getElementById('v2-photo-detail-container');
                    const currentPageId = detailContainer?.getAttribute('data-current-page-id');
                    if (!currentPageId) return;
                    if (confirm('이 사진 일기를 정말 삭제하시겠습니까?')) {
                        try {
                            const token = await store.getSessionToken();
                            const res = await fetch(`${API_URL}/history/${currentPageId}`, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            const data = await res.json();
                            if (data.success) {
                                alert('성공적으로 삭제되었습니다.');
                                // Close detail view
                                if (detailContainer) {
                                    detailContainer.style.transform = 'translateY(100%)';
                                    setTimeout(() => detailContainer.classList.add('hidden'), 300);
                                }
                                // Reload notebooks
                                await loadNotebooks();
                            } else {
                                alert('삭제 실패: ' + data.error);
                            }
                        } catch (err) {
                            console.error(err);
                            alert('삭제 중 오류가 발생했습니다.');
                        }
                    }
                });
            }
        }
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

export async function populateV2NotebookSelect() {
    const select = document.getElementById('v2-notebook-select');
    if (!select) return;
    
    const token = await store.getSessionToken();
    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store'
    });
    const data = await res.json();
    const notebooks = (data.success && data.notebooks?.length > 0) ? data.notebooks : [{ id: 'nb-1', name: '내 일기장' }];
    
    select.innerHTML = notebooks.map(nb => `<option value="${nb.id}" ${nb.id === store.currentNotebookId ? 'selected' : ''}>${nb.name}</option>`).join('');
}

export async function deleteV2Notebook(id, name) {
    if (id === 'nb-1') {
        alert('기본 노트는 삭제할 수 없습니다.');
        return;
    }
    if (!confirm(`'${name}' 노트를 정말 삭제하시겠습니까? (이 노트에 포함된 일기도 모두 삭제됩니다)`)) {
        return;
    }

    try {
        const token = await store.getSessionToken();
        if (!token) return;

        const res = await fetch(`${API_URL}/notebooks`, {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });
        const data = await res.json();
        
        let notebooks = data.notebooks || [];
        notebooks = notebooks.filter(nb => nb.id !== id);

        await saveNotebooks(notebooks);

        try {
            await fetch(`${API_URL}/notebooks?notebookId=${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (err) {
            console.warn('Failed to clean up associated diaries on database:', err);
        }

        if (store.currentNotebookId === id) {
            store.currentNotebookId = 'nb-1';
        }

        await loadNotebooks();
        alert('노트가 성공적으로 삭제되었습니다.');
    } catch (err) {
        console.error('Failed to delete notebook:', err);
        alert('노트 삭제 중 오류가 발생했습니다: ' + err.message);
    }
}

export function v2QuickAddPage(nbId) {
    store.currentNotebookId = nbId;
    addNewPage();
}

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
                if (store.quillEditor) store.quillEditor.root.innerHTML = '';
                const resultArea = document.getElementById('analysis-result-area');
                if (resultArea) resultArea.classList.add('hidden');
            }
            await loadNotebooks();
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
                await loadNotebooks();
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
        selectModeActive = active;
        selectedPageIds.clear();
        
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
            selectCountText.textContent = `${selectedPageIds.size}개 선택됨`;
        }
        if (shareBtn) {
            shareBtn.disabled = selectedPageIds.size === 0;
            if (selectedPageIds.size === 0) {
                shareBtn.classList.add('opacity-50', 'pointer-events-none');
            } else {
                shareBtn.classList.remove('opacity-50', 'pointer-events-none');
            }
        }
    };

    selectBtn.addEventListener('click', () => {
        toggleSelectMode(!selectModeActive);
    });

    cancelBtn?.addEventListener('click', () => {
        toggleSelectMode(false);
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

    shareConfirmClose?.addEventListener('click', closeShareModal);
    shareConfirmScrim?.addEventListener('click', closeShareModal);

    // Open Share Modal
    shareBtn?.addEventListener('click', async () => {
        if (selectedPageIds.size === 0) return;

        customAddedRecipients = [];
        const customContainer = document.getElementById('v2-share-custom-recipients-container');
        if (customContainer) customContainer.classList.add('hidden');
        
        // 1. Render Previews
        const previewsContainer = document.getElementById('v2-share-selected-previews');
        if (previewsContainer) {
            const selectedImages = [];
            document.querySelectorAll('.full-memory-item').forEach(el => {
                const id = el.dataset.id;
                if (selectedPageIds.has(id)) {
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
                        
                        if (!customAddedRecipients.some(r => r.id === id)) {
                            customAddedRecipients.push({ id, nickname });
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

        if (customAddedRecipients.length > 0) {
            customContainer.classList.remove('hidden');
            customList.innerHTML = customAddedRecipients.map(r => `
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
                    customAddedRecipients = customAddedRecipients.filter(r => r.id !== id);
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

        const allRecipients = [...checkedFriends, ...customAddedRecipients];
        const token = await store.getSessionToken();
        if (!token) return;

        finalizeShareBtn.disabled = true;
        finalizeShareBtn.textContent = '공유 중...';

        const promises = Array.from(selectedPageIds).map(pageId => {
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
            await loadNotebooks();
        } catch (err) {
            console.error(err);
            alert('공유 일괄 요청 중 심각한 오류가 발생했습니다.');
        } finally {
            finalizeShareBtn.disabled = false;
            finalizeShareBtn.textContent = '공유 완료';
        }
    });
}
