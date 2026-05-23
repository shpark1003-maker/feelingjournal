import { store, API_URL } from './state.js';

export async function loadNotebooks() {
    const token = await store.getSessionToken();
    if (!token) return;
    
    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    const list = document.getElementById('notebook-list');
    if (!list) return;

    const notebooks = (data.success && data.notebooks?.length > 0)
        ? data.notebooks
        : [{ id: 'nb-1', name: '내 일기장', color: '#6366f1' }];

    if (!store.currentNotebookId || store.currentNotebookId === 'nb-1') {
        store.currentNotebookId = notebooks[0].id;
    }

    list.innerHTML = notebooks.map(nb => `
        <li class="notebook-item ${store.currentNotebookId === nb.id ? 'active' : ''}" data-id="${nb.id}" data-name="${nb.name}">
            <span class="folder-icon">📁</span>
            <span class="name">${nb.name}</span>
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
    if (!list) return;

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
    document.getElementById('note-date-display').innerText = new Date(page.createdAt).toLocaleString();
}

export async function addNotebook() {
    const name = '나의 일기';
    const token = await store.getSessionToken();
    if (!token) return;

    const res = await fetch(`${API_URL}/notebooks`, {
        headers: { 'Authorization': `Bearer ${token}` }
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
        headers: { 'Authorization': `Bearer ${token}` }
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
    document.getElementById('note-title').value = '';

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
}

export function setupNotebooksAndPages() {
    // 1. 노트북 추가/삭제 이벤트 바인딩
    document.getElementById('add-notebook-btn')?.addEventListener('click', addNotebook);
    document.getElementById('remove-notebook-btn')?.addEventListener('click', deleteNotebook);
    document.getElementById('new-page-btn')?.addEventListener('click', addNewPage);

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
