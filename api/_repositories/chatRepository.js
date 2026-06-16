const { supabase, supabaseAdmin } = require('../_routes/shared');

/**
 * Fetch messages for a given room (limit to 100)
 */
async function fetchRoomMessages(roomId) {
    const client = supabaseAdmin || supabase;
    const { data: messages, error } = await client
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(100);

    if (error) throw error;
    return messages || [];
}

/**
 * Save message to database
 */
async function insertMessage({ roomId, content, senderId, userEmail }) {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
        .from('messages')
        .insert([{
            content,
            sender_id: senderId,
            user_email: userEmail,
            room_id: roomId
        }])
        .select();

    if (error) throw error;
    return data[0];
}

/**
 * Get or create chat room by name and type
 */
async function findOrCreateRoom(name, type) {
    if (!supabaseAdmin) {
        throw new Error('Admin Supabase Client가 설정되지 않았습니다.');
    }

    const { data: existingRoom, error: selectError } = await supabaseAdmin
        .from('rooms')
        .select('*')
        .eq('name', name)
        .maybeSingle();

    if (selectError) throw selectError;
    if (existingRoom) return existingRoom;

    // Create room if not exists
    const { data: newRoom, error: insertError } = await supabaseAdmin
        .from('rooms')
        .insert([{ name, type }])
        .select();

    if (insertError) throw insertError;
    return newRoom[0];
}

module.exports = {
    fetchRoomMessages,
    insertMessage,
    findOrCreateRoom
};
