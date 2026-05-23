// 1. Supabase 접속 클라이언트 정보 및 API 엔드포인트
export const SUPABASE_BASE_URL = 'https://gfvfilwigbwycnobvnuv.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmdmZpbHdpZ2J3eWNub2J2bnV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDIwNzUsImV4cCI6MjA5MzkxODA3NX0.dxvyeqt9tFizpraFDAcp1B3MfV-IGVdsqwAG6A_Ffa8';
export const API_URL = '/api';

// 2. 글로벌 공유 상태 저장소
export const store = {
    supabaseClient: supabase.createClient(SUPABASE_BASE_URL, SUPABASE_ANON_KEY),
    quillEditor: null,
    currentNotebookId: 'nb-1',
    currentPageId: null,
    currentRoomId: null,
    chatChannel: null,
    isAnalysisRunning: false,
    currentUser: null,
    currentAvatarUrl: null,
    
    // 3. 상태 취득/변경용 간결한 도우미 API
    async getSessionToken() {
        const { data: { session } } = await this.supabaseClient.auth.getSession();
        return session ? session.access_token : null;
    },
    
    async getProviderToken() {
        const { data: { session } } = await this.supabaseClient.auth.getSession();
        return session ? session.provider_token || localStorage.getItem('google_provider_token') : null;
    }
};
