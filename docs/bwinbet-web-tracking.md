# Bwinbet Web Tracking (bwinbetug.info)

Use this snippet on `bwinbetug.info` to send:
- `visit` events (people visiting)
- `interaction` events (engagement on page)
- `redirect_click` events (clicks to `bwinbetug.com`)

```html
<script>
(() => {
  const API_URL = 'https://api.dott-media.com/api/stats/webTrack'; // replace if needed
  const OWNER_EMAIL = 'bwinbetug25@gmail.com'; // preferred (no manual scope needed)
  const SCOPE_ID = ''; // optional override if you have a known analytics scope ID
  const TRACKING_KEY = ''; // optional: set if WEB_TRACK_SHARED_SECRET is enabled

  const headers = { 'Content-Type': 'application/json' };
  if (TRACKING_KEY) headers['x-web-track-key'] = TRACKING_KEY;

  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get('utm_source') || undefined;
  const referrer = document.referrer || undefined;

  const send = async (event, extra = {}) => {
    try {
      await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event,
          ownerEmail: OWNER_EMAIL,
          scopeId: SCOPE_ID || undefined,
          source: utmSource,
          utmSource,
          referrer,
          ...extra,
        }),
      });
    } catch (_) {}
  };

  const visitKey = `dott_visit_${new Date().toISOString().slice(0, 10)}`;
  if (!sessionStorage.getItem(visitKey)) {
    sessionStorage.setItem(visitKey, '1');
    send('visit', { pageUrl: window.location.href });
  }

  let interacted = false;
  const markInteraction = () => {
    if (interacted) return;
    interacted = true;
    send('interaction', { pageUrl: window.location.href });
  };

  ['click', 'scroll', 'keydown', 'touchstart'].forEach(type => {
    window.addEventListener(type, markInteraction, { passive: true, once: true });
  });

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('a,button') : null;
    if (!target) return;

    let targetUrl = '';
    if (target instanceof HTMLAnchorElement) {
      targetUrl = target.href || '';
    } else {
      targetUrl = target.getAttribute('data-href') || '';
    }

    if (!targetUrl) return;
    if (/(\.|^)bwinbetug\.com(\/|$)/i.test(targetUrl)) {
      send('redirect_click', {
        pageUrl: window.location.href,
        targetUrl,
      });
    }
  });
})();
</script>
```
