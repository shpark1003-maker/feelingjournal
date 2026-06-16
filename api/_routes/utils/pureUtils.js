const sanitizeContent = (content) => {
    return String(content || '')
        .replace(/```/g, '')
        .slice(0, 5000)
        .trim();
};

const safeParseJsonArray = (raw, label = 'JSON') => {
    try {
        let clean = String(raw || '[]')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        const arrayMatch = clean.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            clean = arrayMatch[0];
        }

        const parsed = JSON.parse(clean);
        if (!Array.isArray(parsed)) {
            console.error(`${label} Parse Error: result is not array`);
            return [];
        }
        return parsed;
    } catch (error) {
        console.error(`${label} Parse Error:`, error.message);
        return [];
    }
};

const extractEventJson = (text) => {
    try {
        if (!text.includes('EVENT_JSON_START') || !text.includes('EVENT_JSON_END')) {
            return null;
        }

        const startIndex = text.indexOf('EVENT_JSON_START') + 'EVENT_JSON_START'.length;
        const endIndex = text.indexOf('EVENT_JSON_END');
        if (endIndex <= startIndex) return null;

        const jsonStr = text.slice(startIndex, endIndex).trim();
        const event = JSON.parse(jsonStr);

        if (!event.summary || !event.start) return null;

        if (!event.end) {
            const start = new Date(event.start);
            if (Number.isNaN(start.getTime())) return null;
            start.setHours(start.getHours() + 1);
            event.end = start.toISOString();
        }
        return event;
    } catch (error) {
        console.error('Event JSON Extraction Error:', error.message);
        return null;
    }
};

module.exports = {
    sanitizeContent,
    safeParseJsonArray,
    extractEventJson
};
