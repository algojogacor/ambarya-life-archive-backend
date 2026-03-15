import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export const searchPlaces = async (query: string, lat?: number, lng?: number) => {
  const params: any = {
    textQuery: query,
    languageCode: 'id',
  };

  const headers: any = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': API_KEY,
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
  };

  const body: any = { textQuery: query, languageCode: 'id' };

  if (lat && lng) {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 50000.0,
      }
    };
  }

  const res = await axios.post(
    'https://places.googleapis.com/v1/places:searchText',
    body,
    { headers }
  );

  return (res.data.places || []).map((p: any) => ({
    placeId: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    types: p.types || [],
  }));
};

export const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
  const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
    params: { latlng: `${lat},${lng}`, key: API_KEY, language: 'id' }
  });

  const results = res.data.results;
  if (!results || results.length === 0) return 'Lokasi tidak diketahui';
  return results[0].formatted_address;
};

export const getStaticMapUrl = (lat: number, lng: number, zoom: number = 15): string => {
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=400x200&markers=color:red%7C${lat},${lng}&key=${API_KEY}&style=feature:all|element:geometry|color:0x1a1a2e&style=feature:water|color:0x16213e`;
};