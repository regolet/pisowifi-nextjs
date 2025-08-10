import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const { macAddress, ipAddress, sessionDuration } = await request.json()

    if (!macAddress) {
      return NextResponse.json(
        { error: 'MAC address is required' },
        { status: 400 }
      )
    }

    // Find or create client
    let client = await prisma.client.findUnique({
      where: { macAddress }
    })

    if (!client) {
      client = await prisma.client.create({
        data: {
          macAddress,
          ipAddress,
          status: 'CONNECTED',
          timeRemaining: sessionDuration || 1800, // 30 minutes default
        }
      })
    } else {
      // Update existing client
      client = await prisma.client.update({
        where: { macAddress },
        data: {
          ipAddress,
          status: 'CONNECTED',
          timeRemaining: sessionDuration || client.timeRemaining,
          sessionStart: new Date(),
          lastSeen: new Date()
        }
      })
    }

    // Create new session
    const session = await prisma.session.create({
      data: {
        clientId: client.id,
        macAddress,
        ipAddress: ipAddress || '',
        duration: sessionDuration || 1800,
        status: 'ACTIVE'
      }
    })

    // Allow client through iptables
    try {
      await execAsync(`pisowifi-allow-client ${macAddress}`)
      
      // Log successful authentication
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Client authenticated: ${macAddress}`,
          category: 'network',
          metadata: JSON.stringify({ ipAddress, sessionId: session.id })
        }
      })
      
    } catch (iptablesError) {
      console.error('Failed to configure iptables:', iptablesError)
      
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          message: `Failed to authenticate client in iptables: ${macAddress}`,
          category: 'network',
          metadata: JSON.stringify({ error: iptablesError })
        }
      })
    }

    return NextResponse.json({
      success: true,
      client: {
        id: client.id,
        macAddress: client.macAddress,
        status: client.status,
        timeRemaining: client.timeRemaining,
        sessionId: session.id
      }
    })

  } catch (error) {
    console.error('Client authentication error:', error)
    
    await prisma.systemLog.create({
      data: {
        level: 'ERROR',
        message: `Client authentication failed: ${error}`,
        category: 'network'
      }
    })

    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    )
  }
}