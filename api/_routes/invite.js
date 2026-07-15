const { supabase, redis, emailConfigured, transporter, sendError } = require('./shared');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return sendError(res, 401, '인증 정보가 필요합니다.');
        }

        const token = authHeader.split(' ')[1];
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return sendError(res, 401, '유효하지 않은 토큰입니다.');
        }

        req.user = user;

        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { email } = req.body;
        
        let emailSent = false;
        let mailError = null;

        const inviterName = req.user.user_metadata?.full_name || req.user.email.split('@')[0];
        
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host || 'localhost:3000';
        let baseUrl = `${protocol}://${host}`;
        
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
            if (process.env.VERCEL_URL) {
                baseUrl = `https://${process.env.VERCEL_URL}`;
            } else if (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) {
                baseUrl = process.env.APP_URL;
            } else {
                baseUrl = 'https://feelingjournal.vercel.app';
            }
        }
        
        const shareLink = `${baseUrl}/?invite_code=${req.user.id}`;


        if (email) {
            if (emailConfigured && transporter) {
                const mailOptions = {
                    from: `"Feeling Journal" <${process.env.EMAIL_USER}>`,
                    replyTo: req.user.email,
                    to: email,
                    subject: `[Feeling Journal] ${inviterName}님이 초대했습니다.`,
                    html: `
                        <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                            <p style="font-size: 1.1rem; line-height: 1.6; color: #333;">
                                안녕하세요,<br><br>
                                <b>${inviterName}</b>(${req.user.email})님이 당신을 <b>Feeling Journal</b> 채팅방에 초대했습니다.
                            </p>
                            <p style="font-size: 1rem; color: #555;">
                                아래 링크를 클릭하여 채팅방에 바로 입장하실 수 있습니다:
                            </p>
                            <p>
                                <a href="${shareLink}" style="color: #4a90e2; text-decoration: underline;">
                                    ${shareLink}
                                </a>
                            </p>
                            <p style="font-size: 0.85rem; color: #999; margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">
                                본 메일은 ${inviterName}님의 요청에 의해 발송된 초대 메일입니다.<br>
                                초대를 원치 않으시거나 모르는 분의 메일이라면 이 메일을 무시하셔도 됩니다.
                            </p>
                        </div>
                    `,
                    text: `안녕하세요,\n\n${inviterName}(${req.user.email})님이 당신을 Feeling Journal 채팅방에 초대했습니다.\n\n아래 링크를 통해 채팅방에 바로 입장하실 수 있습니다:\n${shareLink}\n\n본 메일은 ${inviterName}님의 요청에 의해 발송된 초대 메일입니다.\n초대를 원치 않으시거나 모르는 분의 메일이라면 이 메일을 무시하셔도 됩니다.`
                };

                try {
                    await transporter.sendMail(mailOptions);
                    console.log(`--- [EMAIL] Invitation sent to: ${email} ---`);
                    emailSent = true;
                } catch (err) {
                    console.error('--- [WARN] SMTP mail send failed:', err.message);
                    mailError = '이메일 전송 실패: ' + err.message;
                }
            } else {
                console.log('--- [EMAIL] SMTP not configured, skipping email send. ---');
                mailError = '이메일 서버가 설정되지 않았습니다.';
            }
        }

        return res.json({
            success: true,
            emailSent,
            shareLink,
            message: emailSent
                ? '초대 이메일을 성공적으로 보냈습니다!'
                : '이메일 서버 미설정으로 직접 공유할 수 있는 초대 링크가 생성되었습니다.',
            error: mailError
        });
    } catch (error) {
        console.error('Email Send Error:', error);
        return res.status(500).json({ error: '이메일 발송 중 오류가 발생했습니다: ' + error.message });
    }
};
