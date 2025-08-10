import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getClientIP, getClientMacFromIP } from '@/lib/network-utils';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const { rateId, coinsUsed } = await request.json();

    if (!rateId || !coinsUsed) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get client IP address
    const clientIP = getClientIP(request);
    
    // Get MAC address from IP
    let macAddress = await getClientMacFromIP(clientIP);
    
    // If we can't get MAC address, generate a temporary one for development
    if (!macAddress) {
      // In development, use a combination of IP and timestamp
      macAddress = `dev-${clientIP.replace(/\./g, '-')}-${Date.now().toString().slice(-6)}`;
      console.log('Using development MAC address:', macAddress);
    }

    console.log(`Connecting client: IP=${clientIP}, MAC=${macAddress}`);

    // Get rate information
    const rate = await prisma.rate.findUnique({
      where: { id: rateId }
    });

    if (!rate) {
      return NextResponse.json(
        { error: 'Rate not found' },
        { status: 404 }
      );
    }

    // Check if client already exists
    let client = await prisma.client.findUnique({
      where: { macAddress }
    });

    // Create or update client
    if (!client) {
      client = await prisma.client.create({
        data: {
          macAddress,
          ipAddress: clientIP,
          status: 'CONNECTED',
          timeRemaining: rate.duration,
          totalPaid: rate.price,
          sessionStart: new Date(),
          sessionEnd: new Date(Date.now() + rate.duration * 1000),
        }
      });
    } else {
      // Add time to existing session
      const newTimeRemaining = client.timeRemaining + rate.duration;
      client = await prisma.client.update({
        where: { id: client.id },
        data: {
          status: 'CONNECTED',
          timeRemaining: newTimeRemaining,
          totalPaid: client.totalPaid + rate.price,
          sessionEnd: new Date(Date.now() + newTimeRemaining * 1000),
        }
      });
    }

    // Create transaction record
    await prisma.transaction.create({
      data: {
        clientId: client.id,
        rateId: rate.id,
        amount: rate.price,
        duration: rate.duration,
        method: 'COIN',
        status: 'COMPLETED',
      }
    });

    // Create session record
    const session = await prisma.session.create({
      data: {
        clientId: client.id,
        macAddress: client.macAddress,
        ipAddress: clientIP,
        duration: rate.duration,
        status: 'ACTIVE',
      }
    });

    // Authenticate client in network (allow internet access)
    try {
      await execAsync(`pisowifi-allow-client ${macAddress}`);
      console.log(`Client ${macAddress} authenticated in network`);
      
      // Update system log with network authentication
      await prisma.systemLog.create({
        data: {
          level: 'INFO',
          message: `Client network authentication successful: ${macAddress}`,
          category: 'network',
          metadata: JSON.stringify({ ip: clientIP, sessionId: session.id })
        }
      });
      
    } catch (networkError) {
      console.error('Network authentication failed:', networkError);
      
      // Log the network error but don't fail the entire request
      await prisma.systemLog.create({
        data: {
          level: 'WARN',
          message: `Client network authentication failed: ${macAddress}`,
          category: 'network',
          metadata: JSON.stringify({ error: String(networkError), ip: clientIP })
        }
      });
    }

    // Log the connection
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        message: `Client ${macAddress} connected with ${rate.name}`,
        category: 'connection',
        metadata: JSON.stringify({ rateId, coinsUsed, duration: rate.duration })
      }
    });

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        macAddress: client.macAddress,
        ipAddress: client.ipAddress,
        timeRemaining: client.timeRemaining,
        status: client.status,
      }
    });

  } catch (error) {
    console.error('Connection error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}