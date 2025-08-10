const express = require('express');
const router = express.Router();

// Captive portal detection endpoints
// These URLs are requested by devices to detect internet connectivity

// Apple devices
router.get('/hotspot-detect.html', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

router.get('/library/test/success.html', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

// Android devices
router.get('/generate_204', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

router.get('/gen_204', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

// Microsoft devices
router.get('/connecttest.txt', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

router.get('/ncsi.txt', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

router.get('/redirect', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

// Generic connectivity check
router.get('/connectivity-check.html', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

// Firefox
router.get('/canonical.html', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

router.get('/success.txt', (req, res) => {
  res.redirect('http://192.168.100.1:3000/portal');
});

module.exports = router;