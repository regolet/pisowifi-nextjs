import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const prisma = new PrismaClient()

export async function POST(request: NextRequest) {
  try {
    const { macAddress } = await request.json()

    if (!macAddress) {
      return NextResponse.json(
        { error: 'MAC address is required' },
        { status: 400 }
      )
    }

    // Find client
    const client = await prisma.client.findUnique({
      where: { macAddress }
    })

    if (!client) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      )
    }

    // Update client status
    await prisma.client.update({
      where: { macAddress },
      data: {
        status: 'DISCONNECTED',
        sessionEnd: new Date(),
        lastSeen: new Date()
      }
    })

    // Close active sessions
    await prisma.session.updateMany({
      where: {
        macAddress,
        status: 'ACTIVE'
      },
      data: {
        status: 'TERMINATED',
        endTime: new Date(),
        disconnectReason: 'Manual disconnect'
      }
    })

    // Block client in iptables
    try {
      await execAsync(`pisowifi-block-client ${macAddress}`)
      
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Client disconnected: ${macAddress}`,
          category: 'network'
        }
      })
      
    } catch (iptablesError) {
      console.error('Failed to configure iptables:', iptablesError)
      
      await prisma.systemLog.create({
        data: {
          level: 'ERROR',
          message: `Failed to disconnect client in iptables: ${macAddress}`,
          category: 'network',
          metadata: JSON.stringify({ error: iptablesError })
        }
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Client disconnected successfully'
    })

  } catch (error) {
    console.error('Client disconnect error:', error)
    
    await prisma.systemLog.create({
      data: {
        level: 'ERROR',
        message: `Client disconnect failed: ${error}`,
        category: 'network'
      }
    })

    return NextResponse.json(
      { error: 'Disconnect failed' },
      { status: 500 }
    )
  }
}