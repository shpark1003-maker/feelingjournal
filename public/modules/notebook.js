import { store, API_URL, assertIds } from './state.js?v=5.2.0';

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
                            <span class="material-symbols-outlined group-open:rotate-180 transition-transform duration-300 pointer-events-none" data-icon="expand_less">expand_less</span>
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
                    selectPage(target.dataset.id, allPages);
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
    
    let fragments = [];
    allPages.forEach(p => {
        if (p.richContent) {
            const regex = /<img[^>]+src="([^">]+)"/g;
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

    fragments.sort((a,b) => b.date - a.date);
    
    // Filter for today's fragments
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const todaysFragments = fragments.filter(f => f.date >= startOfToday);
    
    let recentFragments = [];
    if (todaysFragments.length > 0) {
        recentFragments = todaysFragments; // All photos from today
    } else {
        recentFragments = fragments.slice(0, 10); // Or most recent 10 if none today
    }

    if (recentFragments.length === 0) {
        memoryGrid.innerHTML = '<div class="swiper-slide w-full"><p class="font-label-sm text-outline italic py-4 text-center">아직 간직된 사진이 없습니다.</p></div>';
        return;
    }

    memoryGrid.innerHTML = recentFragments.map(f => `
    <article class="swiper-slide bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/30 soft-shadow paper-texture flex flex-col cursor-pointer hover:border-primary/50 transition-colors memory-item" data-id="${f.id}" style="width: 220px; height: 280px;">
        <div class="h-40 relative overflow-hidden">
            <img alt="${f.title}" class="w-full h-full object-cover" src="${f.imgUrl}">
        </div>
        <div class="p-4 bg-surface h-full">
            <h4 class="font-label-sm text-on-surface truncate mb-1">${f.title}</h4>
            <p class="font-body-md text-on-surface-variant text-[12px] line-clamp-3 leading-snug mb-2">${f.excerpt}...</p>
        </div>
    </article>`).join('');

    memoryGrid.querySelectorAll('.memory-item').forEach(art => {
        art.addEventListener('click', (e) => {
            if (!art.classList.contains('swiper-slide-active')) {
                return; // Let Swiper handle moving it to the center
            }
            selectPage(art.dataset.id, allPages);
            window.scrollTo({top: 0, behavior: 'smooth'});
        });
    });

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
                rotate: 40,
                stretch: 0,
                depth: 150,
                modifier: 1,
                slideShadows: true,
            },
            loop: recentFragments.length > 5, // Enable infinite loop only if plenty of slides
            slideToClickedSlide: true,
            pagination: {
                el: '.swiper-pagination',
                dynamicBullets: true
            },
            initialSlide: Math.floor(recentFragments.length / 2) // Start at center
        });
    }

    // Render Full Gallery
    const fullGalleryGrid = document.getElementById('v2-full-gallery-grid');
    if (fullGalleryGrid) {
        if (fragments.length === 0) {
            fullGalleryGrid.innerHTML = '<p class="text-on-surface-variant font-label-sm col-span-2 md:col-span-3 text-center py-10">보관된 조각이 아직 없습니다.</p>';
        } else {
            fullGalleryGrid.innerHTML = fragments.map(f => `
            <div class="photo-card full-memory-item cursor-pointer" data-id="${f.id}">
                <div class="aspect-square overflow-hidden rounded-md bg-surface-container">
                    <img class="w-full h-full object-cover" src="${f.imgUrl}" alt="${f.title}">
                </div>
                <p class="mt-1.5 text-[10px] text-outline text-center font-medium">${new Date(f.createdAt).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '')}</p>
            </div>`).join('');

            fullGalleryGrid.querySelectorAll('.full-memory-item').forEach(art => {
                art.addEventListener('click', () => {
                    const id = art.dataset.id;
                    const page = allPages.find(p => p.id === id);
                    if (page) {
                        // Populate Photo Detail UI
                        const fragment = fragments.find(f => f.id === id);
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
