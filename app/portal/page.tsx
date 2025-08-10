'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Wifi, Coins, Clock, Zap, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface CoinEvent {
  type: string;
  timestamp: number;
  count: number;
  pin?: string;
  library?: string;
}

interface ClientSession {
  id: string;
  macAddress: string;
  ipAddress: string;
  timeRemaining: number;
  status: 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED';
}

interface Rate {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  isActive: boolean;
}

const MOCK_RATES: Rate[] = [
  { id: '1', name: '15 Minutes', description: 'Quick browsing', price: 5, duration: 900, isActive: true },
  { id: '2', name: '30 Minutes', description: 'Standard access', price: 10, duration: 1800, isActive: true },
  { id: '3', name: '1 Hour', description: 'Extended access', price: 18, duration: 3600, isActive: true },
  { id: '4', name: '2 Hours', description: 'Premium access', price: 30, duration: 7200, isActive: true },
];

export default function CaptivePortal() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [coinCount, setCoinCount] = useState(0);
  const [selectedRate, setSelectedRate] = useState<Rate | null>(MOCK_RATES[0]);
  const [session, setSession] = useState<ClientSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [gpioStatus, setGpioStatus] = useState<any>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      toast.success('Connected to PISOWifi system');
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      toast.error('Disconnected from PISOWifi system');
    });

    newSocket.on('coin_detected', (data: CoinEvent) => {
      setCoinCount(data.count);
      toast.success(`Coin detected! Total: ${data.count}`, {
        icon: '🪙',
        duration: 2000,
      });
      
      // Add coin animation class
      const coinElement = document.getElementById('coin-display');
      if (coinElement) {
        coinElement.classList.add('coin-detected');
        setTimeout(() => {
          coinElement.classList.remove('coin-detected');
        }, 600);
      }
    });

    newSocket.on('gpio_status', (status: any) => {
      setGpioStatus(status);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  // Get client MAC address (mock for now)
  const getClientMAC = useCallback(() => {
    // In production, this would be detected server-side
    return '00:11:22:33:44:55';
  }, []);

  // Handle internet access purchase
  const handleConnect = async () => {
    if (!selectedRate || coinCount < selectedRate.price) {
      toast.error(`Insert ${selectedRate?.price - coinCount} more coins`);
      return;
    }

    setLoading(true);

    try {
      // Simulate API call to create session
      const response = await fetch('/api/portal/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          macAddress: getClientMAC(),
          rateId: selectedRate.id,
          coinsUsed: selectedRate.price,
        }),
      });

      if (response.ok) {
        const sessionData = await response.json();
        setSession(sessionData.session);
        setCoinCount(coinCount - selectedRate.price);
        toast.success('Connected to internet!', {
          icon: '🌐',
          duration: 5000,
        });
      } else {
        throw new Error('Failed to connect');
      }
    } catch (error) {
      toast.error('Failed to connect. Please try again.');
      console.error('Connection error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Test coin detection
  const testCoin = () => {
    if (socket) {
      socket.emit('test_coin');
    }
  };

  // Format time remaining
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // If user has active session, show session info
  if (session && session.status === 'CONNECTED') {
    return (
      <div className="min-h-screen captive-portal-bg flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="glass-morphism rounded-2xl p-8 text-center">
            <div className="mb-6">
              <CheckCircle className="h-16 w-16 text-green-400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-white mb-2">Connected!</h1>
              <p className="text-blue-100">You now have internet access</p>
            </div>

            <div className="bg-white/20 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-blue-100">Time Remaining:</span>
                <span className="text-2xl font-bold text-white">
                  {formatTime(session.timeRemaining)}
                </span>
              </div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-blue-100">Device:</span>
                <span className="text-white font-mono text-sm">
                  {session.macAddress}
                </span>
              </div>
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div 
                  className="bg-green-400 h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${(session.timeRemaining / 3600) * 100}%` 
                  }}
                ></div>
              </div>
            </div>

            <div className="text-center">
              <p className="text-blue-100 text-sm">
                Enjoy your internet access! 🌐
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen captive-portal-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Wifi className="h-12 w-12 text-yellow-300 mr-3" />
            <h1 className="text-3xl font-bold text-white">PISOWifi</h1>
          </div>
          <p className="text-blue-100">Insert coins to access the internet</p>
          
          {/* Connection Status */}
          <div className="flex items-center justify-center mt-4 space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'status-online' : 'status-offline'}`}></div>
            <span className="text-sm text-blue-100">
              {isConnected ? 'Connected' : 'Connecting...'}
            </span>
          </div>
        </div>

        {/* Main Portal Card */}
        <div className="glass-morphism rounded-2xl p-6 mb-6">
          {/* Coin Display */}
          <div className="text-center mb-6">
            <div 
              id="coin-display" 
              className="inline-flex items-center justify-center w-24 h-24 bg-yellow-400 rounded-full mb-4 coin-pulse"
            >
              <Coins className="h-12 w-12 text-yellow-800" />
            </div>
            <div className="text-white">
              <span className="text-3xl font-bold">{coinCount}</span>
              <span className="text-blue-100 ml-2">coins inserted</span>
            </div>
          </div>

          {/* Rate Selection */}
          <div className="mb-6">
            <h3 className="text-white font-semibold mb-3">Select Package:</h3>
            <div className="grid grid-cols-1 gap-2">
              {MOCK_RATES.map((rate) => (
                <button
                  key={rate.id}
                  onClick={() => setSelectedRate(rate)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedRate?.id === rate.id
                      ? 'border-yellow-300 bg-white/20'
                      : 'border-white/30 bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-left">
                      <div className="text-white font-medium">{rate.name}</div>
                      <div className="text-blue-100 text-sm">{rate.description}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-yellow-300 font-bold">{rate.price} coins</div>
                      <div className="text-blue-100 text-sm">
                        <Clock className="inline h-3 w-3 mr-1" />
                        {rate.duration / 60} min
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Connect Button */}
          <button
            onClick={handleConnect}
            disabled={loading || !selectedRate || coinCount < selectedRate.price}
            className={`w-full py-4 rounded-lg font-semibold text-lg transition-all ${
              loading || !selectedRate || coinCount < selectedRate.price
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-white shadow-lg hover:shadow-xl'
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mr-2"></div>
                Connecting...
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <Zap className="h-5 w-5 mr-2" />
                {selectedRate && coinCount >= selectedRate.price
                  ? `Connect (${selectedRate.price} coins)`
                  : `Insert ${selectedRate ? selectedRate.price - coinCount : 0} more coins`
                }
              </div>
            )}
          </button>
        </div>

        {/* GPIO Status & Test */}
        <div className="glass-morphism rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-white font-medium">Hardware Status</h4>
            <div className={`w-2 h-2 rounded-full ${
              gpioStatus?.available ? 'status-online' : 'status-offline'
            }`}></div>
          </div>
          
          <div className="text-sm text-blue-100 space-y-1">
            <div>GPIO Library: {gpioStatus?.library || 'Unknown'}</div>
            <div>Status: {gpioStatus?.status || 'Checking...'}</div>
            <div>Coin Pin: {gpioStatus?.coinPin || '3'}</div>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <button
              onClick={testCoin}
              className="w-full mt-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
            >
              Test Coin Detection
            </button>
          )}
        </div>

        {/* Instructions */}
        <div className="text-center">
          <div className="glass-morphism rounded-lg p-4">
            <h4 className="text-white font-medium mb-2">How to Use</h4>
            <div className="text-sm text-blue-100 space-y-1">
              <div>1. Insert coins into the slot</div>
              <div>2. Select your preferred package</div>
              <div>3. Click Connect to access internet</div>
              <div>4. Enjoy browsing! 🌐</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}