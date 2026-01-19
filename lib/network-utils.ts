import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface ClientInfo {
  macAddress: string
  ipAddress: string
  hostname?: string
}

/**
 * Validate IPv4 address format to prevent command injection
 */
function isValidIPv4(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
  return ipv4Regex.test(ip.trim())
}

/**
 * Get client MAC address from IP address using ARP table
 */
export async function getClientMacFromIP(ipAddress: string): Promise<string | null> {
  try {
    // SECURITY: Validate IP address to prevent command injection
    if (!isValidIPv4(ipAddress)) {
      console.error('Invalid IP address format:', ipAddress?.substring(0, 20))
      return null
    }
    
    const sanitizedIP = ipAddress.trim()
    
    // Try to get MAC from ARP table
    const { stdout } = await execAsync(`arp -n ${sanitizedIP}`)
    const arpMatch = stdout.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/)
    
    if (arpMatch) {
      return arpMatch[0].toLowerCase().replace(/:/g, '-')
    }

    // If ARP fails, try ping then check again
    await execAsync(`ping -c 1 ${sanitizedIP}`).catch(() => {})
    
    const { stdout: stdout2 } = await execAsync(`arp -n ${sanitizedIP}`)
    const arpMatch2 = stdout2.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/)
    
    if (arpMatch2) {
      return arpMatch2[0].toLowerCase().replace(/:/g, '-')
    }

    return null
  } catch (error) {
    console.error('Error getting MAC address:', error)
    return null
  }
}

/**
 * Get all connected clients on the hotspot network
 */
export async function getConnectedClients(): Promise<ClientInfo[]> {
  try {
    const clients: ClientInfo[] = []
    
    // Get DHCP leases from dnsmasq
    try {
      const { stdout } = await execAsync('cat /var/lib/dhcp/dhcpd.leases 2>/dev/null || cat /var/lib/dhcpcd5/dhcpcd.leases 2>/dev/null || echo ""')
      
      const leaseBlocks = stdout.split('\n\n').filter(block => block.trim())
      
      for (const block of leaseBlocks) {
        const ipMatch = block.match(/lease\s+([\d.]+)\s*{/)
        const macMatch = block.match(/hardware ethernet\s+([0-9a-fA-F:]+);/)
        const hostnameMatch = block.match(/client-hostname\s+"([^"]+)";/)
        
        if (ipMatch && macMatch) {
          clients.push({
            ipAddress: ipMatch[1],
            macAddress: macMatch[1].toLowerCase().replace(/:/g, '-'),
            hostname: hostnameMatch ? hostnameMatch[1] : undefined
          })
        }
      }
    } catch (dhcpError) {
      console.warn('Could not read DHCP leases:', dhcpError)
    }

    // Also check ARP table for additional clients
    try {
      const { stdout } = await execAsync('arp -a')
      const arpLines = stdout.split('\n').filter(line => line.includes('192.168.100.'))
      
      for (const line of arpLines) {
        const match = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-fA-F:]+)/)
        if (match) {
          const [, ip, mac] = match
          const normalizedMac = mac.toLowerCase().replace(/:/g, '-')
          
          // Only add if not already in clients list
          if (!clients.some(c => c.macAddress === normalizedMac)) {
            clients.push({
              ipAddress: ip,
              macAddress: normalizedMac
            })
          }
        }
      }
    } catch (arpError) {
      console.warn('Could not read ARP table:', arpError)
    }

    return clients
  } catch (error) {
    console.error('Error getting connected clients:', error)
    return []
  }
}

/**
 * Get client real IP address from request headers (handle reverse proxy)
 */
export function getClientIP(request: any): string {
  // Try to get real IP from headers (if behind reverse proxy)
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const remoteAddr = request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') ||
                    request.ip ||
                    request.connection?.remoteAddress ||
                    '192.168.100.2'

  // Clean up the IP address
  let clientIP = forwarded ? forwarded.split(',')[0] : (realIP || remoteAddr)
  
  // Remove IPv6 prefix if present
  if (clientIP.startsWith('::ffff:')) {
    clientIP = clientIP.substring(7)
  }
  
  return clientIP.trim()
}

/**
 * Check if client is on the hotspot network
 */
export function isHotspotClient(ipAddress: string): boolean {
  return ipAddress.startsWith('192.168.100.') && 
         ipAddress !== '192.168.100.1' // Exclude gateway
}

/**
 * Generate a random MAC address (for testing)
 */
export function generateMockMacAddress(): string {
  const hexDigits = '0123456789abcdef'
  let mac = ''
  
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += '-'
    mac += hexDigits[Math.floor(Math.random() * 16)]
    mac += hexDigits[Math.floor(Math.random() * 16)]
  }
  
  return mac
}