// src/constants/api.ts
export const API_CONFIG = {
    BASE_URL: 'https://crisp-3jy7.onrender.com/api',
    LOCAL_URL: 'http://localhost:3001/api',
} as const;

// Use local URL for development, production URL for production builds
export const API_BASE_URL = import.meta.env.DEV 
    ? API_CONFIG.LOCAL_URL 
    : API_CONFIG.BASE_URL;

// Export individual configs for specific use cases
export const { BASE_URL, LOCAL_URL } = API_CONFIG;

