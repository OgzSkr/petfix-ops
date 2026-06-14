const TRENDYOL_ADDRESS_BASE = 'https://apigw.trendyol.com/integration/member/countries/domestic/TR';

const cityNameById = new Map();
const districtNameByCityId = new Map();

function buildTrendyolAuthHeaders(cfg) {
  const supplierId = String(cfg?.supplierId || '').trim();
  return {
    Authorization: `Basic ${cfg?.authToken || ''}`,
    Accept: 'application/json',
    'User-Agent': `${supplierId || 'PetFix'} - SelfIntegration`
  };
}

async function fetchTrendyolJson(url, cfg) {
  const response = await fetch(url, { headers: buildTrendyolAuthHeaders(cfg) });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Trendyol adres API (${response.status}): ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : [];
}

export async function resolveTrendyolCityName(cityId, cfg) {
  const id = Number(cityId);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (cityNameById.has(id)) return cityNameById.get(id);

  try {
    const cities = await fetchTrendyolJson(`${TRENDYOL_ADDRESS_BASE}/cities`, cfg);
    for (const city of cities) {
      if (city?.id != null && city?.name) {
        cityNameById.set(Number(city.id), String(city.name).trim());
      }
    }
  } catch {
    return null;
  }

  return cityNameById.get(id) || null;
}

export async function resolveTrendyolDistrictName(cityId, districtId, cfg) {
  const city = Number(cityId);
  const district = Number(districtId);
  if (!Number.isFinite(city) || city <= 0 || !Number.isFinite(district) || district <= 0) {
    return null;
  }

  if (!districtNameByCityId.has(city)) {
    try {
      const districts = await fetchTrendyolJson(`${TRENDYOL_ADDRESS_BASE}/cities/${city}/districts`, cfg);
      const map = new Map();
      for (const row of districts) {
        if (row?.id != null && row?.name) {
          map.set(Number(row.id), String(row.name).trim());
        }
      }
      districtNameByCityId.set(city, map);
    } catch {
      districtNameByCityId.set(city, new Map());
    }
  }

  return districtNameByCityId.get(city)?.get(district) || null;
}

/** Test ve cache sıfırlama */
export function resetTrendyolAddressLookupCache() {
  cityNameById.clear();
  districtNameByCityId.clear();
}
