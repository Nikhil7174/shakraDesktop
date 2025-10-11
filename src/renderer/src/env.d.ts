/// <reference types="vite/client" />
interface Window {
    securityAgent: {
      getStatus: () => Promise<any>
      onStatusUpdate: (callback: (status: any) => void) => void
    }
  }