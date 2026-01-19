const db = require('../db/sqlite-adapter');

/**
 * Coin Abuse Protection Middleware
 * Tracks coin insertion attempts and blocks abusive clients
 */

// In-memory cache for quick lookups (avoids DB hits on every request)
const blockCache = new Map();
const attemptCache = new Map();

// Clean up old cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  
  // Clean block cache
  for (const [key, blockedUntil] of blockCache.entries()) {
    if (now > blockedUntil) {
      blockCache.delete(key);
    }
  }
  
  // Clean attempt cache
  for (const [key, attempts] of attemptCache.entries()) {
    const validAttempts = attempts.filter(time => now - time < 120000); // Keep last 2 minutes
    if (validAttempts.length === 0) {
      attemptCache.delete(key);
    } else {
      attemptCache.set(key, validAttempts);
    }
  }
}, 300000); // 5 minutes

/**
 * Check if client is currently blocked
 */
async function isClientBlocked(clientIP, clientMAC) {
  const cacheKey = clientMAC || clientIP;
  
  // Check in-memory cache first
  const cachedBlock = blockCache.get(cacheKey);
  if (cachedBlock && Date.now() < cachedBlock) {
    return { blocked: true, until: new Date(cachedBlock) };
  }
  
  // Check database for active blocks
  try {
    const result = await db.query(`
      SELECT blocked_until 
      FROM coin_attempts 
      WHERE (client_ip = $1 OR client_mac = $2)
        AND blocked_until > datetime('now')
      ORDER BY blocked_until DESC
      LIMIT 1
    `, [clientIP, clientMAC || clientIP]);
    
    if (result.rows.length > 0) {
      const blockedUntil = new Date(result.rows[0].blocked_until);
      blockCache.set(cacheKey, blockedUntil.getTime());
      return { blocked: true, until: blockedUntil };
    }
  } catch (error) {
    console.error('Error checking block status:', error);
  }
  
  return { blocked: false };
}

/**
 * Track coin insertion attempt
 */
async function trackAttempt(clientIP, clientMAC, sessionToken) {
  const cacheKey = clientMAC || clientIP;
  const now = Date.now();
  
  // Get or initialize attempt history
  let attempts = attemptCache.get(cacheKey) || [];
  attempts.push(now);
  attemptCache.set(cacheKey, attempts);
  
  // Log attempt to database (for historical tracking)
  try {
    await db.query(`
      INSERT INTO coin_attempts (client_ip, client_mac, session_token, attempt_type, created_at)
      VALUES ($1, $2, $3, 'insert', CURRENT_TIMESTAMP)
    `, [clientIP, clientMAC, sessionToken]);
  } catch (error) {
    console.warn('Failed to log coin attempt:', error.message);
  }
}

/**
 * Check if client exceeded rate limit and should be blocked
 */
