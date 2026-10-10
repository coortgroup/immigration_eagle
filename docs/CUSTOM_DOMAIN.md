# Connect fillout.net

Configured website: **https://fillout.net/**

Configured browser app: **https://fillout.net/app/**

The custom domain **fillout.net** is saved in the repository's GitHub Pages settings, and GitHub reports **DNS check successful**. [Deployment 38020674959](https://github.com/coortgroup/immigration_eagle/actions/runs/38020674959) for commit `3edbcaa` succeeded after the domain switch. HTTPS certificate provisioning and the final live-site check are pending. The previous GitHub address, https://coortgroup.github.io/immigration_eagle/, now redirects to the custom domain.

Using current public DNS (`1.1.1.1`), HTTP checks returned 200 for both `/` and `/app/`, with the FILLOUT page titles and an app bundle under `/app/_expo/static/js/web/`. This Mac's default resolver still returned the former parking IP during the last check. GitHub accepted a certificate provisioning restart and now reports **Certificate Requested: Detected a change to DNS settings. Requesting a new certificate.** Strict HTTPS checks do not yet validate a certificate for this domain; no certificate validation was bypassed. Enable **Enforce HTTPS** and verify the three HTTPS addresses below once issuance completes.

## GitHub Pages

The domain setting has been completed. To review it and finish deployment:

1. Open [repository Pages settings](https://github.com/coortgroup/immigration_eagle/settings/pages).
2. Keep **Source: GitHub Actions**.
3. Confirm **Custom domain** is **fillout.net**. Do not include `https://`, `www`, or a path.
4. Run **Deploy FILLOUT IMMIGRATION FORMS to GitHub Pages** from [Actions](https://github.com/coortgroup/immigration_eagle/actions/workflows/pages.yml). Changing the domain does not rebuild the existing artifact automatically; rerun the entire workflow so it builds with the new base path.

The workflow reads `actions/configure-pages`'s `base_path` output before exporting Expo. A custom root domain produces an empty path; the default project URL produces `/immigration_eagle`. The landing page uses relative links and the Expo app is always under `app/`. A `CNAME` file does not configure a custom domain for this GitHub Actions publishing workflow.

## DNS

Namecheap's parking/forwarding records for `@` and `www` have been replaced with these records. Unrelated mail and verification records were preserved.

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | coortgroup.github.io |

The `www` target must not include `/immigration_eagle`. Existing apex IPv6 records must not point to another host. If IPv6 is wanted, GitHub's documented values are `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, and `2606:50c0:8003::153`.

On October 9, 2026, both authoritative nameservers (`dns1.registrar-servers.com` and `dns2.registrar-servers.com`) and the public resolvers `1.1.1.1` and `8.8.8.8` returned all four GitHub A records and the correct `www` CNAME. No apex AAAA records were present. Some local DNS caches still returned the former Namecheap parking destination during verification. In Namecheap, host records are under **Domain List → Manage → Advanced DNS**.

## Verify the switch

1. Confirm the workflow completes successfully after the custom domain was saved.
2. Confirm DNS resolves to GitHub Pages and its Pages settings report a successful DNS check.
3. When GitHub finishes provisioning the certificate, enable **Enforce HTTPS**. DNS changes and certificate availability can take up to 24 hours.
4. Open `https://fillout.net/` and `https://fillout.net/app/?form=I-129F`. Confirm the website, app, images and form choice screen load, then confirm `https://www.fillout.net/` redirects to the apex domain.
5. The repository **About → Website**, `package.json`'s `homepage`, `app.config.ts`'s `extra.website`, and README addresses already use `https://fillout.net/`. Remove the pending-verification notes only after completing the checks above.

The published Expo Go preview and Expo project identity are independent of website DNS. Changing the website domain does not require renaming the Expo project.

## Verify root routing locally

```sh
PAGES_BASE_PATH='' npm run build
PAGES_BASE_PATH='' npm run preview:site
```

Open `http://127.0.0.1:4176/` and `http://127.0.0.1:4176/app/`. To restore the default project-path build, run `npm run build` and `npm run preview:site` without `PAGES_BASE_PATH`.

Source: [GitHub: Managing a custom domain for your GitHub Pages site](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
