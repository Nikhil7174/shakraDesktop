// src/constants/api.ts
export const API_CONFIG = {
    BASE_URL: import.meta.env.VITE_API_BASE_URL || 'https://crisp-server-n0r1.onrender.com/api',
    LOCAL_URL: 'http://localhost:3001/api',
} as const;

// Use local URL for testing, switch to production URL when ready
// For testing: use LOCAL_URL
// For production: use BASE_URL or production URL
export const API_BASE_URL = 'https://crisp-server-n0r1.onrender.com/api'; // Changed to localhost for testing

// Export individual configs for specific use cases
export const { BASE_URL, LOCAL_URL } = API_CONFIG;

