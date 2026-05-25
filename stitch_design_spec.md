# Feeling Journal - Stitch Design & UI/UX Specification Manual

본 설명서는 AI 감성 일기 앱인 **Feeling Journal**의 각 페이지별 UI 사양 및 디자인 시스템을 정리한 공식 스펙 가이드라인입니다. 디자인 AI 엔진인 **Stitch** 혹은 프론트엔드 생성 엔진에 입력하여 고품질의 일관된 UI를 설계하고 구현할 수 있도록 토크나이징된 설계도를 제공합니다.

---

## 🎨 1. Global Design Tokens (디자인 시스템 정의)

### Colors & Gradients (색상 및 그라디언트)
*   **Primary Gradient**: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` (신비롭고 감성적인 보라/청색 그라디언트)
*   **Accent Color**: `#6c5ce7` (주요 강조용 슬레이트 퍼플)
*   **Secondary Color**: `#a29bfe` (보조 색상용 연보라)
*   **Background (Light)**: `#f8f9fa` (차분하고 맑은 회색)
*   **Background (Dark/Special)**:
    *   **Body Background**: 어둡고 입체적인 야간 감성 래디얼 그라디언트 조합
        *   `radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%)`
        *   `radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%)`
        *   `radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%)`
*   **Text Colors**: Main `#2d3436` (차콜 그레이), Muted `#636e72` (미드 그레이)
*   **Card Background**: `rgba(255, 255, 255, 0.9)` (반투명 백색 글래스모피즘)

### Typography (타이포그래피)
*   **Font Family**: `'Noto Sans KR', 'Outfit', sans-serif` (영문 및 기하학적 요소는 Outfit 적용, 한글은 Noto Sans KR 적용)
*   **Heading 1**: `font-size: 2rem`, `font-weight: 700`, `text-fill-color: transparent` (그라디언트 텍스트 마스킹 처리)
*   **Heading 2**: `font-size: 1.2rem`, `font-weight: 600`
*   **Body**: `font-size: 0.95rem` ~ `1.1rem`, `line-height: 1.6` ~ `1.8`

### UI Effect & Spacing (효과 및 간격)
*   **Glassmorphism**: `backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.3);`
*   **Border Radius**: `20px` (둥글고 세련된 프리미엄 스타일)
*   **Transitions**: `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)` (부드러운 이징 효과)
*   **Soft Shadow**: `0 10px 30px rgba(0, 0, 0, 0.05)`
*   **Strong Shadow**: `0 15px 35px rgba(108, 92, 231, 0.2)`

---

## 📱 2. Page-by-Page Specifications (페이지별 사양)

### Page 1: Auth Screen (인증 및 진입 화면)
*   **Layout**: 화면 중앙 정렬 카드 레이아웃 (`max-width: 450px`)
*   **Key Elements**:
    1.  **로고 타이틀**: `AI 일기` 글자 우측에 라운드 처리된 배지 배치 (`Beta` 마크 표시, 배경 `#6c5ce7`, 글자 흰색)
    2.  **로그인 폼**: 이메일 및 비밀번호 입력용 인풋 (`border-radius: 12px`, 포커스 시 보라색 테두리와 아웃라인 글로우 효과)
    3.  **로그인/회원가입 버튼**: 세로 정렬 구조. 로그인(기본 보라 그라디언트 주 버튼), 회원가입(대비가 높은 어두운 회색 `#4a4a4a` 부 버튼)
    4.  **소셜 로그인 버튼**: 구글(흰색 배경, 테두리 회색), 카카오(노란색 배경 `#FEE500`, 마크 좌측 배치)

### Page 2: Journal View (노트 - OneNote형 3단 리사이즈 레이아웃)
*   **Layout**: 좌측사이드바1 (240px) + 좌측사이드바2 (280px) + 메인에디터 영역 (남은 공간 전체 차지). 열 간 리사이저 핸들(`resizer`) 존재.
*   **Column 1: Notebook Sidebar (필기장 관리)**
    *   **Theme**: 프리미엄 다크 테마 (`background: #252423`, 글자 흰색)
    *   **Header**: 필기장 제목 입력용 텍스트 필드(배경 투명, 테두리 없음, 볼드 폰트) + 추가/삭제용 아이콘 버튼 (`＋`, `－`)
    *   **List**: 필기장 리스트. 액티브 상태 시 왼쪽 보라색 테두리 라인 강조 (`border-left: 4px solid #6c5ce7`)
