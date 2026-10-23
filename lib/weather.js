/**
 * Weather + geocoding adapter (Open-Meteo, no API key).
 *
 * Plain Node: works in the Electron main process and in tests. All failures are
 * returned as data, never thrown at the caller — the UI must keep working with
 * a stale cache when the network is down.
 */
'use strict'

const TIMEOUT_MS = 8000

const WMO = {
  0: ['晴', '☀️'], 1: ['大致晴朗', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['冻雾', '🌫️'],
  51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['大毛毛雨', '🌧️'],
  56: ['冻毛毛雨', '🌧️'], 57: ['强冻毛毛雨', '🌧️'],
  61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'], 67: ['强冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
  80: ['小阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
  85: ['小阵雪', '🌨️'], 86: ['大阵雪', '❄️'],
  95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷暴伴冰雹', '⛈️'],
}

function describe(code) {
  const hit = WMO[Number(code)]
  return hit ? { text: hit[0], icon: hit[1] } : { text: '未知天气', icon: '🌡️' }
}

async function getJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'desk-pet/0.1' },
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

async function geocode(query, language) {
  const q = String(query || '').trim()
  if (!q) return []
  // e2e 用：DESKPET_GEOCODE_BASE 指向本地桩服务，免得 CI 依赖外网。
  const base = process.env.DESKPET_GEOCODE_BASE || 'https://geocoding-api.open-meteo.com/v1/search?'
  const url = base + 'name=' +
    encodeURIComponent(q) + '&count=5&language=' + (language || 'zh') + '&format=json'
  const data = await getJson(url)
  const list = Array.isArray(data.results) ? data.results : []
  return list.map((r) => ({
    name: r.name,
    admin: r.admin1 || '',
    country: r.country || '',
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone || '',
  }))
}

/**
 * 欧洲 AQI（Open-Meteo air-quality 的 `european_aqi`）分级。
 * 阈值与 EEA 一致；只给「能不能出门」这种有用的话，不堆术语。
 */
const AQI_LEVELS = [
  { max: 20, text: '优', tip: '空气很干净，开窗换换气吧' },
  { max: 40, text: '良', tip: '空气不错，出去走走正好' },
  { max: 60, text: '中等', tip: '敏感的话少在外面久待' },
  { max: 80, text: '较差', tip: '关会儿窗，回家先洗把脸' },
  { max: 100, text: '很差', tip: '尽量待在室内，出门戴口罩' },
  { max: Infinity, text: '极差', tip: '别开窗了，能不出门就不出门' },
]

/** @returns {{level:number, text:string, tip:string}|null} */
function aqiGrade(value) {
  if (value === null || value === undefined || value === '') return null
  const v = Number(value)
  if (!Number.isFinite(v) || v < 0) return null
  for (let i = 0; i < AQI_LEVELS.length; i++) {
    if (v <= AQI_LEVELS[i].max) return { level: i, text: AQI_LEVELS[i].text, tip: AQI_LEVELS[i].tip }
  }
  return null
}

/** Three days of 「明天/后天」 lines; today is already on the weather card. */
function parseDays(daily) {
  const d = daily || {}
  const times = Array.isArray(d.time) ? d.time : []
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)
  const labels = ['今天', '明天', '后天']
  const days = []
  for (let i = 0; i < Math.min(3, times.length); i++) {
    const desc = describe((d.weather_code || [])[i])
    days.push({
      label: labels[i],
      date: String(times[i] || ''),
      high: num((d.temperature_2m_max || [])[i]),
      low: num((d.temperature_2m_min || [])[i]),
      code: (d.weather_code || [])[i],
      text: desc.text,
      icon: desc.icon,
      precip: num((d.precipitation_probability_max || [])[i]) || 0,
      sunrise: String((d.sunrise || [])[i] || '').slice(11, 16),
      sunset: String((d.sunset || [])[i] || '').slice(11, 16),
    })
  }
  return days
}

