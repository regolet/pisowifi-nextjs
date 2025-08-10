import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    const { macAddress, rateId, coinsUsed } = await request.json();

    if (!macAddress || !rateId || !coinsUsed) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

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
          ipAddress: request.ip || '192.168.100.10',
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
        ipAddress: client.ipAddress || '192.168.100.10',
        duration: rate.duration,
        status: 'ACTIVE',
      }
    });

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