*   **Column 2: Pages Sidebar (페이지 목록)**
    *   **Theme**: 연한 밝은 회색 테마 (`background: #f3f2f1`, 우측 경계 보더 `#e1e1e1`)
    *   **Header**: 현재 선택된 필기장 제목 (`#current-notebook-display-title`) + `📝 페이지 추가` 대형 주 버튼
    *   **List**: 작성 일기 페이지 카드 목록. 액티브 상태 시 배경 백색 반전 및 우측에 액센트 보더 (`box-shadow: -4px 0 0 var(--accent-color) inset`)
*   **Column 3: Main Note Content Area (메인 에디터 및 분석)**
    *   **AI Briefing Card (최상단)**: 그라디언트 카드 배경. 세로 높이 리사이즈 핸들 지원 (`resize: vertical`). 내부에 스티키 처리된 헤더 "나의 비서 브리핑"과 텍스트 영역 존재.
    *   **Editor Section (중앙)**:
        *   **Note Toolbar**: 모바일 목차 드로워 토글용 햄버거 버튼 + 초대형 제목 텍스트 필드 (`font-size: 2.2rem`, 볼드) + 작성 날짜 메타 영역
        *   **Quill Editor**: 커스텀 폰트 및 이모지 피커가 내장된 에디터 본문.
        *   **Editor Footer**:
            *   미디어 첨부 그룹 (카메라/비디오 `📷`, 웹스크랩 `🌐`, 음성기록 `🎙️`)
            *   분석/AI 그룹 (`✍️ 글 도우미` 윤리 유도 챗봇 버튼, `✨ AI 분석 및 저장` 메인 액션 버튼)
    *   **AI Analysis Panel (최하단)**: 흰색 백그라운드 카드에 왼쪽 `5px`짜리 보라색 포인트 세로줄 보더 처리.

### Page 3: Calendar View (AI 캘린더 화면)
*   **Layout**: 그리드 기반 월간 달력 뷰 (`FullCalendar` 통합 뷰)
*   **Key Elements**:
    1.  **일정 범례 범주 (Legend)**: 화면 상단 우측 위치.
        *   개인 일정: 하늘색 보더 (`#38bdf8`) + 밝은 하늘색 배경
        *   공유 일정: 로즈색 보더 (`#fb7185`) + 밝은 핑크색 배경
        *   비서 분석 할 일: 보라색 보더 (`#818cf8`) + 밝은 보라색 배경
    2.  **일정 카드 호버 애니메이션**: 캘린더 내 일정 블록에 마우스를 올리면 확대되며 그림자가 진해지는 입체 효과 (`transform: scale(1.02); z-index: 100`)
    3.  **지나간 일정**: 흑백 필터와 불투명도 50% 효과로 가독성 구별 (`opacity: 0.5; filter: grayscale(0.5)`)
    4.  **일정 등록 모달**: 폼 내에 노란색 강조 웰컴 상자로 감싸진 **💡 비서 조언** (`#calendar-event-advice-group`) 전용 프레임 영역 포함.

### Page 4: Chat View (1촌 채팅 화면)
*   **Layout**: 좌측 1촌 사이드바 (280px) + 우측 실시간 채팅 본문 영역
*   **Column 1: Chat Sidebar (친구 및 상태)**
    *   **Header**: 내 프로필 사진 변경 원형 프레임 (`75px` 서클, 보라색 아웃라인) 및 `사진 변경` 텍스트 버튼
    *   **List**: 1촌 친구 리스트. 친구 아바타 이미지 서클과 닉네임, 온라인 시 녹색 점 표시
    *   **Footer**: `➕ 친구 초대하기` 풀 텍스트 링크 버튼
*   **Column 2: Chat Main Area (실시간 채팅)**
    *   **Header**: 1촌 목록 드로워 토글 + 채팅방 상대방 이름 + 상하 통화 기능 버튼 그룹 (음성 `📞`, 영상 `📹`)
    *   **Emotional Thermometer Banner**: 대화창 상단에 상시 노출 가능한 온정 배너. 상대방 아바타 이모지 + 감성 온도 텍스트 (`18°C`) + 감정 예보 코멘트 기술 및 둥근 온도 퍼센트 게이지 바.
    *   **Chat Messages Area**: 카카오톡 스카이블루 배경 테마 (`#bacee0`). 우측(본인 전송 노란색 혹은 보라색 버블), 좌측(상대방 전송 흰색 버블). 스크롤바는 아주 얇은 슬림 미드그레이 디자인 적용.
    *   **Chat Footer**:
        *   **AI Summon Toolbar**: 입력창 바로 상단에 마운트된 보라색 `✨ 비서 참여` 및 민트색 `🤫 비서 조언` 알약 캡슐형 버튼 그룹
        *   **Input Wrapper**: 좌우로 둥글게 굴린 하얀 캡슐 형태 입력바. 여러 줄 작성용 텍스트 에어리어 + 클립 `📎` 및 전송 `✈️` 원형 버튼 내장

