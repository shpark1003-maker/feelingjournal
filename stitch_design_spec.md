# Feeling Journal - Stitch Design & UI/UX Specification Manual (Ghibli Sanctuary Theme)

본 설명서는 지브리 아날로그 감성 테마인 **"Aetheric Sanctuary"** 단일 스타일을 기준으로 정립한 공식 UI/UX 및 디자인 시스템 스펙 가이드라인입니다.

---

## 🎨 1. Global Design Tokens (지브리 감성 디자인 토큰)

### Colors & Gradients (색상 팔레트)
*   **Primary (Forest Green)**: `#4A6741` (따뜻하고 차분한 숲 속의 세이지 녹색)
*   **Secondary (Warm Wood)**: `#8D775F` (나무 질감의 편안한 브라운)
*   **Accent (Soft Sunset)**: `#D4A373` (노을빛 따뜻한 오렌지 웜톤)
*   **Background (Cream Paper)**: `#FDFCF0` 및 `#FFFDF5` (오래된 종이 느낌의 따뜻한 미색)
*   **Border/Outline (Dark Charcoal)**: `#5D574D` (손그림 드로잉 펜선 질감의 테두리 색상)
*   **Watercolor Shadow**: `0 10px 30px -10px rgba(184, 166, 142, 0.3)` (부드러운 황토빛 수채화 번짐 그림자)

### Typography (타이포그래피)
*   **Font Family**: 헤드라인 및 버튼 국문/영문 `'Plus Jakarta Sans', 'Noto Sans KR', sans-serif` (부드러운 라운드 처리 서체)
*   **Headline Font**: `'Plus Jakarta Sans'`, `'Caveat'` (영문 필기체 등 감성 강조용)
*   **Body**: `font-size: 0.95rem` ~ `1.1rem`, `line-height: 1.6` ~ `1.8`

### UI Effect & Spacing (모서리 및 효과)
*   **Border Radius**: `16px` 및 `24px` (둥글고 자연스러운 유기적 모서리)
*   **Watercolor Card (수채화 카드)**: `background: #ffffff`, `border: 2px solid #5D574D`, `box-shadow: var(--watercolor-shadow)`
*   **Paper Texture**: 미세한 크라프트지/한지 질감 배경 이미지 레이어 매핑 (`.paper-texture`)
*   **Transitions**: `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)` (부드러운 애니메이션)

---

## 📱 2. Page-by-Page Specifications (페이지별 지브리 사양)

### Page 1: Auth Screen (인증 화면)
*   **Concept**: 숲속 책방으로 들어서는 듯한 따뜻한 진입 화면
*   **Layout**: 중앙 배치 수채화 카드 (`max-width: 440px`), 배경 종이 질감
*   **Key Elements**:
    1.  **정령 마스코트**: 중앙 상단에 구름 정령 아바타(`mascot.png`) 배치. 부드럽게 위아래로 움직이는 플로팅 애니메이션 (`creature-float`) 및 우측 상단 `Beta` 스티커 배지.
    2.  **입력 폼**: 이메일/비밀번호 입력 상자는 부드러운 인풋(`soft-input`, 테두리 `#e8dfd1`, 포커스 시 Accent 테두리 및 그림자) 구조.
    3.  **버튼 구성**: 지브리 전용 단색 갈색/녹색 볼드 버튼 (`ghibli-button`, 2px solid 테두리 적용), 부버튼은 베이지톤 (`secondary-ghibli`).
    4.  **소셜 로그인**: 구글 및 카카오 로그인 버튼을 둥근 베이지 테두리 그리드로 하단 배치.

### Page 2: Journal View (저널 - OneNote형 3단 리사이즈 레이아웃)
*   **Column 1: Notebook Sidebar (필기장 관리)**
    *   **Theme**: 따뜻한 베이지 우드 테마 (`background: #EFEBDD`, 테두리 `#5D574D`)
    *   **Header**: 나뭇잎(`nest_eco_leaf`) 또는 책(`menu_book`) 아이콘 및 필기장 추가/삭제 버튼
    *   **List**: 필기장 아이템. 활성화 시 테두리와 배경색 변화 (`border-left: 4px solid #4A6741`)
*   **Column 2: Pages Sidebar (페이지 목록)**
    *   **Theme**: 크림 페이퍼 테마 (`background: #FFFDF5`, 우측 펜선 경계선)
    *   **Header**: `📝 페이지 추가` 대형 손그림 스타일 버튼
    *   **List**: 일기 목록 카드. 활성화 시 수채화 프레임 및 입체 쉐도우 효과