async function checkRateLimit(clientIP, clientMAC, sessionToken) {
  // Get protection settings
  let settings;
  try {
    const result = await db.query('SELECT * FROM portal_settings WHERE id = 1');
    settings = result.rows[0] || {
      coin_abuse_protection: 1,
      coin_attempt_limit: 10,
      coin_attempt_window: 60,
      coin_block_duration: 300
    };
  } catch (error) {
    console.error('Failed to get settings:', error);
    // Use defaults if DB error
    settings = {
      coin_abuse_protection: 1,
      coin_attempt_limit: 10,
      coin_attempt_window: 60,
      coin_block_duration: 300
    };
  }
  
  // If protection is disabled, allow all
  if (!settings.coin_abuse_protection) {
    return { allowed: true };
  }
  
  // Check if already blocked
  const blockStatus = await isClientBlocked(clientIP, clientMAC);
  if (blockStatus.blocked) {
    const remainingSeconds = Math.ceil((blockStatus.until - Date.now()) / 1000);
    return {
      allowed: false,
      reason: 'rate_limit_exceeded',
      message: `Too many coin insertion attempts. Please wait ${remainingSeconds} seconds.`,
      blockedUntil: blockStatus.until
    };
  }
  
  // Track this attempt
  await trackAttempt(clientIP, clientMAC, sessionToken);
  
  // Count recent attempts in time window
  const cacheKey = clientMAC || clientIP;
  const attempts = attemptCache.get(cacheKey) || [];
  const windowStart = Date.now() - (settings.coin_attempt_window * 1000);
  const recentAttempts = attempts.filter(time => time > windowStart);
  
  // If exceeded limit, block the client
  if (recentAttempts.length > settings.coin_attempt_limit) {
    const blockUntil = new Date(Date.now() + (settings.coin_block_duration * 1000));
    
    // Save block to database
    try {
      await db.query(`
        INSERT INTO coin_attempts (client_ip, client_mac, session_token, attempt_type, blocked_until, created_at)
        VALUES ($1, $2, $3, 'blocked', $4, CURRENT_TIMESTAMP)
      `, [clientIP, clientMAC, sessionToken, blockUntil.toISOString()]);
    } catch (error) {
      console.warn('Failed to save block:', error.message);
    }
    
    // Cache the block
    blockCache.set(cacheKey, blockUntil.getTime());
    
    console.log(`⚠️ Blocked client ${clientMAC || clientIP} for coin abuse - ${recentAttempts.length} attempts in ${settings.coin_attempt_window}s`);
    
    return {
      allowed: false,
      reason: 'rate_limit_exceeded',
      message: `Too many coin insertion attempts. Blocked for ${settings.coin_block_duration} seconds.`,
      blockedUntil: blockUntil,
      attemptCount: recentAttempts.length
    };
  }
  
  return {
    allowed: true,
    attemptCount: recentAttempts.length,
    remaining: settings.coin_attempt_limit - recentAttempts.length
  };
}

/**
 * Express middleware for coin insertion endpoints
 */
async function coinAbuseProtection(req, res, next) {
  // Extract client identifiers
  let clientIP = req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress;
  
  // Clean IPv6-mapped IPv4 addresses
  if (clientIP && clientIP.startsWith('::ffff:')) {
    clientIP = clientIP.substring(7);
  }
  
  const clientMAC = req.body?.clientMac || req.query?.clientMac;
  const sessionToken = req.body?.sessionToken || req.query?.sessionToken;
  
  // Check rate limit
  const rateCheck = await checkRateLimit(clientIP, clientMAC, sessionToken);
  
  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: rateCheck.message,
      blockedUntil: rateCheck.blockedUntil,
      reason: rateCheck.reason
    });
  }
  
  // Attach rate limit info to request for logging
  req.rateLimitInfo = {
    attemptCount: rateCheck.attemptCount,
    remaining: rateCheck.remaining
  };
  
  next();
}

/**
 * Manually unblock a client (for admin use)
 */
async function unblockClient(clientIP, clientMAC) {
  try {
    const cacheKey = clientMAC || clientIP;
    
    // Remove from cache
    blockCache.delete(cacheKey);
    attemptCache.delete(cacheKey);
    
    // Remove from database
    await db.query(`
      DELETE FROM coin_attempts 
      WHERE (client_ip = $1 OR client_mac = $2)
        AND blocked_until > datetime('now')
    `, [clientIP, clientMAC || clientIP]);
    
    console.log(`✅ Unblocked client: ${clientMAC || clientIP}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to unblock client:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get list of currently blocked clients
 */
async function getBlockedClients() {
  try {
    const result = await db.query(`
      SELECT DISTINCT client_ip, client_mac, blocked_until, created_at
      FROM coin_attempts
      WHERE blocked_until > datetime('now')
      ORDER BY blocked_until DESC
    `);
    
    return result.rows;
  } catch (error) {
    console.error('Failed to get blocked clients:', error);
    return [];
  }
}

module.exports = {
  coinAbuseProtection,
  checkRateLimit,
  isClientBlocked,
  unblockClient,
  getBlockedClients
};