/** Turn the numbers into one warm, non-judgemental sentence. */
function advice(weather) {
  if (!weather || !Number.isFinite(weather.temp)) return ''
  const { temp, feels, precip, wind, uv, code } = weather
  const codeNum = Number(code)
  const rainy = (codeNum >= 51 && codeNum <= 67) || (codeNum >= 80 && codeNum <= 82) || codeNum >= 95
  // 80–82 are rain showers even though they share the 8x range with snow showers.
  const snowy = (codeNum >= 71 && codeNum <= 77) || codeNum === 85 || codeNum === 86
  if (snowy) return '外面在下雪，路滑，慢慢走～'
  if (rainy || precip >= 55) return '记得带伞呀，别淋成小落汤鸡'
  if (feels <= 3) return '好冷好冷，围巾手套都戴上'
  if (feels <= 11) return '有点凉，出门加件外套吧'
  if (Number.isFinite(uv) && uv >= 8) return '太阳很晒，防晒别忘了哦'
  if (feels >= 32) return '热热的，多喝水、少在太阳下站着'
  if (Number.isFinite(wind) && wind >= 38) return '风好大，帽子抓紧一点'
  if (temp >= 20 && temp <= 27) return '今天很舒服，适合出去走一走'
  return '今天的温度刚刚好，照顾好自己呀'
}

/**
 * Air quality is a second host and a second call: it must never take the
 * weather card down with it, so every failure becomes `null`.
 * @returns {Promise<{aqi:number, level:number, text:string, tip:string, pm25:number|null, pm10:number|null}|null>}
 */
async function fetchAirQuality(lat, lon) {
  try {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality'
      + '?latitude=' + Number(lat).toFixed(4)
      + '&longitude=' + Number(lon).toFixed(4)
      + '&current=european_aqi,pm2_5,pm10'
      + '&timezone=auto'
    const data = await getJson(url)
    const cur = (data && data.current) || {}
    const grade = aqiGrade(cur.european_aqi)
    if (!grade) return null
    const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)
    return {
      aqi: num(cur.european_aqi),
      level: grade.level,
      text: grade.text,
      tip: grade.tip,
      pm25: num(cur.pm2_5),
      pm10: num(cur.pm10),
    }
  } catch (err) {
    return null
  }
}

async function fetchWeather({ lat, lon, city, label }) {
  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('缺少经纬度')
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + latitude.toFixed(4)
    + '&longitude=' + longitude.toFixed(4)
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset,uv_index_max'
    + '&hourly=temperature_2m,weather_code,precipitation_probability'
    + '&timezone=auto&forecast_days=3'
  const data = await getJson(url)
  const cur = data.current || {}
  const daily = data.daily || {}
  const hourly = data.hourly || {}
  const desc = describe(cur.weather_code)
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null)

  const times = Array.isArray(hourly.time) ? hourly.time : []
  const nowIso = String(cur.time || '').slice(0, 13)
  let start = times.findIndex((t) => String(t).slice(0, 13) >= nowIso)
  if (start < 0) start = 0
  const upcoming = []
  for (let i = start; i < Math.min(times.length, start + 8) && upcoming.length < 6; i++) {
    const at = String(times[i] || '')
    if (upcoming.length === 0 && at.slice(0, 13) === nowIso) continue // skip the current hour
    const hourDesc = describe((hourly.weather_code || [])[i])
    upcoming.push({
      time: at.slice(11, 16),
      hour: Number(at.slice(11, 13)),
      temp: num((hourly.temperature_2m || [])[i]),
      text: hourDesc.text,
      icon: hourDesc.icon,
      precip: num((hourly.precipitation_probability || [])[i]) || 0,
    })
  }

  const days = parseDays(daily)
  const air = await fetchAirQuality(latitude, longitude)

  const result = {
    ok: true,
    city: city || label || '',
    label: label || '',
    temp: num(cur.temperature_2m),
    feels: num(cur.apparent_temperature),
    humidity: num(cur.relative_humidity_2m),
    wind: num(cur.wind_speed_10m),
    isDay: cur.is_day == null ? true : Number(cur.is_day) === 1,
    code: cur.weather_code,
    text: desc.text,
    icon: desc.icon,
    high: num((daily.temperature_2m_max || [])[0]),
    low: num((daily.temperature_2m_min || [])[0]),
    precip: num((daily.precipitation_probability_max || [])[0]) || 0,
    uv: num((daily.uv_index_max || [])[0]),
    sunrise: String((daily.sunrise || [])[0] || '').slice(11, 16),
    sunset: String((daily.sunset || [])[0] || '').slice(11, 16),
    tomorrow: days[1] ? { high: days[1].high, low: days[1].low, text: days[1].text } : null,
    days,
    air,
    hourly: upcoming,
    updatedAt: Date.now(),
  }
  result.advice = advice(result)
  return result
}

module.exports = { fetchWeather, geocode, describe, advice, aqiGrade, parseDays, fetchAirQuality, WMO, AQI_LEVELS, TIMEOUT_MS }
