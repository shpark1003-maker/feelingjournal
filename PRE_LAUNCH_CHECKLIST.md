# 상용화 직전 점검 포인트 (Pre-Launch Checklist)

## 이메일 & 스팸 방지 (Email & Spam Prevention)
- [ ] **메일 발송 서비스 마이그레이션**: 현재의 개인 Gmail 계정 + Nodemailer 연동을 **Resend, SendGrid, AWS SES** 등의 전문 이메일 발송 서비스로 교체.
- [ ] **커스텀 도메인 연동 및 인증**: 발송용 커스텀 도메인(예: `@feelingjournal.com`)을 등록하고, DNS에 **SPF, DKIM, DMARC** 레코드를 추가하여 발송자 신뢰도(Reputation) 확보.
- [ ] **초대 발송 횟수 제한 (Rate Limiting)**: 단일 사용자(또는 IP)가 단기간에 과도한 초대 메일을 발송하여 스팸 봇으로 간주되는 것을 막기 위해, 시간당/일당 발송 한도를 두는 제한 로직 추가.
- [ ] **반송(Bounce) 및 스팸 신고 관리**: 이메일 발송 서비스의 Webhook을 연동하여, 반송되거나 사용자가 스팸으로 신고한 이메일 주소를 블랙리스트에 추가해 재발송을 원천 차단하는 로직 추가.
