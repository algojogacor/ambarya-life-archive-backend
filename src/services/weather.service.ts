import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.OPENWEATHER_API_KEY;

export interface WeatherData {
  temp: number;
  feels_like: number;
  humidity: number;
  description: string;
  icon: string;
  city: string;
  aqi?: number;
  aqi_label?: string;
}

export const getWeatherByCoords = async (lat: number, lon: number): Promise<WeatherData> => {
  const [weatherRes, aqiRes] = await Promise.all([
    axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
      params: { lat, lon, appid: API_KEY, units: 'metric', lang: 'id' }
    }),
    axios.get(`https://api.openweathermap.org/data/2.5/air_pollution`, {
      params: { lat, lon, appid: API_KEY }
    })
  ]);

  const w = weatherRes.data;
  const aqi = aqiRes.data.list[0].main.aqi;
  const aqiLabels = ['', 'Baik', 'Sedang', 'Tidak Sehat (Sensitif)', 'Tidak Sehat', 'Berbahaya'];

  return {
    temp: Math.round(w.main.temp),
    feels_like: Math.round(w.main.feels_like),
    humidity: w.main.humidity,
    description: w.weather[0].description,
    icon: w.weather[0].icon,
    city: w.name,
    aqi,
    aqi_label: aqiLabels[aqi] || 'Unknown',
  };
};

export const getWeatherByCity = async (city: string): Promise<WeatherData> => {
  const weatherRes = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
    params: { q: city, appid: API_KEY, units: 'metric', lang: 'id' }
  });

  const w = weatherRes.data;
  return {
    temp: Math.round(w.main.temp),
    feels_like: Math.round(w.main.feels_like),
    humidity: w.main.humidity,
    description: w.weather[0].description,
    icon: w.weather[0].icon,
    city: w.name,
  };
};