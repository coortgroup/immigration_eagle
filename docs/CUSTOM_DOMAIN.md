# Connect fillout.net

Configured website: **https://fillout.net/**

Configured browser app: **https://fillout.net/app/**

The custom domain **fillout.net** is saved in the repository's GitHub Pages settings. DNS and HTTPS verification are pending, so these addresses are not yet confirmed live. A fresh deployment must build the app with the custom domain's root base path. The previous GitHub address is https://coortgroup.github.io/immigration_eagle/; GitHub may redirect it after the domain change.

## GitHub Pages

The domain setting has been completed. To review it and finish deployment:

1. Open [repository Pages settings](https://github.com/coortgroup/immigration_eagle/settings/pages).
2. Keep **Source: GitHub Actions**.
3. Confirm **Custom domain** is **fillout.net**. Do not include `https://`, `www`, or a path.
4. Run **Deploy FILLOUT IMMIGRATION FORMS to GitHub Pages** from [Actions](https://github.com/coortgroup/immigration_eagle/actions/workflows/pages.yml). Changing the domain does not rebuild the existing artifact automatically; rerun the entire workflow so it builds with the new base path.

The workflow reads `actions/configure-pages`'s `base_path` output before exporting Expo. A custom root domain produces an empty path; the default project URL produces `/immigration_eagle`. The landing page uses relative links and the Expo app is always under `app/`. A `CNAME` file does not configure a custom domain for this GitHub Actions publishing workflow.

## DNS

At the DNS provider, replace conflicting parking/forwarding records for `@` and `www` with the following records. Preserve unrelated mail, verification and other subdomain records.

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | coortgroup.github.io |

The `www` target must not include `/immigration_eagle`. Existing apex IPv6 records must not point to another host. If IPv6 is wanted, GitHub's documented values are `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, and `2606:50c0:8003::153`.

At inspection on October 9, 2026, the nameservers were `dns1.registrar-servers.com` and `dns2.registrar-servers.com`; the apex resolved to `192.64.119.114` and `www` to `parkingpage.namecheap.com`. These identify Namecheap DNS/parking, not ownership. Recheck before changing records. In Namecheap, host records are under **Domain List → Manage → Advanced DNS**.

## Verify the switch

1. Confirm the workflow completes successfully after the custom domain was saved.
2. Confirm DNS resolves to GitHub Pages and its Pages settings report a successful DNS check.
3. When GitHub finishes provisioning the certificate, enable **Enforce HTTPS**. DNS changes and certificate availability can take up to 24 hours.
4. Open `https://fillout.net/` and `https://fillout.net/app/?form=I-129F`. Confirm the website, app, images and form choice screen load, then confirm `https://www.fillout.net/` redirects to the apex domain.
5. Update the repository **About → Website** to `https://fillout.net/` after the custom domain works. `package.json`'s `homepage`, `app.config.ts`'s `extra.website`, and the README addresses already use the configured domain; remove the pending-verification notes only after completing the checks above.

The published Expo Go preview and Expo project identity are independent of website DNS. Changing the website domain does not require renaming the Expo project.

## Verify root routing locally

```sh
PAGES_BASE_PATH='' npm run build
PAGES_BASE_PATH='' npm run preview:site
```

Open `http://127.0.0.1:4176/` and `http://127.0.0.1:4176/app/`. To restore the default project-path build, run `npm run build` and `npm run preview:site` without `PAGES_BASE_PATH`.

Source: [GitHub: Managing a custom domain for your GitHub Pages site](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
