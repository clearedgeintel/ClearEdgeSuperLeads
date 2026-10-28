# Custom domains for client sites

How to put a client's live site on their own domain (e.g. `www.summitlandscaper.com`).
Sites are served by the **public** Railway service (`server/public.ts`); the admin app only
stores the domain and checks it. v1 is manual: you add each domain in the Railway dashboard.

## How it works

- A site's domain is stored without `www.` (`sites.custom_domain`), plus a flag for whether the
  site lives at **www** (`sites.custom_domain_www`). The one it lives at is the *canonical host*:
  the page's canonical link, sitemap and redirects all use it.
- When a request reaches the public service, it looks the Host header up among **live** sites.
  The canonical host serves the site; the other variant (apex ↔ www) 301-redirects to it. An
  unknown host gets a 404 and never shows another site.
- `/s/<slug>` for a live site with a domain 301s to `https://<canonical host>/`.
- On the domain: `/` is the site, `/robots.txt` allows crawling and points at `/sitemap.xml`.

## Before you start

- **Railway plan limits.** Custom domains count per service: Hobby allows **2**, Pro allows
  **20** by default (Railway raises it on request). Each client uses one domain when you use
  www with registrar forwarding, or two if you also add the bare domain.
- **Use www.** Railway needs CNAME flattening or an ALIAS/ANAME record to serve a bare domain.
  Cloudflare, DNSimple, Namecheap and bunny.net support that; **GoDaddy, AWS Route 53,
  Squarespace, Hostinger, NameSilo, Azure DNS and Hurricane Electric don't.** With www, any
  provider works: www is a normal CNAME and the registrar forwards the bare domain to it.

## Connect a domain (new site)

1. **Editor → Going live:** enter the domain (e.g. `summitlandscaper.com`), keep **Use www**
   ticked, and save. The editor shows the checklist below.
2. **Railway → public service → Settings → Networking → Custom Domain:** add the canonical
   host (`www.summitlandscaper.com`). Railway shows two records for it.
3. **At the DNS provider,** create both, copied exactly:
   - the **CNAME** for `www` → the target Railway shows (`xxxxxx.up.railway.app`; it's
     different for every domain)
   - the **TXT** verification record. Without it Railway answers **404** even when the CNAME works.
4. **Bare domain:** set the registrar's URL forwarding (301, path forwarding on) from
   `summitlandscaper.com` to `https://www.summitlandscaper.com`. (Or, on a provider with
   flattening/ALIAS, add the bare domain in Railway too and point it there; the site server
   redirects it to www.)
5. **Cloudflare only:** with the proxy on (orange cloud), set SSL/TLS to **Full**, not Full
   (Strict), or you'll get redirect loops.
6. **Wait for SSL.** Railway issues a Let's Encrypt certificate once DNS resolves, usually within
   an hour (DNS itself can take longer to propagate).
7. **Publish** the site in the editor (it must pass publish validation), then click
   **Check domain**. "Live on its domain" means DNS points at Railway, HTTPS answers as the site
   server, and the site is published.

Check from a terminal too:

```sh
curl -sI https://www.summitlandscaper.com/          # 200
curl -s  https://www.summitlandscaper.com/robots.txt  # Allow + Sitemap
curl -s  https://www.summitlandscaper.com/sitemap.xml
curl -sI https://<public-host>/s/<slug>              # 301 → https://www.summitlandscaper.com/
```

## Move an existing site without downtime (e.g. summitlandscaper.com)

The domain already serves the client's old site. The goal is to swap where DNS points with the
new site fully ready, and with caches short enough that the swap takes minutes.

1. **A day ahead: lower the TTL.** At the DNS provider, set the TTL of the records you'll change
   (`www`, and the bare domain) to 300 seconds. Wait out the *old* TTL (often 1–24 hours)
   before step 5, or resolvers keep the old answer that long.
2. **Build and check the new site.** Generate it, fill in the content, photos, notification
   email and real reviews, and check it in the editor preview.
3. **Publish it, still without a domain,** and verify at `https://<public-host>/s/<slug>`: the
   page, the quote form (send yourself a test request) and the owner email.
4. **Prepare the domain without touching traffic.** Set the domain in the editor (Use www), add
   `www.summitlandscaper.com` in Railway, and create **only the TXT record** for now. The TXT
   record doesn't change where visitors go. From here `/s/<slug>` redirects to the domain, which
   still shows the old site; that's fine.
5. **Switch DNS** at a quiet time: point the `www` CNAME at the Railway target, and set the bare
   domain forwarding (step 4 above). Visitors move over as caches expire (≤ 5 minutes with the
   lowered TTL).
6. **Watch the certificate.** Railway can only issue it once the domain resolves to it, so expect
   a short window (usually minutes, at most about an hour) where HTTPS isn't ready yet. If the
   domain is on Cloudflare with the proxy on, Cloudflare's edge certificate covers that window.
   Use **Check domain** until it says "Live on its domain".
7. **Afterwards:** put the TTL back up (e.g. 3600), and turn off the old host once you're sure
   nothing still points at it.

To roll back, point the DNS records back at the old host; with the lowered TTL that takes effect
within minutes.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| 404 "Not found." from the domain | Site isn't published yet, or the domain saved in the editor doesn't match the host (check www). |
| Railway's own 404 page | The TXT verification record is missing or wrong. |
| Certificate error | Let's Encrypt hasn't issued yet (wait up to an hour), or Cloudflare SSL is set to Full (Strict). |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL/TLS is "Flexible"; set it to Full. |
| "Check domain" says it resolves elsewhere | The CNAME still points at the old host, or DNS hasn't propagated. |
