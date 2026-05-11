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
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
        `?access_token=${token}&limit=1&types=neighborhood,place&language=en`,
    );
    if (!res.ok) return fallback;
    const f = (await res.json())?.features?.[0];
    if (!f) return fallback;
    const ctx: Array<{ id?: string; text?: string; short_code?: string }> =
      f.context ?? [];
    const placeText = ctx.find((c) => c.id?.startsWith("place"))?.text;
    const regionEntry = ctx.find((c) => c.id?.startsWith("region"));
    const regionShort = regionEntry?.short_code?.replace(/^US-/i, "");
    const region = regionShort || regionEntry?.text;
    if (f.id?.startsWith("neighborhood") && placeText) {
      return `${f.text}, ${placeText}`;
    }
    if (f.id?.startsWith("place") && region) {
      return `${f.text}, ${region}`;
    }
    return f.text || fallback;
  } catch {
    return fallback;
  }
}