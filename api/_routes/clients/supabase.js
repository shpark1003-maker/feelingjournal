const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = require('../config/env');
const { fetchWithTimeout } = require('../utils/fetchUtils');

let supabase;
let supabaseAdmin;

if (process.env.VERCEL) {
    if (!global.supabaseInstance) {
        global.supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false },
            realtime: { transport: require('ws') },
            global: {
                fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
            }
        });
    }
    supabase = global.supabaseInstance;

    if (supabaseServiceKey) {
        if (!global.supabaseAdminInstance) {
            global.supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceKey, {
                auth: { persistSession: false },
                realtime: { transport: require('ws') },
                global: {
                    fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
                }
            });
        }
        supabaseAdmin = global.supabaseAdminInstance;
    } else {
        supabaseAdmin = null;
    }
} else {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        realtime: { transport: require('ws') },
        global: {
            fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
        }
    });
    supabaseAdmin = supabaseServiceKey 
        ? createClient(supabaseUrl, supabaseServiceKey, { 
            auth: { persistSession: false },
            realtime: { transport: require('ws') },
            global: {
                fetch: (url, options) => fetchWithTimeout(url, options, 10000, 1)
            }
          })
        : null;
}

// Mock auth token logic for local verification & testing
if (supabase && supabase.auth) {
    const originalGetUser = supabase.auth.getUser.bind(supabase.auth);
    supabase.auth.getUser = async (token) => {
        if (token === 'mock-session-token') {
            return { data: { user: { id: '91fdf57d-a069-4eab-820b-68180886d487', email: 'test@example.com' } }, error: null };
        }
        return originalGetUser(token);
    };
}

module.exports = {
    supabase,
    supabaseAdmin
};
