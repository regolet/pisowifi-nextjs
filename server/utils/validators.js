/**
 * Input validation utilities for security
 * Prevents command injection, SQL injection, and other attacks
 */

/**
 * Validate IPv4 address format
 * @param {string} ip - IP address to validate
 * @returns {boolean} - true if valid
 */
function isValidIPv4(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip.trim());
}

/**
 * Validate MAC address format (accepts both : and - separators)
 * @param {string} mac - MAC address to validate
 * @returns {boolean} - true if valid
 */
function isValidMacAddress(mac) {
  if (!mac || typeof mac !== 'string') return false;
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  return macRegex.test(mac.trim());
}

/**
 * Sanitize MAC address to uppercase with colons
 * @param {string} mac - MAC address to sanitize
 * @returns {string|null} - sanitized MAC or null if invalid
 */
function sanitizeMacAddress(mac) {
  if (!isValidMacAddress(mac)) return null;
  return mac.trim().toUpperCase().replace(/-/g, ':');
}

/**
 * Validate network interface name (alphanumeric with limited special chars)
 * @param {string} iface - Interface name to validate
 * @returns {boolean} - true if valid
 */
function isValidInterfaceName(iface) {
  if (!iface || typeof iface !== 'string') return false;
  // Interface names: alphanumeric, can contain hyphens, underscores, max 15 chars
  const ifaceRegex = /^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/;
  return ifaceRegex.test(iface.trim());
}

/**
 * Validate service name for systemctl commands
 * @param {string} service - Service name to validate
 * @returns {boolean} - true if valid
 */
function isValidServiceName(service) {
  if (!service || typeof service !== 'string') return false;
  // Service names: alphanumeric with hyphens, underscores, dots
  const serviceRegex = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
  return serviceRegex.test(service.trim());
}

/**
 * Whitelist of allowed services that can be controlled
 */
const ALLOWED_SERVICES = [
  'dnsmasq',
  'hostapd',
  'nginx',
  'pisowifi-dynamic',
  'pisowifi-final',
  'pisowifi'
];

/**
 * Check if service is in allowed list
 * @param {string} service - Service name
 * @returns {boolean} - true if allowed
 */
function isAllowedService(service) {
  if (!isValidServiceName(service)) return false;
  return ALLOWED_SERVICES.includes(service.trim().toLowerCase());
}

/**
 * Validate positive integer within range
 * @param {any} value - Value to validate
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @returns {boolean} - true if valid
 */
function isValidInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const num = parseInt(value, 10);
  return !isNaN(num) && num >= min && num <= max && num === Number(value);
}

/**
 * Validate duration in seconds (1 second to 24 hours)
 * @param {any} duration - Duration to validate
 * @returns {boolean} - true if valid
 */
function isValidDuration(duration) {
  return isValidInteger(duration, 1, 86400);
}

/**
 * Validate coin value (positive decimal, max 1000)
 * @param {any} value - Coin value to validate
 * @returns {boolean} - true if valid
 */
function isValidCoinValue(value) {
  const num = parseFloat(value);
  return !isNaN(num) && num > 0 && num <= 1000;
}

/**
 * Validate username (alphanumeric with underscores, 3-50 chars)
 * @param {string} username - Username to validate
 * @returns {boolean} - true if valid
 */
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{2,49}$/;
  return usernameRegex.test(username.trim());
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - true if valid
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim()) && email.length <= 254;
}

/**
 * Validate slot number (1-10)
 * @param {any} slot - Slot number to validate
 * @returns {boolean} - true if valid
 */
function isValidSlotNumber(slot) {
  return isValidInteger(slot, 1, 10);
}

/**
 * Sanitize string for safe logging (remove control characters)
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeForLogging(str) {
  if (!str || typeof str !== 'string') return '';
  // Remove control characters and limit length
  return str.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 200);
}

/**
 * Escape shell argument to prevent injection
 * Only use as last resort - prefer validation
 * @param {string} arg - Argument to escape
 * @returns {string} - Escaped argument
 */
function escapeShellArg(arg) {
  if (!arg || typeof arg !== 'string') return "''";
  // Replace single quotes and wrap in single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Validate and sanitize client request data
 * @param {Object} data - Request body data
 * @returns {Object} - { valid: boolean, errors: string[], sanitized: Object }
 */
function validateClientData(data) {
  const errors = [];
  const sanitized = {};

  if (data.mac_address !== undefined) {
    if (!isValidMacAddress(data.mac_address)) {
      errors.push('Invalid MAC address format');
    } else {
      sanitized.mac_address = sanitizeMacAddress(data.mac_address);
    }
  }

  if (data.ip_address !== undefined) {
    if (!isValidIPv4(data.ip_address)) {
      errors.push('Invalid IP address format');
    } else {
      sanitized.ip_address = data.ip_address.trim();
    }
  }

  if (data.duration !== undefined) {
    if (!isValidDuration(data.duration)) {
      errors.push('Invalid duration (must be 1-86400 seconds)');
    } else {
      sanitized.duration = parseInt(data.duration, 10);
    }
  }

  if (data.coin_value !== undefined) {
    if (!isValidCoinValue(data.coin_value)) {
      errors.push('Invalid coin value');
    } else {
      sanitized.coin_value = parseFloat(data.coin_value);
    }
  }

  if (data.slot_number !== undefined) {
    if (!isValidSlotNumber(data.slot_number)) {
      errors.push('Invalid slot number (must be 1-10)');
    } else {
      sanitized.slot_number = parseInt(data.slot_number, 10);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: { ...data, ...sanitized }
  };
}

module.exports = {
  isValidIPv4,
  isValidMacAddress,
  sanitizeMacAddress,
  isValidInterfaceName,
  isValidServiceName,
  isAllowedService,
  isValidInteger,
  isValidDuration,
  isValidCoinValue,
  isValidUsername,
  isValidEmail,
  isValidSlotNumber,
  sanitizeForLogging,
  escapeShellArg,
  validateClientData,
  ALLOWED_SERVICES
};
