// src/utils/tokenExtractor.ts

/**
 * Extracts a clean token from various input formats
 * @param input - The input string which could be a token, URL, or URL with token parameter
 * @returns The clean token string
 */
export function extractToken(input: string): string {
  if (!input || !input.trim()) {
    return '';
  }

  let cleanToken = input.trim();
  
  try {
    // If it's a full URL, try to extract the token parameter
    if (cleanToken.includes('http')) {
      const url = new URL(cleanToken);
      const tokenParam = url.searchParams.get('token');
      if (tokenParam) {
        return tokenParam;
      }
    }
    
    // If it contains query parameters, extract token
    if (cleanToken.includes('?')) {
      const urlParams = new URLSearchParams(cleanToken.split('?')[1] || '');
      const tokenParam = urlParams.get('token');
      if (tokenParam) {
        return tokenParam;
      }
    }
    
    // If it's just a token, return as is
    return cleanToken;
    
  } catch (error) {
    // If URL parsing fails, try to extract token from the string
    const tokenMatch = cleanToken.match(/token=([^&]+)/);
    if (tokenMatch) {
      return tokenMatch[1];
    }
    
    // Return the original input if no token can be extracted
    return cleanToken;
  }
}

/**
 * Extracts token from URL hash (for Electron apps with hash routing)
 * @param hash - The URL hash string
 * @returns The token if found, null otherwise
 */
export function extractTokenFromHash(hash: string): string | null {
  if (!hash) return null;
  
  try {
    const hashParams = new URLSearchParams(hash.split('?')[1] || '');
    return hashParams.get('token');
  } catch (error) {
    return null;
  }
}

/**
 * Extracts token from URL search parameters
 * @param search - The URL search string
 * @returns The token if found, null otherwise
 */
export function extractTokenFromSearch(search: string): string | null {
  if (!search) return null;
  
  try {
    const urlParams = new URLSearchParams(search);
    return urlParams.get('token');
  } catch (error) {
    return null;
  }
}

