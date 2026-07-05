# site-content

Source of truth for the anthonytoday.com page content served through MailerLite. Each `.html` file is a self-contained fragment (styles + markup, no `<!DOCTYPE>`/`<head>`/`<body>` wrapper) meant to be loaded into a MailerLite Custom HTML block via jsDelivr's CDN, instead of pasting raw HTML into MailerLite every time a page changes.

## Files

- `home.html` — anthonytoday.com (homepage)
- `cyber.html` — anthonytoday.com/cyber
- `tools.html` — anthonytoday.com/tools
- `notion.html` — anthonytoday.com/notion
- `.github/workflows/purge-jsdelivr.yml` — clears the jsDelivr CDN cache automatically on every push to `main`, so edits go live within seconds instead of waiting out jsDelivr's normal cache window

## How the sync works

1. Edit a page's `.html` file in this repo and push to `main`.
2. The GitHub Action fires and purges jsDelivr's cache for all four files.
3. The MailerLite page (which loads the file from jsDelivr, not from a pasted copy) picks up the new content on next page view.

## One-time setup per MailerLite page

In each page's editor, add a Custom HTML block containing the loader snippet below. The only thing that changes between pages is the filename in the `page` variable.

### Home page

```html
<div id="site-content-root">Loading…</div>
<script>
(function () {
  var page = "home.html";
  var url = "https://cdn.jsdelivr.net/gh/anthonytoday/site-content@main/" + page;
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

## Making an edit going forward

1. Pull this repo, edit the relevant `.html` file.
2. Commit and push to `main`.
3. The purge workflow runs automatically (check the Actions tab to confirm it succeeded).
4. Reload the live MailerLite page. No need to touch the MailerLite editor again unless the loader snippet itself changes.

## Notes

- `@main` in the jsDelivr URL always resolves to the latest commit on `main`; the purge workflow is what keeps the CDN edge cache from serving a stale version after you push.
- If a page ever looks stale despite a successful push and purge, hard-refresh (jsDelivr edge propagation can take up to a minute worldwide).
- Keep files as fragments (start with `<style>`, no `<!DOCTYPE>`/`<head>`/`<body>`) since MailerLite's page settings already handle title, meta description, and viewport.
