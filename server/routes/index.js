const express = require('express');
const router = express.Router();

// Homepage
router.get('/', (req, res) => {
  res.render('home', { 
    title: 'PISOWifi System',
    message: 'Welcome to PISOWifi - Coin Operated Internet'
  });
});

module.exports = router;