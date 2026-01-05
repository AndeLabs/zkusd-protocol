/**
 * Mobile Wallet Utilities
 * Helper functions for detecting mobile devices and creating deep links for wallet apps
 */

// ============================================================================
// Mobile Detection
// ============================================================================

/**
 * Detects if the user is on a mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // Check user agent
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;

  // Check for mobile patterns
  const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
  const isMobileUA = mobileRegex.test(userAgent);

  // Check for touch support (additional check)
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Check screen width as fallback
  const isSmallScreen = window.innerWidth <= 768;

  return isMobileUA || (hasTouch && isSmallScreen);
}

/**
 * Detects if we're running inside Unisat's mobile dApp browser
 */
export function isUnisatMobileBrowser(): boolean {
  if (typeof window === 'undefined') return false;

  // Check if Unisat object exists (injected by the dApp browser)
  const hasUnisat = !!(window as any).unisat;

  // Check user agent for Unisat patterns
  const userAgent = navigator.userAgent || '';
  const isUnisatUA = /unisat/i.test(userAgent);

  return hasUnisat || isUnisatUA;
}

// ============================================================================
// Deep Link Generation
// ============================================================================

/**
 * Creates a deep link to open a dApp in Unisat mobile wallet
 * @param url The dApp URL to open (defaults to current page)
 */
export function createUnisatDeepLink(url?: string): string {
  const targetUrl = url || window.location.href;

  // Try multiple deep link patterns as Unisat doesn't have official documentation
  // Pattern 1: Standard dapp pattern (similar to other wallets)
  // Pattern 2: Encoded URL in data parameter
  // We'll try the most common pattern first
  return `unisat://dapp?url=${encodeURIComponent(targetUrl)}`;
}

/**
 * Copies text to clipboard
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * Opens the Unisat mobile app with a deep link
 * Also copies the URL to clipboard as a fallback
 * @returns Object with copied status and callback to show instructions
 */
export async function openInUnisatApp(): Promise<{
  copied: boolean;
  showInstructions: (callback: () => void) => void;
}> {
  const currentUrl = window.location.href;

  // Copy URL to clipboard first
  const copied = await copyToClipboard(currentUrl);

  // Try multiple deep link attempts
  const deepLinkAttempts = [
    `unisat://dapp?url=${encodeURIComponent(currentUrl)}`,
    `unisat://browser?url=${encodeURIComponent(currentUrl)}`,
    `unisat://open?url=${encodeURIComponent(currentUrl)}`,
  ];

  // Try the first deep link
  window.location.href = deepLinkAttempts[0];

  // Return function to show instructions after a delay
  return {
    copied,
    showInstructions: (callback: () => void) => {
      setTimeout(() => {
        if (!document.hidden) {
          // If we're still here, show manual instructions
          callback();
        }
      }, 1500);
    },
  };
}

/**
 * Simplified version for synchronous use - just copies URL and attempts deep link
 */
export function tryOpenInUnisatApp() {
  const currentUrl = window.location.href;

  // Try to copy
  copyToClipboard(currentUrl);

  // Try deep link
  window.location.href = `unisat://dapp?url=${encodeURIComponent(currentUrl)}`;
}

// ============================================================================
// Error Messages
// ============================================================================

/**
 * Gets a platform-specific error message for wallet connection
 */
export function getWalletConnectionError(walletType: 'unisat' | 'xverse'): {
  title: string;
  message: string;
  action?: {
    label: string;
    handler: () => void;
  };
} {
  const isMobile = isMobileDevice();

  if (walletType === 'unisat') {
    if (isMobile) {
      return {
        title: 'Abre en la App de Unisat',
        message: 'Para conectar tu wallet en móvil, necesitas abrir esta página desde el navegador integrado de la app Unisat.',
        action: {
          label: 'Abrir en Unisat',
          handler: openInUnisatApp,
        },
      };
    } else {
      return {
        title: 'Unisat no encontrada',
        message: 'Por favor instala la extensión de Unisat desde unisat.io',
      };
    }
  }

  // Xverse
  if (isMobile) {
    return {
      title: 'Xverse no encontrada',
      message: 'Por favor instala la app de Xverse desde la App Store o Google Play.',
    };
  } else {
    return {
      title: 'Xverse no encontrada',
      message: 'Por favor instala la extensión de Xverse desde xverse.app',
    };
  }
}

/**
 * Checks if a wallet is available on the current platform
 */
export function isWalletAvailable(walletType: 'unisat' | 'xverse'): {
  available: boolean;
  reason?: string;
} {
  const isMobile = isMobileDevice();

  if (walletType === 'unisat') {
    const hasUnisat = !!(window as any).unisat;

    if (hasUnisat) {
      return { available: true };
    }

    if (isMobile) {
      return {
        available: false,
        reason: 'mobile_browser',
      };
    }

    return {
      available: false,
      reason: 'not_installed',
    };
  }

  // Xverse
  const win = window as any;
  const hasXverse = !!(win.XverseProviders?.BitcoinProvider || win.BitcoinProvider);

  if (hasXverse) {
    return { available: true };
  }

  return {
    available: false,
    reason: 'not_installed',
  };
}
