import { reactive } from 'vue';

// Cedarpines Park, CA (San Bernardino County), fixed -- avoids needing a
// location permission on the tablet. Open-Meteo is free and keyless, which
// matters here for the same reason Apps Script beat OAuth for Sheets sync:
// one less account/credential to manage for a single-tablet app.
const LAT = 34.25000;
const LON = -117.32583;
const REFRESH_MS = 30 * 60 * 1000;

export const weather = reactive({ ready: false, error: '', current: null, days: [] });

// WMO weather codes (what Open-Meteo returns) collapsed into four simple
// icon categories -- sun/cloud/rain/snow is plenty for a glance at the bar.
function cat(code) {
  if (code === 0 || code === 1) return 'sun';
  if (code === 2 || code === 3 || code === 45 || code === 48) return 'cloud';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  return 'rain';
}

async function refresh() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + LAT + '&longitude=' + LON
      + '&current=temperature_2m,weather_code'
      + '&daily=temperature_2m_max,temperature_2m_min,weather_code'
      + '&temperature_unit=fahrenheit&timezone=auto&forecast_days=3';
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const d = data.daily;
    weather.days = d.time.map((t, i) => ({
      label: i === 0 ? 'Today' : i === 1 ? 'Tmrw' : new Date(t + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      hi: Math.round(d.temperature_2m_max[i]),
      lo: Math.round(d.temperature_2m_min[i]),
      cat: cat(d.weather_code[i]),
    }));
    weather.current = { temp: Math.round(data.current.temperature_2m), cat: cat(data.current.weather_code) };
    weather.ready = true;
    weather.error = '';
  } catch (err) {
    weather.error = String((err && err.message) || err);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
