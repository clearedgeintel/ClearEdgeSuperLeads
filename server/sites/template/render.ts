import type { BusinessData, SitePhoto, Theme } from "@shared/sites";
import { SAMPLE_TESTIMONIAL_AUTHOR } from "@shared/sites";
import { THEMES, sanitizeHex, onAccentText } from "./themes";
import { buildLocalBusinessJsonLd, serializeJsonLd } from "../jsonLd";

// renderSite(data, theme) -> one standalone HTML document (inline <style>,
// Google Fonts link, no JS dependencies). Built fresh from spec §6. The same
// renderer powers the live /s/:slug URL and the in-app preview iframe.

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip non-dialable chars for a tel: href. */
function telHref(phone: string): string {
  return "tel:" + phone.replace(/[^\d+]/g, "");
}

function ratingChip(data: BusinessData, cls: string): string {
  if (data.rating == null) return "";
  const reviews =
    data.reviewCount != null ? ` <span class="rev">(${esc(String(data.reviewCount))} reviews)</span>` : "";
  return `<span class="${cls}"><span class="stars" aria-hidden="true">★</span> ${esc(
    data.rating.toFixed(1)
  )}${reviews}</span>`;
}

export interface RenderOptions {
  /** Where the lead-capture form POSTs (omit to render a non-submitting preview). */
  submitUrl?: string;
  /** Absolute page URL for og:url. */
  pageUrl?: string;
  /** Show the post-submit thank-you state. */
  submitted?: boolean;
  /** Absolute URL of the view-tracking pixel (omit on previews/sample to not count them). */
  pixelUrl?: string;
  /**
   * 'demo' (default): noindex, demo footer, sample-review note. These pages
   * portray real businesses that haven't agreed to anything, so they must never
   * be indexed. 'live': indexable, canonical link, LocalBusiness JSON-LD.
   */
  mode?: "demo" | "live";
  /** Live mode: absolute canonical URL (custom domain root, else /s/:slug). */
  canonicalUrl?: string;
  /** Hero and gallery photos. */
  photos?: SitePhoto[];
}

/** Only absolute http(s) URLs are rendered as images. */
function safeImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function heroImage(photos: SitePhoto[]): string {
  const hero = photos.find((p) => p.role === "hero" && safeImageUrl(p.url));
  if (!hero) return "";
  return `<img class="hero-img" src="${esc(hero.url)}" alt="${esc(hero.alt)}" width="1200" height="675" fetchpriority="high" decoding="async" />`;
}

function gallery(photos: SitePhoto[]): string {
  const items = photos.filter((p) => p.role === "gallery" && safeImageUrl(p.url));
  if (!items.length) return "";
  return `<section class="section" aria-label="Photos">
    <div class="container">
      <h2 class="h2">Our Work</h2>
      <div class="gallery">${items
        .map(
          (p) =>
            `<img src="${esc(p.url)}" alt="${esc(p.alt)}" width="600" height="400" loading="lazy" decoding="async" />`
        )
        .join("")}</div>
    </div>
  </section>`;
}