### Page 5: Settings & Atelier View (설정 및 아틀리에)
*   **Layout**: 투-컬럼 레이아웃 (아바타 생성 및 커스텀 섹션 + 인격 및 시스템 설정 섹션)
*   **Column 1: Persona Avatar Section (아바타 및 음성)**
    *   원형 프레임 아바타 미리보기 + `🎨 AI 얼굴 생성` 및 `📁 사진 업로드` 링크 버튼
    *   목소리 음원 선택 드롭다운 리스트 및 옆에 미리듣기 버튼 배치
*   **Column 2: Persona Config Section (인격 프로필)**
    *   이름 입력 필드, 성별 라디오 버튼 그룹, 연령대 셀렉트 박스, 관계 유형 드롭다운, 성격 특성 텍스트에어리어의 그리드 배치
*   **Feature Card 1: AI Learning Center (인격 학습 센터)**
    *   보라색 테두리에 점선 박스로 둘러싸인 영상 드롭존 영역 (`video-dropzone`, 마우스 오버 시 보라색 배경 투과 및 위로 살짝 뜨는 모션 적용) + `🚀 학습 시작` 액티브 버튼
*   **Feature Card 2: Alarm Settings (푸시 및 브리핑 설정)**
    *   1시간 전, 30분 전, 10분 전 푸시 알림 체크박스 가로 배열
    *   데일리 브리핑 예약 발송 타임 피커 (`briefing-time-input`) 및 실시간 기상 예보 GPS 수신 라디오 버튼 그룹
*   **Feature Card 3: Care Settings (보호자 모드 연동)**
    *   보라색 그라디언트 배경 포인트를 지닌 설정 영역. 케어 모드 ON/OFF 체크박스 및 보호자로 지정할 1촌 친구 리스트 셀렉트 컴포넌트

---

## 🛠️ 3. Special Interactive Overlays (특수 오버레이 사양)

### Overlay 1: AI Video Call Overlay (화상 통화)
*   **Layout**: 풀스크린 어두운 마스킹 배경 위 플로팅 레이아웃
*   **Elements**:
    1.  **AI Video Container**: 중앙 대형 영역. AI 인물의 움직이는 라이브 비주얼 렌더링 프레임 + 우측 상단 `LIVE - CONNECTED` 녹색 배지
    2.  **User Video Container**: 우측 하단 플로팅 미니 웹캠 프레임
    3.  **Speech Bubble**: 하단에 자막처럼 띄워지는 큰 자막 상자
    4.  **Control Panel (최하단)**: 음소거(`🎙️`), 카메라 토글(`📷`), 전화 끊기(`📞`, 붉은색 원형 서클 버튼)

### Overlay 2: Care Mode Voice Fullscreen (실버 케어모드)
*   **Concept**: 노년층 및 저시력 사용자를 위해 고안된 **초고대비/초대형 배려형 인터페이스**
*   **Design Properties**:
    *   **Background**: 깊은 어두운 방사형 그라디언트 (`radial-gradient(circle, #2d3436 0%, #1e272e 100%)`)
    *   **AI Avatar**: 지름 `180px` 이상의 초대형 원형 아바타 (볼륨 게이지에 맞춰 부드럽게 요동치는 애니메이션 구현)
    *   **Live Captions (초대형 자막)**: **`font-size: 2.2rem`**, `font-weight: 700`, 황금색 계열 폰트 (`#ffeaa7`)로 가시성 극대화. 어두운 배경에 텍스트 섀도우 투사하여 대비감 증폭.
    *   **Large Mic Button (초대형 마이크)**: 지름 `110px` 원형 버튼. 은은한 보라 그라디언트 배경에 마이크 아이콘이 들어간 센터 버튼. 터치 시 강한 테두리 파동 애니메이션 효과 적용.

---

## 🧭 4. Responsive & Mobile Adaptive (모바일 대응 및 드로워 사양)

*   **Tablet Layout (1024px이하)**: 3단 레이아웃 중 폴더 사이드바의 텍스트가 사라지고 콤팩트한 아이콘 세로 밴드로 압축됨.
*   **Mobile Layout (768px이하)**:
    1.  **물리 리사이저 소멸**: 리사이저 핸들(`resizer`)의 노출이 차단되고 마우스 제어 제한.
    2.  **드로워 레이아웃(Drawer) 전환**: 1단 폴더 사이드바와 2단 페이지 사이드바가 화면 밖 좌측(`left: 0`, `-100%` 오프셋)으로 축소 오버레이 처리됨.
    3.  **트리거 동작**: 에디터 영역 상단의 `📖 목차` 토글 버튼을 누르면 부드럽게 화면 왼쪽에서 우측으로 밀고 나오는 드로워 활성화 (`active-drawer` 클래스 바인딩, 뒷배경 희미한 암전 처리).