*   **Column 3: Main Note Content Area (메인 에디터 및 분석)**
    *   **Briefing Card (최상단)**: 구름 정령의 말풍선 카드. 노을빛 파동 애니메이션과 이탤릭체 조언 제공.
    *   **Editor Section (중앙)**:
        *   **Note Title**: 큼직한 수필집 타이틀 느낌의 인풋.
        *   **Journal Paper Editor**: Quill 에디터 영역에 가로 줄노트 데코레이션(`linear-gradient` 32px 간격) 및 좌측 스프링 구멍 링 데코로 종이 감성 극대화.
        *   **Sticky Action Footer**: 수채화 번짐 패널 위 미디어 첨부(카메라 `📷`, 스크랩 `🌐`, 음성 `🎙️`) 및 `✨ AI 분석 및 저장` 버튼 배치.
    *   **AI Analysis Panel (최하단)**: 수채화 테두리와 함께 자연물 아이콘(숲, 구름 등)이 들어간 피드백 카드.

### Page 3: Calendar View (캘린더)
*   **Layout**: 수채화 보더로 마감된 FullCalendar 기반 달력
*   **Theme**: 크림 페이퍼 텍스처 배경 및 자연주의 톤앤매너
*   **Legend (범례)**:
    - 개인 일정: 세이지 그린 (`#7a9e7e` 배경, `#4A6741` 테두리)
    - 공유 일정: 웜 샌드 오렌지 (`#e8f0e0` 배경, `#d4a373` 테두리)
    - 비서 분석 할 일: 연하늘색 (`#A2C4E1` 배경, 테라코타 테두리)
*   **Key Elements**:
    - 지나간 일정은 50% 불투명도 및 취소선으로 투과 처리.
    - 일정 상세 모달 내부에 구름 정령의 편지 봉투 모양 **💡 비서 조언** 구역 배치.

### Page 4: Chat View (1촌 채팅)
*   **Layout**: 좌측 1촌 사이드바 + 우측 감성 대화창
*   **Theme**: 부드러운 수채화톤 하늘색/크림색 콤비 배경
*   **Emotional Gauge Banner (감성 온도계)**: 대화창 상단에 상대방의 감정 상태를 😭(비) ~ 😊(맑음) 상태와 온도 지수(`18°C`)로 보여주는 손그림 게이지 바.
*   **Spirit Whispers (AI 가이드)**: AI 비서가 대화 흐름을 보조하는 둥근 말풍선 상자.
*   **Chat Bubbles**: 본인 전송(따뜻한 크림/연두색 버블 + 갈색 테두리), 상대방 전송(부드러운 흰색 버블 + 갈색 테두리). 

### Page 5: Settings & Atelier View (설정 및 아틀리에)
*   **Layout**: 아바타 아틀리에(AI 얼굴 생성, 목소리 감성 설정)와 시스템 및 안심 케어 설정을 담은 크림 페이퍼 카드 그리드.
*   **AI Learning Center**: 점선 테두리의 수채화 영상 드롭존 제공, 드래그 시 둥실 떠오르는 부유 모션(`float`).
*   **Care Settings**: 실버 케어용 큼직한 컨트롤 버튼 및 보호자 지정 드롭다운.

---

## 🛠️ 3. Special Interactive Overlays (특수 오버레이 사양)

### Overlay 1: Cozy Video Call Overlay (화상 통화)
*   **Design**: 차갑고 어두운 검정 대신 미색 불투명 필터 레이어를 깔고, AI 캐릭터 라이브 뷰와 내 비디오 화면에 갈색 손그림 보더 적용. 자막은 크고 가독성 높은 베이지색 카드 말풍선 형태로 지원.

### Overlay 2: Care Mode Fullscreen (실버 케어모드)
*   **Concept**: 시인성을 극대화한 아날로그 편안한 배려 모드
*   **Properties**:
    *   **Background**: 부드러운 딥 베이지/카키 브라운 톤의 그라디언트
    *   **Avatar**: 요동치는 물방울 파동 테두리를 가진 지름 `180px` 이상의 대형 정령 마스코트
    *   **Live Captions**: **`font-size: 2.2rem`**의 초대형 자막, 어두운 갈색 글자체로 대비 강하고 편안한 가독성 확보.
    *   **Large Button**: 지름 `110px`의 흙색/나무색 마이크 활성 터치 버튼.

---

## 🧭 4. Responsive & Mobile Adaptive (모바일 반응형 사양)

*   **Mobile Screen (768px 이하)**:
    - 좌측 1단 필기장 사이드바와 2단 페이지 사이드바는 모바일 화면 밖 좌측 숨김 처리.
    - 에디터 상단 `📖 목차` 토글 시 왼쪽에서 미끄러지듯 밀려 나오는 손그림 드로워(`active-drawer`) 구조 제공.
    - 하단 액션 버튼들은 콤팩트한 탭/아이콘 레이아웃으로 크기 축소.
