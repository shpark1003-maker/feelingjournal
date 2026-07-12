require('dotenv').config();
const { Client } = require('pg');

async function run() {
    const client = new Client({
        connectionString: process.env.POSTGRES_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to Postgres');

        const sql = `
            CREATE TABLE IF NOT EXISTS public.calendar_events (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
                title TEXT,
                description TEXT,
                start_time TIMESTAMPTZ,
                end_time TIMESTAMPTZ,
                is_all_day BOOLEAN DEFAULT false,
                location TEXT,
                source TEXT DEFAULT 'local',
                external_provider TEXT,
                external_calendar_id TEXT,
                external_event_id TEXT,
                external_etag TEXT,
                external_updated_at TIMESTAMPTZ,
                last_synced_at TIMESTAMPTZ,
                last_local_modified_at TIMESTAMPTZ,
                sync_status TEXT DEFAULT 'synced',
                is_deleted BOOLEAN DEFAULT false,
                deleted_at TIMESTAMPTZ,
                raw_payload JSONB
            );

            ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

            DROP POLICY IF EXISTS "Users can select their own calendar events" ON public.calendar_events;
            CREATE POLICY "Users can select their own calendar events"
            ON public.calendar_events FOR SELECT USING (auth.uid() = user_id);

            DROP POLICY IF EXISTS "Users can insert their own calendar events" ON public.calendar_events;
            CREATE POLICY "Users can insert their own calendar events"
            ON public.calendar_events FOR INSERT WITH CHECK (auth.uid() = user_id);

            DROP POLICY IF EXISTS "Users can update their own calendar events" ON public.calendar_events;
            CREATE POLICY "Users can update their own calendar events"
            ON public.calendar_events FOR UPDATE USING (auth.uid() = user_id);

            DROP POLICY IF EXISTS "Users can delete their own calendar events" ON public.calendar_events;
            CREATE POLICY "Users can delete their own calendar events"
            ON public.calendar_events FOR DELETE USING (auth.uid() = user_id);

            CREATE UNIQUE INDEX IF NOT EXISTS unique_external_calendar_event
            ON public.calendar_events(user_id, external_provider, external_calendar_id, external_event_id)
            WHERE source = 'external';
        `;

        await client.query(sql);
        console.log('Successfully created calendar_events table and RLS policies.');
        
    } catch (err) {
        console.error('Error executing query', err);
    } finally {
        await client.end();
    }
}

run();