export function renderSite(data: BusinessData, theme: Theme, opts: RenderOptions = {}): string {
  const live = opts.mode === "live";
  const photos = opts.photos ?? [];
  const t = THEMES[theme] ?? THEMES.slate;
  const accent = sanitizeHex(data.brandColor);
  const onAccent = onAccentText(accent);
  const hasPhone = !!data.phone;

  const fonts = `https://fonts.googleapis.com/css2?family=${t.fontHeadingName}&family=${t.fontBodyName}&display=swap`;

  // --- Header ---
  const headerCta = hasPhone
    ? `<a class="btn btn-accent" href="${telHref(data.phone!)}">Call ${esc(data.phone!)}</a>`
    : `<a class="btn btn-accent" href="#contact">Get a Free Quote</a>`;

  // --- Hero ---
  const heroCtas = `
    <div class="hero-ctas">
      ${
        hasPhone
          ? `<a class="btn btn-accent btn-lg" href="${telHref(data.phone!)}">Call ${esc(data.phone!)}</a>`
          : ""
      }
      <a class="btn btn-outline btn-lg" href="#contact">Get a Free Quote</a>
    </div>`;

  // --- Stat strip (only stats we actually have) ---
  const stats: { label: string; value: string }[] = [];
  if (data.yearsInBusiness) stats.push({ label: "In business", value: data.yearsInBusiness });
  if (data.rating != null) stats.push({ label: "Rating", value: data.rating.toFixed(1) + " ★" });
  if (data.reviewCount != null) stats.push({ label: "Reviews", value: String(data.reviewCount) });
  if (data.serviceAreas?.length)
    stats.push({ label: "Areas served", value: String(data.serviceAreas.length) });
  const statStrip = stats.length
    ? `<section class="stats" aria-label="Highlights">
        <div class="container stats-grid">
          ${stats
            .map((s) => `<div class="stat"><div class="stat-val">${esc(s.value)}</div><div class="stat-label">${esc(s.label)}</div></div>`)
            .join("")}
        </div>
      </section>`
    : "";

  // --- Services grid ---
  const services = (data.services || [])
    .map(
      (s) => `<article class="card">
        <h3 class="card-title">${esc(s.name)}</h3>
        <p class="card-desc">${esc(s.desc)}</p>
      </article>`
    )
    .join("");

  // --- Service areas ---
  const areas = (data.serviceAreas || []).map((a) => `<li>${esc(a)}</li>`).join("");

  // --- Contact panel rows ---
  const contactRows: string[] = [];
  if (hasPhone)
    contactRows.push(
      `<div class="crow"><span class="clabel">Phone</span><a href="${telHref(data.phone!)}">${esc(data.phone!)}</a></div>`
    );
  contactRows.push(`<div class="crow"><span class="clabel">Hours</span><span>${esc(data.hours || "Call for hours")}</span></div>`);
  if (data.website)
    contactRows.push(
      `<div class="crow"><span class="clabel">Website</span><a href="${esc(data.website)}" rel="noopener noreferrer" target="_blank">${esc(
        data.website.replace(/^https?:\/\//, "")
      )}</a></div>`
    );
  if (data.mapsUrl)
    contactRows.push(
      `<div class="crow"><span class="clabel">Map</span><a href="${esc(data.mapsUrl)}" rel="noopener noreferrer" target="_blank">View on Google Maps</a></div>`
    );

  // --- Testimonials (v1 = clearly labeled samples, spec §10) ---
  // Live sites never show samples (publish blocks them; this is the backstop).
  const shownTestimonials = (data.testimonials || []).filter(
    (x) => !live || x.author !== SAMPLE_TESTIMONIAL_AUTHOR
  );
  const isSample = !live && shownTestimonials.some((x) => x.author === SAMPLE_TESTIMONIAL_AUTHOR);
  const testimonials = shownTestimonials
    .map(
      (x) => `<figure class="quote">
        <blockquote>${esc(x.text)}</blockquote>
        <figcaption>— ${esc(x.author)}</figcaption>
      </figure>`
    )
    .join("");
  const testimonialSection = shownTestimonials.length
    ? `<section class="section section-alt" aria-label="Reviews">
        <div class="container">
          <h2 class="h2">What customers say</h2>
          ${isSample ? `<p class="sample-note">Sample reviews — replace with real ones before sending.</p>` : ""}
          <div class="quotes">${testimonials}</div>
        </div>
      </section>`
    : "";

  // Lead-capture "Request a quote" form (spec P1). Renders a thank-you state
  // after a successful POST; renders nothing submittable in preview/sample.
  const quoteForm = opts.submitted
    ? `<div class="qthanks">✓ Thanks — ${esc(data.name)} will be in touch shortly.</div>`
    : opts.submitUrl
      ? `<form class="qform" method="post" action="${esc(opts.submitUrl)}">
          <h3 style="font-size:1.05rem;margin:.2rem 0 .5rem;">Request a free quote</h3>
          <input type="text" name="website_hp" tabindex="-1" autocomplete="off" aria-hidden="true" class="qhp" />
          <input class="qinput" type="text" name="name" placeholder="Your name" required />
          <input class="qinput" type="email" name="email" placeholder="Email" />
          <input class="qinput" type="tel" name="phone" placeholder="Phone" />
          <textarea class="qinput" name="message" rows="2" placeholder="What do you need help with?"></textarea>
          <button class="btn btn-accent" type="submit" style="width:100%;">Send request</button>
        </form>`
      : "";

  // --- Indexing ---
  const robots = live ? "" : `<meta name="robots" content="noindex,nofollow" />`;
  const canonical = live && opts.canonicalUrl ? `<link rel="canonical" href="${esc(opts.canonicalUrl)}" />` : "";
  const jsonLd =
    live && opts.canonicalUrl
      ? `<script type="application/ld+json">${serializeJsonLd(buildLocalBusinessJsonLd(data, opts.canonicalUrl))}</script>`
      : "";
  const footerBy = live
    ? `<a class="by" href="https://clearedgeintel.com" rel="noopener">Website by ClearEdge Intelligence</a>`
    : `<span class="by">Demo site built by ClearEdge Intelligence</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${robots}
<title>${esc(data.name)} — ${esc(data.category)} in ${esc(data.city)}, ${esc(data.state)}</title>
<meta name="description" content="${esc(data.tagline)} ${esc(data.name)} serves ${esc(data.city)}, ${esc(data.state)}." />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(data.name)} — ${esc(data.category)}" />
<meta property="og:description" content="${esc(data.tagline)}" />
${opts.pageUrl ? `<meta property="og:url" content="${esc(opts.pageUrl)}" />` : ""}
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(data.name)} — ${esc(data.category)}" />
<meta name="twitter:description" content="${esc(data.tagline)}" />
${canonical}
${jsonLd}
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${fonts}" rel="stylesheet" />
<style>
  :root {
    --accent: ${accent};
    --on-accent: ${onAccent};
    --page: ${t.pageBg};
    --header: ${t.headerBg};
    --surface: ${t.surface};
    --surface-alt: ${t.surfaceAlt};
    --text: ${t.text};
    --muted: ${t.muted};
    --border: ${t.border};
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: var(--page); color: var(--text);
    font-family: ${t.fontBody}; line-height: 1.6;
  }
  h1, h2, h3 { font-family: ${t.fontHeading}; line-height: 1.15; margin: 0; }
  a { color: inherit; }
  .container { width: 100%; max-width: 1080px; margin: 0 auto; padding: 0 20px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
    padding: .7rem 1.1rem; border-radius: 10px; font-weight: 600; text-decoration: none;
    border: 1px solid transparent; cursor: pointer; transition: transform .15s ease, opacity .15s ease;
  }
  .btn:hover { transform: translateY(-1px); }
  .btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .btn-lg { padding: .9rem 1.4rem; font-size: 1.05rem; }
  .btn-accent { background: var(--accent); color: var(--on-accent); }
  .btn-outline { background: transparent; color: var(--text); border-color: var(--border); }

  /* Header */
  header.site {
    position: sticky; top: 0; z-index: 20; backdrop-filter: blur(8px);
    background: var(--header); border-bottom: 1px solid var(--border);
  }
  .nav { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 0; }
  .brand { font-family: ${t.fontHeading}; font-weight: 800; font-size: 1.15rem; }

  /* Hero */
  .hero { background: ${t.heroBg}; color: ${t.heroText}; padding: 5rem 0 4rem; }
  .hero h1 { font-size: clamp(2rem, 5vw, 3.4rem); font-weight: 800; letter-spacing: -.02em; }
  .hero .tagline { font-size: clamp(1.05rem, 2.5vw, 1.5rem); color: ${t.heroMuted}; margin-top: 1rem; max-width: 40ch; }
  .hero-ctas { display: flex; flex-wrap: wrap; gap: .8rem; margin-top: 2rem; }
  .chip {
    display: inline-flex; align-items: center; gap: .4rem; margin-top: 1.2rem;
    padding: .35rem .7rem; border-radius: 999px; background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: ${t.heroText}; font-weight: 600; font-size: .95rem;
  }
  .chip .stars { color: var(--accent); }
  .chip .rev { color: ${t.heroMuted}; font-weight: 500; }

  /* Stats */
  .stats { background: var(--surface-alt); border-bottom: 1px solid var(--border); }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; padding: 1.6rem 20px; }
  .stat { text-align: center; }
  .stat-val { font-family: ${t.fontHeading}; font-weight: 800; font-size: 1.6rem; color: var(--accent); }
  .stat-label { color: var(--muted); font-size: .9rem; }

  /* Sections */
  .section { padding: 4rem 0; }
  .section-alt { background: var(--surface-alt); }
  .h2 { font-size: clamp(1.5rem, 3.5vw, 2.2rem); font-weight: 800; margin-bottom: 1.5rem; }

  /* Services grid */
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 1rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 1.3rem; }
  .card-title { font-size: 1.15rem; font-weight: 700; }
  .card-desc { color: var(--muted); margin: .5rem 0 0; }

  /* About / area / contact layout */
  .about-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 2rem; align-items: start; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 1.4rem; }
  .area-list { list-style: none; padding: 0; margin: .5rem 0 0; display: flex; flex-wrap: wrap; gap: .5rem; }
  .area-list li { background: var(--surface-alt); border: 1px solid var(--border); border-radius: 999px; padding: .3rem .8rem; font-size: .9rem; }
  .crow { display: flex; justify-content: space-between; gap: 1rem; padding: .6rem 0; border-bottom: 1px solid var(--border); }
  .crow:last-child { border-bottom: 0; }
  .clabel { color: var(--muted); }

  /* Lead-capture form */
  .qform { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: .55rem; }
  .qhp { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
  .qinput {
    width: 100%; padding: .6rem .75rem; border-radius: 10px; font: inherit;
    color: var(--text); background: var(--surface-alt); border: 1px solid var(--border);
  }
  .qinput::placeholder { color: var(--muted); }
  .qinput:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .qthanks {
    margin-top: 1rem; padding: .8rem 1rem; border-radius: 10px; font-weight: 600;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  }

  /* Testimonials */
  .sample-note { color: var(--muted); font-style: italic; margin-top: -.8rem; margin-bottom: 1.2rem; }
  .quotes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; }
  .quote { margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 1.4rem; }
  .quote blockquote { margin: 0; font-size: 1.05rem; }
  .quote figcaption { margin-top: 1rem; color: var(--muted); font-weight: 600; }

  /* Big CTA */
  .cta { background: var(--accent); color: var(--on-accent); text-align: center; padding: 4rem 0; }
  .cta h2 { font-size: clamp(1.6rem, 4vw, 2.4rem); font-weight: 800; }
  .cta p { opacity: .9; margin: .8rem 0 1.8rem; }
  .cta .btn-outline { color: var(--on-accent); border-color: color-mix(in srgb, var(--on-accent) 50%, transparent); }

  /* Footer */
  footer.site { background: ${t.footerBg}; color: ${t.footerText}; padding: 2.5rem 0; }
  .foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; align-items: center; }
  .foot .by { font-size: .9rem; }
  a.by { font-size: .8rem; opacity: .8; text-decoration: none; }
  a.by:hover { text-decoration: underline; }

  /* Photos */
  .hero-img { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 14px; margin-top: 2rem; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
  .gallery img { width: 100%; height: auto; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 12px; background: var(--surface-alt); }

  @media (max-width: 720px) {
    .about-grid { grid-template-columns: 1fr; }
    .hero { padding: 3.5rem 0 3rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior: auto; }
    .btn { transition: none; }
    .btn:hover { transform: none; }
  }
</style>
</head>
<body>
  <header class="site">
    <div class="container nav">
      <span class="brand">${esc(data.name)}</span>
      ${headerCta}
    </div>
  </header>

  <section class="hero">
    <div class="container">
      <h1>${esc(data.name)}</h1>
      <p class="tagline">${esc(data.tagline)}</p>
      ${ratingChip(data, "chip")}
      ${heroCtas}
      ${heroImage(photos)}
    </div>
  </section>

  ${statStrip}

  <section class="section" aria-label="Services">
    <div class="container">
      <h2 class="h2">Our Services</h2>
      <div class="grid">${services}</div>
    </div>
  </section>

  <section class="section section-alt" id="contact">
    <div class="container about-grid">
      <div>
        <h2 class="h2">About ${esc(data.name)}</h2>
        <p>${esc(data.about)}</p>
        <h3 style="margin-top:1.5rem;font-size:1.1rem;">Areas We Serve</h3>
        <ul class="area-list">${areas}</ul>
      </div>
      <aside class="panel" aria-label="Contact">
        <h3 style="font-size:1.1rem;margin-bottom:.4rem;">Get in touch</h3>
        ${contactRows.join("")}
        ${
          hasPhone
            ? `<a class="btn btn-accent" style="width:100%;margin-top:1rem;" href="${telHref(data.phone!)}">Call ${esc(data.phone!)}</a>`
            : ""
        }
        ${quoteForm}
      </aside>
    </div>
  </section>

  ${gallery(photos)}

  ${testimonialSection}

  <section class="cta">
    <div class="container">
      <h2>Ready to get started?</h2>
      <p>${esc(data.name)} proudly serves ${esc(data.city)}, ${esc(data.state)} and nearby.</p>
      ${
        hasPhone
          ? `<a class="btn btn-outline btn-lg" href="${telHref(data.phone!)}">Call ${esc(data.phone!)}</a>`
          : `<a class="btn btn-outline btn-lg" href="#contact">Request a Free Quote</a>`
      }
    </div>
  </section>

  <footer class="site">
    <div class="container foot">
      <span>${esc(data.name)} · ${esc(data.city)}, ${esc(data.state)}</span>
      ${footerBy}
    </div>
  </footer>
  ${opts.pixelUrl ? `<img src="${esc(opts.pixelUrl)}" alt="" width="1" height="1" style="position:absolute;left:-9999px;" />` : ""}
</body>
</html>`;
}
