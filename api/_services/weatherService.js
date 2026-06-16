const axios = require('axios');
const { redis } = require('../_routes/clients/redis');

const ZONE_MAP = {
    '서울': '1168060000',
    '인천': '2820052500',
    '수원': '4111555000',
    '춘천': '4211054500',
    '대전': '3017055500',
    '청주': '4311151100',
    '광주': '2915551500',
    '전주': '4511153000',
    '대구': '2714055500',
    '부산': '2644053000',
    '울산': '3114056000',
    '제주': '5011059000'
};

async function getLiveWeather(region) {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    const cacheKey = `system:weather-cache:${region}`;

    // Redis 캐시 확인 (30분 간 유지)
    try {
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch (cacheErr) {
        console.warn(`--- [WEATHER CACHE READ ERROR] Region: ${region}, Error: ${cacheErr.message} ---`);
    }
    
    if (apiKey && apiKey !== '여기에_OpenWeather_API키_입력') {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(region)}&appid=${apiKey}&units=metric&lang=kr`;
        try {
            const res = await axios.get(url, { timeout: 1500 });
            const temp = res.data.main.temp;
            const sky = res.data.weather[0]?.description || '맑음';
            const rainVol = res.data.rain ? (res.data.rain['1h'] || 0) : 0;
            
            const weatherResult = {
                region,
                temp,
                sky,
                rainProb: rainVol > 0 ? 100 : 0,
                rainType: rainVol > 0 ? '강수 있음' : '강수 없음'
            };

            await redis.set(cacheKey, JSON.stringify(weatherResult), 'EX', 1800); // 30분 캐시 저장
            return weatherResult;
        } catch (e) {
            console.error(`--- [WEATHER API ERROR] Region: ${region}, Error: ${e.message} ---`);
        }
    }
    
    // Fallback: wttr.in (타임아웃 1.5초 단축)
    const url = `https://wttr.in/${encodeURIComponent(region)}?format=j1`;
    try {
        const res = await axios.get(url, { timeout: 1500 });
        const current = res.data.current_condition?.[0];
        if (!current) return null;
        
        const sky = current.weatherDesc?.[0]?.value || 'Clear';
        const temp = parseFloat(current.temp_C || 0);
        const pop = res.data.weather?.[0]?.hourly?.[0]?.chanceofrain || '0';
        
        const weatherResult = {
            region,
            temp: temp,
            sky: sky,
            rainProb: parseInt(pop, 10) || 0,
            rainType: parseInt(pop, 10) > 30 ? '강수 가능성 있음' : '강수 없음'
        };

        await redis.set(cacheKey, JSON.stringify(weatherResult), 'EX', 1800); // 30분 캐시 저장
        return weatherResult;
    } catch (e) {
        console.error(`--- [WEATHER FETCH ERROR] Region: ${region}, Error: ${e.message} ---`);
        return null;
    }
}

module.exports = {
    ZONE_MAP,
    getLiveWeather
};
