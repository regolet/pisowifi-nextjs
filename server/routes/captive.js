const express = require('express');
const router = express.Router();

// Captive portal detection endpoints
// These URLs are requested by devices to detect internet connectivity

// Store portal URL for consistency - Force HTTP only
const getPortalUrl = (req) => {
  const host = req.headers.host || 'pisowifi.local';
  // Ensure we always use HTTP, never HTTPS
  return `http://${host}/portal`;
};

// Apple devices (iOS, macOS)
router.get('/hotspot-detect.html', (req, res) => {
  console.log(`[CAPTIVE] Apple hotspot-detect.html requested from ${req.ip} (${req.headers.host})`);
  // Apple expects an HTML response with "Success" for open networks
  // Or a redirect for captive portals
  const portalUrl = getPortalUrl(req);
  console.log(`[CAPTIVE] Redirecting to: ${portalUrl}`);
  res.status(302);
  res.set('Location', portalUrl);
  res.send(`<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>`);
});

router.get('/library/test/success.html', (req, res) => {
  // Newer Apple devices
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.send(`<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>`);
});

// Android devices
router.get('/generate_204', (req, res) => {
  console.log(`[CAPTIVE] Android generate_204 requested from ${req.ip} (${req.headers.host})`);
  // Android expects a 204 No Content for open networks
  // Or a redirect for captive portals
  const portalUrl = getPortalUrl(req);
  console.log(`[CAPTIVE] Redirecting to: ${portalUrl}`);
  res.status(302);
  res.set('Location', portalUrl);
  res.set('Content-Length', '0');
  res.end();
});

router.get('/gen_204', (req, res) => {
  // Older Android devices
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.set('Content-Length', '0');
  res.end();
});

// Google Chrome connectivity check
router.get('/chrome-variations/seed', (req, res) => {
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.end();
});

// Microsoft/Windows devices
router.get('/connecttest.txt', (req, res) => {
  // Windows expects "Microsoft Connect Test" for open networks
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.send('Microsoft Connect Test');
});

router.get('/ncsi.txt', (req, res) => {
  // Windows Network Connectivity Status Indicator
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.send('Microsoft NCSI');
});

router.get('/redirect', (req, res) => {
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.end();
});

// Generic connectivity checks
router.get('/connectivity-check.html', (req, res) => {
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.send('<html><head><title>Redirect</title></head><body>Redirect</body></html>');
});

// Firefox
router.get('/canonical.html', (req, res) => {
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.send('<html><head><title>Redirect</title></head><body>Redirect</body></html>');
});

router.get('/success.txt', (req, res) => {
  res.status(302);
  res.set('Location', getPortalUrl(req));
  res.send('success');
});

// Catch-all for any domain requests (when not authenticated)
router.get('/', (req, res, next) => {
  // Check if this is a captive portal check from common domains
  const host = req.headers.host || '';
  const url = req.originalUrl || req.url;
  
  console.log(`[CAPTIVE] Catch-all request: Host=${host}, URL=${url}, IP=${req.ip}`);
  
  const captiveCheckDomains = [
    'captive.apple.com',
    'connectivitycheck.gstatic.com',
    'connectivitycheck.android.com', 
    'www.gstatic.com',
    'clients3.google.com',
    'www.msftconnecttest.com',
    'www.msftncsi.com',
    'detectportal.firefox.com'
  ];
  
  const isCaptiveCheck = captiveCheckDomains.some(domain => host.includes(domain));
  console.log(`[CAPTIVE] Is captive check domain: ${isCaptiveCheck}`);
  
  if (isCaptiveCheck) {
    const portalUrl = getPortalUrl(req);
    console.log(`[CAPTIVE] Domain match - redirecting to: ${portalUrl}`);
    return res.redirect(302, portalUrl);
  }
  
  console.log(`[CAPTIVE] No domain match - passing to next handler`);
  // Pass through to next handler if not a captive check
  next();
});

module.exports = router;