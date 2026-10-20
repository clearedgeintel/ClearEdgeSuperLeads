// Ported from Instant Site (vitest → jest; globals replace the vitest import).
import { resolveMapsInput, parseMapsUrl, isMapsShortLink } from "../../server/sites/maps";

describe("parseMapsUrl", () => {
  it("extracts name and coords from a full /place/ URL", () => {
    const url =
      "https://www.google.com/maps/place/Lone+Star+Roofing/@30.2672,-97.7431,15z/data=!4m6";
    const { nameHint, coords } = parseMapsUrl(url);
    expect(nameHint).toBe("Lone Star Roofing");
    expect(coords).toEqual({ lat: 30.2672, lng: -97.7431 });
  });

  it("decodes percent-encoded characters in the place segment", () => {
    const url = "https://www.google.com/maps/place/Joe%27s+HVAC+%26+Air/@29.76,-95.36,14z";
    expect(parseMapsUrl(url).nameHint).toBe("Joe's HVAC & Air");
  });

  it("falls back to the q= param when there is no /place/ segment", () => {
    const url = "https://www.google.com/maps?q=Acme+Plumbing+Dallas+TX";
    expect(parseMapsUrl(url).nameHint).toBe("Acme Plumbing Dallas TX");
  });

  it("ignores a pure-coordinate q= value", () => {
    const url = "https://www.google.com/maps?q=30.2672,-97.7431";
    expect(parseMapsUrl(url).nameHint).toBe("");
  });
});

describe("isMapsShortLink", () => {
  it("recognizes maps.app.goo.gl and goo.gl", () => {
    expect(isMapsShortLink("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isMapsShortLink("https://goo.gl/maps/xyz")).toBe(true);
  });
  it("rejects full maps URLs and non-URLs", () => {
    expect(isMapsShortLink("https://www.google.com/maps/place/Foo")).toBe(false);
    expect(isMapsShortLink("Foo Roofing, Austin TX")).toBe(false);
  });
});

describe("resolveMapsInput", () => {
  it("treats a bare 'Name, City ST' string as the name hint", async () => {
    const r = await resolveMapsInput("Lone Star Roofing, Austin TX");
    expect(r.nameHint).toBe("Lone Star Roofing, Austin TX");
    expect(r.mapsUrl).toBeNull();
  });

  it("parses a full /place/ URL without any network call", async () => {
    const r = await resolveMapsInput(
      "https://www.google.com/maps/place/Lone+Star+Roofing/@30.2672,-97.7431,15z"
    );
    expect(r.nameHint).toBe("Lone Star Roofing");
    expect(r.coords).toEqual({ lat: 30.2672, lng: -97.7431 });
    expect(r.locHint).toContain("30.2672");
  });

  it("expands a short link via the injected fetch, then parses the final URL", async () => {
    const fakeFetch = async (_url: string) => ({
      url: "https://www.google.com/maps/place/Acme+Plumbing/@32.7767,-96.797,15z",
    });
    const r = await resolveMapsInput("https://maps.app.goo.gl/abc123", { fetchImpl: fakeFetch });
    expect(r.nameHint).toBe("Acme Plumbing");
    expect(r.mapsUrl).toContain("/place/Acme+Plumbing");
    expect(r.coords).toEqual({ lat: 32.7767, lng: -96.797 });
  });

  it("merges a caller locHint with parsed coordinates", async () => {
    const r = await resolveMapsInput(
      "https://www.google.com/maps/place/Foo/@10,20,15z",
      { locHint: "Austin, TX" }
    );
    expect(r.locHint).toBe("Austin, TX — coordinates 10,20");
  });

  it("throws a human message on empty input", async () => {
    await expect(resolveMapsInput("   ")).rejects.toThrow(/paste/i);
  });

  it("throws a human message when a URL yields no name", async () => {
    await expect(
      resolveMapsInput("https://www.google.com/maps/@30.2672,-97.7431,15z")
    ).rejects.toThrow(/business name/i);
  });
});
