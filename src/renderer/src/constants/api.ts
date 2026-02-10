// src/constants/api.ts
export const API_CONFIG = {
    BASE_URL: import.meta.env.VITE_API_BASE_URL || 'https://crisp-server-n0r1.onrender.com/api',
    LOCAL_URL: 'http://localhost:3001/api',
} as const;

// Use local URL for testing, switch to production URL when ready
// For testing: use LOCAL_URL
// For production: use BASE_URL or production URL
// For production: use BASE_URL or production URL
// Priority:
// 1. VITE_API_BASE_URL (if set in .env)
// 2. API_CONFIG.BASE_URL (if PROD)
// 3. API_CONFIG.LOCAL_URL (fallback)
export const API_BASE_URL = API_CONFIG.BASE_URL;

// Export individual configs for specific use cases
export const { BASE_URL, LOCAL_URL } = API_CONFIG;

