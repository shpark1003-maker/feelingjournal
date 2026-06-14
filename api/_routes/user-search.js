const { supabase, verifyUser } = require('./shared');
const { Client } = require('pg');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        const { data: { user } } = await supabase.auth.getUser(authHeader.split(' ')[1]);
        if (!user) return res.status(401).json({ error: 'Invalid user' });

        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const nicknameQuery = req.query.nickname;
        if (!nicknameQuery || nicknameQuery.trim().length === 0) {
            return res.json({ success: true, users: [] });
        }

        const connectionString = process.env.POSTGRES_URL;
        if (!connectionString) {
            return res.status(500).json({ error: 'Database connection configuration missing' });
        }

        const client = new Client({
            connectionString,
            ssl: { rejectUnauthorized: false }
        });

        await client.connect();

        try {
            // Find users matching nickname (partial/case-insensitive ILIKE match), excluding the caller
            const sql = `
                SELECT p.id, p.nickname, p.avatar_url, u.email
                FROM public.profiles p
                JOIN auth.users u ON p.id = u.id
                WHERE p.nickname ILIKE $1 AND p.id != $2
                LIMIT 10
            `;
            const dbRes = await client.query(sql, [`%${nicknameQuery.trim()}%`, user.id]);

            const obfuscateEmail = (email) => {
                if (!email) return '';
                const parts = email.split('@');
                if (parts.length !== 2) return email;
                const name = parts[0];
                const domain = parts[1];
                if (name.length <= 3) {
                    return name[0] + '*'.repeat(name.length - 1) + '@' + domain;
                }
                return name.slice(0, 3) + '*'.repeat(Math.max(3, name.length - 3)) + '@' + domain;
            };

            const users = dbRes.rows.map(row => ({
                id: row.id,
                nickname: row.nickname || '이름 없음',
                avatar_url: row.avatar_url || null,
                email: obfuscateEmail(row.email)
            }));

            return res.json({ success: true, users });
        } finally {
            await client.end();
        }
    } catch (error) {
        console.error('User Search API Error:', error);
        return res.status(500).json({ error: error.message });
    }
};
