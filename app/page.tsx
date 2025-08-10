'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wifi, Coins, Users, Activity } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen captive-portal-bg">
      {/* Navigation */}
      <nav className="glass-morphism">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <Wifi className="h-8 w-8 text-white mr-2" />
              <span className="text-xl font-bold text-white">PISOWifi Next.js</span>
            </div>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <button
                  onClick={() => router.push('/portal')}
                  className="text-white hover:bg-white/20 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Client Portal
                </button>
                <button
                  onClick={() => router.push('/admin')}
                  className="text-white hover:bg-white/20 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Admin Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="relative z-10 pb-8 sm:pb-16 md:pb-20 lg:max-w-2xl lg:w-full lg:pb-28 xl:pb-32">
            <main className="mt-10 mx-auto max-w-7xl px-4 sm:mt-12 sm:px-6 md:mt-16 lg:mt-20 lg:px-8 xl:mt-28">
              <div className="sm:text-center lg:text-left">
                <h1 className="text-4xl tracking-tight font-extrabold text-white sm:text-5xl md:text-6xl">
                  <span className="block xl:inline">Modern</span>{' '}
                  <span className="block text-yellow-300 xl:inline">PISOWifi System</span>
                </h1>
                <p className="mt-3 text-base text-blue-100 sm:mt-5 sm:text-lg sm:max-w-xl sm:mx-auto md:mt-5 md:text-xl lg:mx-0">
                  Built with Next.js and React for better performance, real-time updates, and modern user experience.
                  Supports coin-operated internet access with GPIO hardware integration.
                </p>
                <div className="mt-5 sm:mt-8 sm:flex sm:justify-center lg:justify-start">
                  <div className="rounded-md shadow">
                    <button
                      onClick={() => router.push('/portal')}
                      className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 md:py-4 md:text-lg md:px-10 transition-colors"
                    >
                      <Coins className="mr-2 h-5 w-5" />
                      Access Portal
                    </button>
                  </div>
                  <div className="mt-3 sm:mt-0 sm:ml-3">
                    <button
                      onClick={() => router.push('/admin')}
                      className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg md:px-10 transition-colors"
                    >
                      <Activity className="mr-2 h-5 w-5" />
                      Admin Dashboard
                    </button>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
        
        {/* Feature Cards */}
        <div className="lg:absolute lg:inset-y-0 lg:right-0 lg:w-1/2">
          <div className="h-56 w-full sm:h-72 md:h-96 lg:w-full lg:h-full p-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              
              {/* Real-time Updates */}
              <div className="glass-morphism rounded-lg p-6">
                <div className="flex items-center">
                  <Activity className="h-8 w-8 text-yellow-300" />
                  <h3 className="ml-3 text-lg font-medium text-white">Real-time Updates</h3>
                </div>
                <p className="mt-2 text-sm text-blue-100">
                  WebSocket-powered live coin detection and session updates with instant feedback.
                </p>
              </div>

              {/* Modern UI */}
              <div className="glass-morphism rounded-lg p-6">
                <div className="flex items-center">
                  <Wifi className="h-8 w-8 text-yellow-300" />
                  <h3 className="ml-3 text-lg font-medium text-white">Modern Interface</h3>
                </div>
                <p className="mt-2 text-sm text-blue-100">
                  Built with React and Tailwind CSS for responsive, mobile-friendly design.
                </p>
              </div>

              {/* GPIO Integration */}
              <div className="glass-morphism rounded-lg p-6">
                <div className="flex items-center">
                  <Coins className="h-8 w-8 text-yellow-300" />
                  <h3 className="ml-3 text-lg font-medium text-white">GPIO Integration</h3>
                </div>
                <p className="mt-2 text-sm text-blue-100">
                  Hardware coin detection with Orange Pi GPIO and real-time portal updates.
                </p>
              </div>

              {/* User Management */}
              <div className="glass-morphism rounded-lg p-6">
                <div className="flex items-center">
                  <Users className="h-8 w-8 text-yellow-300" />
                  <h3 className="ml-3 text-lg font-medium text-white">User Management</h3>
                </div>
                <p className="mt-2 text-sm text-blue-100">
                  Advanced admin dashboard with client monitoring and session management.
                </p>
              </div>
              
            </div>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="bg-white/10 mt-16">
        <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:py-16 lg:px-8">
          <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-center">
            <div>
              <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
                System Features
              </h2>
              <p className="mt-3 max-w-3xl text-lg text-blue-100">
                This Next.js version of PISOWifi brings modern web technologies to coin-operated internet access.
              </p>
              <dl className="mt-10 space-y-10">
                <div>
                  <dt className="text-lg leading-6 font-medium text-white">Ethernet-based Architecture</dt>
                  <dd className="mt-2 text-base text-blue-100">
                    Works with Orange Pi models without WiFi hardware using ethernet connections and captive portal.
                  </dd>
                </div>
                <div>
                  <dt className="text-lg leading-6 font-medium text-white">Real-time Coin Detection</dt>
                  <dd className="mt-2 text-base text-blue-100">
                    GPIO service with WebSocket integration for instant coin detection and LED feedback.
                  </dd>
                </div>
                <div>
                  <dt className="text-lg leading-6 font-medium text-white">Modern Database</dt>
                  <dd className="mt-2 text-base text-blue-100">
                    Prisma ORM with SQLite/PostgreSQL support for robust data management.
                  </dd>
                </div>
              </dl>
            </div>
            <div className="mt-8 lg:mt-0">
              <div className="pl-4 -mr-16 sm:pl-8 md:pl-16 lg:px-0 lg:m-0 lg:relative lg:h-full">
                <div className="glass-morphism rounded-lg shadow-xl p-8">
                  <h3 className="text-xl font-semibold text-white mb-4">Quick Start</h3>
                  <div className="space-y-3 text-sm text-blue-100">
                    <div className="flex items-center">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-3">1</span>
                      Connect ethernet switch to Orange Pi
                    </div>
                    <div className="flex items-center">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-3">2</span>
                      Connect client devices to switch
                    </div>
                    <div className="flex items-center">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-3">3</span>
                      Client browsers auto-redirect to portal
                    </div>
                    <div className="flex items-center">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs font-bold mr-3">4</span>
                      Insert coins and click Connect
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-blue-900/50 mt-16">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-blue-100">
              PISOWifi Next.js - Modern coin-operated internet access system
            </p>
            <p className="mt-2 text-sm text-blue-200">
              Built with Next.js, React, Prisma, and Tailwind CSS
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}