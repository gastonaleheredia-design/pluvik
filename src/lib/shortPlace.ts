/**
 * Reverse-geocode a lat/lon into a short, display-friendly label.
 *
 * The full street address from Mapbox (e.g. "7202 Sharpview Drive, Houston,
 * Texas 77074, United States") is too long for the hero header — it gets
 * truncated and looks noisy. We prefer a compact form:
 *   - "Neighborhood, City"  (when a neighborhood is known)
 *   - "City, ST"             (otherwise)
 * The exact lat/lon is preserved upstream — only the visible label changes.
 */
export async function reverseGeocodeShort(
  lat: number,
  lon: number,
  token: string,
): Promise<string> {
  const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  const base = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json`;
  const fetchOne = async (types: string) => {
    try {
      const res = await fetch(
        `${base}?access_token=${token}&limit=1&types=${types}&language=en`,
      );
      if (!res.ok) return null;
      const f = (await res.json())?.features?.[0];
      return f ?? null;
    } catch {
      return null;
    }
  };

  // 1) Ask specifically for a neighborhood. With a dedicated request Mapbox
  //    won't substitute the city for the neighborhood; if it has one, we get it.
  const hood = await fetchOne("neighborhood");
  if (hood) {
    const ctx: Array<{ id?: string; text?: string; short_code?: string }> =
      hood.context ?? [];
    const placeText = ctx.find((c) => c.id?.startsWith("place"))?.text;
    if (placeText) return `${hood.text}, ${placeText}`;
    if (hood.text) return hood.text;
  }

  // 2) No neighborhood — fall back to locality first, then the city.
  const cityish = await fetchOne("locality,place");
  if (cityish) {
    const ctx: Array<{ id?: string; text?: string; short_code?: string }> =
      cityish.context ?? [];
    const regionEntry = ctx.find((c) => c.id?.startsWith("region"));
    const regionShort = regionEntry?.short_code?.replace(/^US-/i, "");
    const region = regionShort || regionEntry?.text;
    if (cityish.id?.startsWith("locality")) {
      const placeText = ctx.find((c) => c.id?.startsWith("place"))?.text;
      if (placeText) return `${cityish.text}, ${placeText}`;
      if (region) return `${cityish.text}, ${region}`;
    }
    if (region) return `${cityish.text}, ${region}`;
    if (cityish.text) return cityish.text;
  }

  return fallback;
}