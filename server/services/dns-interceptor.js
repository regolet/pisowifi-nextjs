const dgram = require('dgram');
const dns = require('dns');
const { promisify } = require('util');

class DNSInterceptor {
  constructor(config = {}) {
    this.config = {
      port: config.port || 53,
      portalIP: config.portalIP || '192.168.100.1',
      upstreamDNS: config.upstreamDNS || '8.8.8.8',
      allowedDomains: config.allowedDomains || [],
      ...config
    };
    
    this.server = null;
    this.authenticatedClients = new Set();
  }
  
  async start() {
    this.server = dgram.createSocket('udp4');
    
    this.server.on('message', async (msg, rinfo) => {
      try {
        await this.handleDNSQuery(msg, rinfo);
      } catch (error) {
        console.error('[DNS] Error handling query:', error);
      }
    });
    
    this.server.on('error', (err) => {
      console.error('[DNS] Server error:', err);
      this.server.close();
    });
    
    this.server.on('listening', () => {
      const address = this.server.address();
      console.log(`[DNS] Interceptor listening on ${address.address}:${address.port}`);
    });
    
    // Bind to DNS port
    this.server.bind(this.config.port);
  }
  
  async handleDNSQuery(msg, rinfo) {
    const request = this.parseDNSRequest(msg);
    
    if (!request) {
      return;
    }
    
    console.log(`[DNS] Query from ${rinfo.address}: ${request.domain}`);
    
    // Check if client is authenticated
    const isAuthenticated = await this.isClientAuthenticated(rinfo.address);
    
    if (isAuthenticated || this.isAllowedDomain(request.domain)) {
      // Forward to real DNS server
      await this.forwardDNSQuery(msg, rinfo);
    } else {
      // Return portal IP for all queries from unauthenticated clients
      const response = this.createDNSResponse(request, this.config.portalIP);
      this.server.send(response, rinfo.port, rinfo.address);
      console.log(`[DNS] Redirected ${request.domain} to portal for ${rinfo.address}`);
    }
  }
  
  parseDNSRequest(msg) {
    try {
      // Basic DNS query parsing
      const domain = [];
      let offset = 12; // Skip DNS header
      
      // Parse domain name
      while (msg[offset] !== 0) {
        const len = msg[offset];
        offset++;
        
        if (len > 0) {
          domain.push(msg.toString('utf8', offset, offset + len));
          offset += len;
        }
      }
      
      return {
        id: msg.readUInt16BE(0),
        domain: domain.join('.'),
        raw: msg
      };
    } catch (error) {
      console.error('[DNS] Failed to parse request:', error);
      return null;
    }
  }
  
  createDNSResponse(request, ip) {
    const response = Buffer.alloc(512);
    let offset = 0;
    
    // Copy request ID
    request.raw.copy(response, 0, 0, 2);
    offset = 2;
    
    // Set response flags (standard query response, no error)
    response.writeUInt16BE(0x8180, offset);
    offset += 2;
    
    // Questions: 1, Answers: 1, Authority: 0, Additional: 0
    response.writeUInt16BE(1, offset); offset += 2;
    response.writeUInt16BE(1, offset); offset += 2;
    response.writeUInt16BE(0, offset); offset += 2;
    response.writeUInt16BE(0, offset); offset += 2;
    
    // Copy question section
    let questionEnd = 12;
    while (request.raw[questionEnd] !== 0) {
      questionEnd++;
    }
    questionEnd += 5; // Include null terminator and type/class
    
    request.raw.copy(response, offset, 12, questionEnd);
    offset = questionEnd;
    
    // Answer section
    // Name pointer to question
    response.writeUInt16BE(0xC00C, offset); offset += 2;
    
    // Type A (1), Class IN (1)
    response.writeUInt16BE(1, offset); offset += 2;
    response.writeUInt16BE(1, offset); offset += 2;
    
    // TTL: 60 seconds
    response.writeUInt32BE(60, offset); offset += 4;
    
    // Data length: 4 bytes (IPv4)
    response.writeUInt16BE(4, offset); offset += 2;
    
    // IP address
    const ipParts = ip.split('.');
    for (const part of ipParts) {
      response.writeUInt8(parseInt(part), offset++);
    }
    
    return response.slice(0, offset);
  }
  
  async forwardDNSQuery(msg, rinfo) {
    const client = dgram.createSocket('udp4');
    
    client.send(msg, 53, this.config.upstreamDNS, (err) => {
      if (err) {
        console.error('[DNS] Failed to forward query:', err);
        client.close();
      }
    });
    
    client.on('message', (response) => {
      this.server.send(response, rinfo.port, rinfo.address);
      client.close();
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      client.close();
    }, 5000);
  }
  
  async isClientAuthenticated(ip) {
    try {
      // Check database for authenticated client
      const db = require('../db/sqlite-adapter');
      const result = await db.query(
        'SELECT * FROM clients WHERE ip_address = $1 AND status = $2 AND time_remaining > 0',
        [ip, 'CONNECTED']
      );
      
      return result.rows.length > 0;
    } catch (error) {
      console.error('[DNS] Auth check error:', error);
      return false;
    }
  }
  
  isAllowedDomain(domain) {
    // Always allow certain domains
    const alwaysAllow = [
      'localhost',
      'pisowifi.local',
      '192.168.100.1'
    ];
    
    return alwaysAllow.some(allowed => domain.includes(allowed)) ||
           this.config.allowedDomains.some(allowed => domain.includes(allowed));
  }
  
  addAuthenticatedClient(ip) {
    this.authenticatedClients.add(ip);
  }
  
  removeAuthenticatedClient(ip) {
    this.authenticatedClients.delete(ip);
  }
  
  stop() {
    if (this.server) {
      this.server.close();
      console.log('[DNS] Interceptor stopped');
    }
  }
}

module.exports = DNSInterceptor;