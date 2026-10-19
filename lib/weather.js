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
  const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
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

async function fetchWeather({ lat, lon, city, label }) {
  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('缺少经纬度')
  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + latitude.toFixed(4)
    + '&longitude=' + longitude.toFixed(4)
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + '&timezone=auto&forecast_days=1'
  const data = await getJson(url)
  const cur = data.current || {}
  const daily = data.daily || {}
  const desc = describe(cur.weather_code)
  return {
    ok: true,
    city: city || label || '',
    label: label || '',
    temp: Math.round(Number(cur.temperature_2m)),
    feels: Math.round(Number(cur.apparent_temperature)),
    humidity: Math.round(Number(cur.relative_humidity_2m)),
    code: cur.weather_code,
    text: desc.text,
    icon: desc.icon,
    high: Math.round(Number((daily.temperature_2m_max || [])[0])),
    low: Math.round(Number((daily.temperature_2m_min || [])[0])),
    precip: Number((daily.precipitation_probability_max || [])[0] || 0),
    updatedAt: Date.now(),
  }
}

module.exports = { fetchWeather, geocode, describe, WMO, TIMEOUT_MS }
