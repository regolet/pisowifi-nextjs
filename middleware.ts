import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

/**
 * Get JWT secret - throws error if not set in production
 */
function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET
  
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable is required in production')
    }
    console.warn('⚠️  WARNING: JWT_SECRET not set. Using insecure default.')
    return 'dev-only-insecure-secret-change-me'
  }
  
  return secret
}

export function middleware(request: NextRequest) {
  // Check if the request is for admin routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    // Allow access to login page
    if (request.nextUrl.pathname === '/admin/login') {
      return NextResponse.next()
    }

    // Check for auth token
    const token = request.cookies.get('auth-token')?.value

    if (!token) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }

    try {
      // Verify JWT token with secure secret
      jwt.verify(token, getJWTSecret())
      return NextResponse.next()
    } catch (error) {
      // Invalid token, redirect to login
      const response = NextResponse.redirect(new URL('/admin/login', request.url))
      // Clear invalid cookie
      response.cookies.delete('auth-token')
      return response
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*']
}