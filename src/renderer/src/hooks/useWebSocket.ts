// src/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppDispatch } from '../store';
import { 
  setSecurityAgentConnected, 
  setCheatingDetected, 
  addCheatingIncident,
  setSecurityStatus 
} from '../store/slices/securitySlice';
import { API_BASE_URL } from '../constants/api';

export interface CheatingIncident {
  id: string;
  timestamp: number;
  processName: string;
  pid: number;
  reason: string;
  killed: boolean;
  sessionId?: string;
}

export interface SecurityStatus {
  connected: boolean;
  blockedAppsDetected: Array<{
    name: string;
    pid: number;
    reason: string;
  }>;
  timestamp: number;
  error?: string;
  blockedAndKilled: boolean;
  message: string;
}

export interface SignedMessage {
  type: string;
  data?: any;
  sequence: number;
  timestamp: number;
  signature: string;
}

export const useWebSocket = (sessionId?: string) => {
  const dispatch = useAppDispatch();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000; // 3 seconds

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      // Connect to the security agent WebSocket server
      const ws = new WebSocket('ws://localhost:8765');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✓ Connected to security agent');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttempts.current = 0;
        dispatch(setSecurityAgentConnected(true));
        
        // Send session information if available
        if (sessionId) {
          ws.send(JSON.stringify({
            type: 'session-info',
            data: { sessionId }
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: SignedMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        setIsConnected(false);
        dispatch(setSecurityAgentConnected(false));
        
        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
          scheduleReconnect();
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionError('Connection failed');
        dispatch(setSecurityAgentConnected(false));
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setConnectionError('Failed to connect');
      scheduleReconnect();
    }
  }, [sessionId, dispatch]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectAttempts.current++;
    const delay = reconnectDelay * Math.pow(2, reconnectAttempts.current - 1); // Exponential backoff
    
    console.log(`Scheduling reconnect attempt ${reconnectAttempts.current} in ${delay}ms`);
    
    reconnectTimeoutRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  const handleMessage = useCallback((message: SignedMessage) => {
    console.log('Received WebSocket message:', message.type, message.data);

    switch (message.type) {
      case 'handshake':
        console.log('Security agent handshake received:', message.data);
        break;

      case 'status':
        const status: SecurityStatus = message.data;
        dispatch(setSecurityStatus(status));
        
        // Check if cheating was detected and blocked
        if (status.blockedAndKilled && status.blockedAppsDetected.length > 0) {
          const newIncidents: CheatingIncident[] = [];
          status.blockedAppsDetected.forEach(app => {
            const incident: CheatingIncident = {
              id: `incident-${Date.now()}-${app.pid}`,
              timestamp: Date.now(),
              processName: app.name,
              pid: app.pid,
              reason: app.reason,
              killed: true,
              sessionId
            };
            
            newIncidents.push(incident);
            dispatch(addCheatingIncident(incident));
            dispatch(setCheatingDetected(true));
          });
          
          // Send cheating data to server
          sendCheatingDataToServer(newIncidents, true);
        }
        break;

      case 'process-killed':
        const killData = message.data;
        const incident: CheatingIncident = {
          id: `incident-${Date.now()}-${killData.pid}`,
          timestamp: killData.timestamp,
          processName: killData.processName,
          pid: killData.pid,
          reason: killData.reason,
          killed: true,
          sessionId
        };
        
        dispatch(addCheatingIncident(incident));
        dispatch(setCheatingDetected(true));
        
        // Send cheating data to server
        sendCheatingDataToServer([incident], true);
        break;

      case 'pong':
        // Handle ping response
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  }, [dispatch, sessionId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setIsConnected(false);
    dispatch(setSecurityAgentConnected(false));
  }, [dispatch]);

  const sendMessage = useCallback((type: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    } else {
      console.warn('WebSocket not connected, cannot send message');
    }
  }, []);

  const sendCheatingDataToServer = useCallback(async (incidents: CheatingIncident[], connected: boolean) => {
    if (!sessionId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/interview/${sessionId}/cheating-detection`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` })
        },
        body: JSON.stringify({
          cheatingDetected: incidents.length > 0,
          cheatingIncidents: incidents,
          securityAgentConnected: connected
        })
      });

      if (!response.ok) {
        console.error('Failed to send cheating detection data to server');
      } else {
        console.log('Cheating detection data sent to server successfully');
      }
    } catch (error) {
      console.error('Error sending cheating detection data to server:', error);
    }
  }, [sessionId]);

  // Auto-connect when sessionId is available (controlled by SecurityConnectionCheck)
  useEffect(() => {
    if (sessionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [sessionId, connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connectionError,
    connect,
    disconnect,
    sendMessage
  };
};
