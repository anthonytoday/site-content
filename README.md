# site-content

Source of truth for the anthonytoday.com page content served through MailerLite. Each `.html` file is a self-contained fragment (styles + markup, no `<!DOCTYPE>`/`<head>`/`<body>` wrapper) meant to be loaded into a MailerLite Custom HTML block, instead of pasting raw HTML into MailerLite every time a page changes.

## Files

- `home.html` — anthonytoday.com (homepage)
- `cyber.html` — anthonytoday.com/cyber
- `tools.html` — anthonytoday.com/tools
- `notion.html` — anthonytoday.com/notion
- `contact.html` — anthonytoday.com/contact
- `assets/logos/` — logo and icon images referenced by the pages, served via jsDelivr CDN (images change rarely, so CDN caching is fine here)

## How the sync works

1. Edit a page's `.html` file in this repo and push to `main`.
2. The MailerLite page loads that file directly from `raw.githubusercontent.com` on every page view, with a cache-busting timestamp, so it always gets the current version of `main`. No purge step, no CDN cache to fight.
3. Reload the live MailerLite page to see the change, typically instant.

We switched away from jsDelivr for the HTML fragments themselves (previously used with a purge-on-push GitHub Action) because jsDelivr's edge cache did not clear reliably fast enough between rapid pushes, causing stale content to linger. `raw.githubusercontent.com` has no comparable caching layer once a cache-busting query parameter is added, so it reflects `main` immediately.

## One-time setup per MailerLite page

In each page's editor, add a Custom HTML block containing the loader snippet below. The only thing that changes between pages is the filename in the `page` variable.

### Home page

```html
<div id="site-content-root">Loading…</div>
<script>
(function () {
  var page = "home.html";
  var url = "https://raw.githubusercontent.com/anthonytoday/site-content/main/" + page + "?t=" + Date.now();
  fetch(url, { cache: "no-store" })
    .then(function (r) { return r.text(); })
    .then(function (html) {
      document.getElementById("site-content-root").outerHTML = html;
    })
    .catch(function (err) {
      console.error("site-content load failed:", err);
    });
})();
</script>
```

### Cyber page

Same snippet, change the `page` line to:

```js
var page = "cyber.html";
```

### Tools page

```js
var page = "tools.html";
```

### Notion page

```js
var page = "notion.html";
```

### Contact page

```js
var page = "contact.html";
```

## Making an edit going forward

1. Pull this repo, edit the relevant `.html` file.
2. Commit and push to `main`.
3. Reload the live MailerLite page. Changes should appear immediately, no waiting on cache propagation.

## Notes

- Image assets in `assets/logos/` are still served via jsDelivr (`cdn.jsdelivr.net/gh/anthonytoday/site-content@main/assets/logos/...`). Since these rarely change, jsDelivr's caching is a feature, not a problem, there.
- Keep `.html` files as fragments (start with `<style>`, no `<!DOCTYPE>`/`<head>`/`<body>`) since MailerLite's page settings already handle title, meta description, and viewport.
- If a new image asset is added or an existing one is replaced with the same filename, that specific image may take longer to refresh due to jsDelivr's cache. Renaming the file (e.g. adding a version suffix) forces a fresh cache entry immediately.
