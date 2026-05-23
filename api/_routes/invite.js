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
        const shareLink = `${process.env.APP_URL || 'http://localhost:3000'}/?invite_code=${req.user.id}`;

        if (email) {
            if (emailConfigured && transporter) {
                const mailOptions = {
                    from: `"Feeling Journal" <${process.env.EMAIL_USER}>`,
                    to: email,
                    subject: `✨ ${inviterName}님이 당신을 Feeling Journal 채팅방에 초대했습니다!`,
                    html: `
                        <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 15px; background: #fff; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                            <div style="text-align: center; margin-bottom: 20px;">
                                <span style="font-size: 40px;">💌</span>
                            </div>
                            <h2 style="color: #667eea; text-align: center; margin-top: 0;">감성 채팅 초대장</h2>
                            <p style="font-size: 1.1rem; line-height: 1.6; color: #333; text-align: center;">
                                안녕하세요! <b>${inviterName}</b>님이 당신을<br>
                                <b>Feeling Journal</b> 실시간 감성 채팅방에 초대했습니다.
                            </p>
                            <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin: 25px 0; text-align: center;">
                                <p style="margin: 0; color: #666; font-size: 0.95rem;">
                                    "함께 하루를 기록하고 서로의 감성을 나누어 보아요."
                                </p>
                            </div>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${shareLink}" 
                                   style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 35px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block; box-shadow: 0 4px 15px rgba(102,126,234,0.3);">
                                   지금 채팅방 입장하기
                                </a>
                            </div>
                            <p style="font-size: 0.85rem; color: #999; text-align: center; margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px;">
                                본 메일은 사용자의 요청에 의해 발송된 자동 초대장입니다.
                            </p>
                        </div>
                    `
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
