/**
 * Security middleware for PISOWifi
 * Rate limiting, authentication, and security utilities
 */

const jwt = require('jsonwebtoken');

/**
 * Get JWT secret - throws error if not set in production
 * @returns {string} JWT secret
 */
function getJWTSecret() {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable is required in production');
    }
    console.warn('⚠️  WARNING: JWT_SECRET not set. Using insecure default. Set JWT_SECRET in production!');
    return 'dev-only-insecure-secret-change-me';
  }
  
  if (secret.length < 32) {
    console.warn('⚠️  WARNING: JWT_SECRET should be at least 32 characters for security');
  }
  
  return secret;
}

/**
 * JWT Authentication middleware for API routes
 */
function authenticateAPI(req, res, next) {
  const token = req.cookies['auth-token'] || 
                (req.headers['authorization'] ? req.headers['authorization'].split(' ')[1] : null);
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const secret = getJWTSecret();
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/**
 * JWT Authentication middleware for admin pages (redirects to login)
 */
function authenticateAdmin(req, res, next) {
  const token = req.cookies['auth-token'];
  
  if (!token) {
    return res.redirect('/admin/login');
  }
  
  try {
    const secret = getJWTSecret();
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    res.clearCookie('auth-token');
    return res.redirect('/admin/login');
  }
}

/**
 * Optional authentication - attaches user if token valid, continues if not
 */
function optionalAuth(req, res, next) {
  const token = req.cookies['auth-token'] || 
                (req.headers['authorization'] ? req.headers['authorization'].split(' ')[1] : null);
  
  if (token) {
    try {
      const secret = getJWTSecret();
      req.user = jwt.verify(token, secret);
    } catch (err) {
      // Token invalid, but continue without user
    }
  }
  next();
}

/**
 * Role-based authorization middleware
 * @param {string[]} allowedRoles - Array of allowed roles
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

/**
 * Simple in-memory rate limiter
 * For production, consider using redis-based limiter
 */
class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 1 minute default
    this.maxRequests = options.max || 100;
    this.message = options.message || 'Too many requests, please try again later';
    this.requests = new Map();
    
    // Cleanup old entries every minute
    setInterval(() => this.cleanup(), 60 * 1000);
  }
  
  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.requests.entries()) {
      if (now - data.windowStart > this.windowMs) {
        this.requests.delete(key);
      }
    }
  }
  
  getKey(req) {
    // Use IP address as key
    return req.ip || 
           req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection.remoteAddress || 
           'unknown';
  }
  
  middleware() {
    return (req, res, next) => {
      const key = this.getKey(req);
      const now = Date.now();
      
      let data = this.requests.get(key);
      
      if (!data || now - data.windowStart > this.windowMs) {
        data = { count: 0, windowStart: now };
      }
      
      data.count++;
      this.requests.set(key, data);
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, this.maxRequests - data.count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((data.windowStart + this.windowMs) / 1000));
      
      if (data.count > this.maxRequests) {
        return res.status(429).json({ 
          error: this.message,
          retryAfter: Math.ceil((data.windowStart + this.windowMs - now) / 1000)
        });
      }
      
      next();
    };
  }
}

// Pre-configured rate limiters
const loginLimiter = new RateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again in 15 minutes'
});

const apiLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please slow down'
});

const coinInsertLimiter = new RateLimiter({
  windowMs: 1000, // 1 second
  max: 5, // Max 5 coin inserts per second (prevent abuse)
  message: 'Coin insertion rate limit exceeded'
});

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
}

/**
 * Error handler that doesn't leak sensitive info
 */
function secureErrorHandler(err, req, res, next) {
  console.error('Error:', err.message);
  
  // Don't expose stack traces in production
  const isDev = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
    ...(isDev && { stack: err.stack })
  });
}

/**
 * Secure cookie options
 */
function getSecureCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    httpOnly: true,
    secure: isProduction, // Only send over HTTPS in production
    sameSite: 'strict', // Prevent CSRF
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  };
}

/**
 * Generate secure auth cookie options for admin
 */
function getAdminCookieOptions() {
  return {
    ...getSecureCookieOptions(),
    path: '/admin' // Restrict to admin paths
  };
}

module.exports = {
  getJWTSecret,
  authenticateAPI,
  authenticateAdmin,
  optionalAuth,
  requireRole,
  RateLimiter,
  loginLimiter,
  apiLimiter,
  coinInsertLimiter,
  securityHeaders,
  secureErrorHandler,
  getSecureCookieOptions,
  getAdminCookieOptions
};