---

## 🌿 5. Ghibli Sanctuary Theme Specification (지브리 감성 테마 스펙)

향후 일기장 에디터 뷰 및 대시보드 뷰의 전체 고도화를 위해 제공되는 지브리 테마 통합 디자인 사양서입니다.

### 🎨 Design Tokens (지브리 전용 토큰)
*   **Primary (Forest Green)**: `#4A6741` (따뜻하고 차분한 숲 속의 녹색)
*   **Secondary (Warm Wood)**: `#8D775F` (나무 질감의 편안한 브라운)
*   **Accent (Soft Sunset)**: `#D4A373` (노을빛 따뜻한 오렌지색)
*   **Background (Cream Paper)**: `#FDFCF0` / `#FFFDF5` (오래된 종이 느낌의 부드러운 미색)
*   **Border/Outline (Dark Charcoal)**: `#5D574D` (손그림 드로잉 느낌을 내는 두꺼운 펜선 스타일)
*   **Card Effect (Watercolor Border)**: 수채화 느낌의 부드러운 번짐 그림자 효과 (`filter: blur(8px)`) 및 1~2px 갈색 테두리 조합

---

### 📝 5.1. Journal Editor View (일기 쓰기 뷰 지브리 사양)
기존의 차가운 테크 스타일 에디터에서 아날로그 편지지 감성으로 전환하기 위한 레이아웃 사양입니다.

*   **Notebook & Pages Sidebar**:
    - 전체 배경은 `#EFEBDD` 우드 톤 및 `surface-container-low` 미색을 적용합니다.
    - 폴더 아이콘 대신 나뭇잎(`nest_eco_leaf`), 책(`menu_book`) 등의 지브리 감성 아이콘을 전면에 노출합니다.
*   **Journal Paper Editor**:
    - 에디터 본문 영역에 가로 줄노트 스타일(`linear-gradient(#F1EFE3 1px, transparent 1px)`)을 32px 간격으로 깔아 편지지에 쓰는 듯한 느낌을 연출합니다.
    - 에디터 좌측 가장자리에 **바인더 링 스프링 구멍 효과**(둥근 원형 데코레이션)를 겹쳐 아날로그 노트를 펼쳐놓은 입체감을 줍니다.
*   **Cloud Creature Briefing Card**:
    - 구름 정령 캐릭터 아바타 좌측 배치 및 뒷배경에 따뜻한 오렌지빛 파동 애니메이션을 구현합니다.
    - 말풍선 문구는 기울임체(Italic) 및 숲 속의 휴식 테그를 배치합니다.
*   **Sticky Action Footer**:
    - 하단 액션바를 투명 캡슐 형태의 `ghibli-panel`로 띄우고, 갈색 테두리와 수채화 그림자를 투사합니다.

---

### 📊 5.2. Journal Dashboard / Feed View (대시보드 및 피드 뷰 지브리 사양)
작성된 일기들을 모아보고 감정을 치유하는 대시보드 화면 사양입니다.

*   **Left Navigation Sidebar**:
    - 정령 마스코트 프로필 영역과 `New Entry` 추가 버튼을 상단에 띄우고, 하단에는 **주간 감정 수확(Weekly Harvest)** 막대그래프를 배치합니다.
    - 그래프는 완벽한 막대바 대신 손으로 깎아 만든 듯한 비정형 모양과 세이지 그린/우드 웜 톤의 컬러 배합을 사용합니다.
*   **Center Journal Feed**:
    - 중앙 일기 리스트 카드는 수채화 보더 효과(`.watercolor-border`)와 둥근 모서리를 적용하여 액자처럼 표시합니다.
    - 첨부된 사진은 수채화 필터 혹은 폴라로이드 사진처럼 프레임 처리를 합니다.
*   **Right Widgets ( 정령과의 교감 )**:
    - **Cloud Wisdom 카드**: 매일 사용자의 감정 상태에 맞는 따뜻한 조언 한마디를 카드에 노출합니다.
    - **Quick Soothe 도구 상자**: 마음 안정을 돕는 호흡하기(`eco`), 자연 빗소리(`music_note`), 낙서하기(`draw`), 긍정 확언(`favorite`) 버튼 그리드를 배치합니다.
*   **Mouse Cursor Option**:
    - 마우스 커서를 지브리 무드에 맞춰 작은 초록색 물방울/새싹 모양의 SVG 벡터 커서로 매핑합니다.
