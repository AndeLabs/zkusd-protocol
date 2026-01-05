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

  // Unisat deep link format for opening a dApp
  // Using the connect method to open the app and trigger connection
  const appName = 'zkUSD';
  const nonce = Date.now().toString();

  return `unisat://request?method=connect&from=${encodeURIComponent(appName)}&nonce=${nonce}`;
}

/**
 * Opens the Unisat mobile app with a deep link
 * If the app is not installed, redirects to the download page
 */
export function openInUnisatApp() {
  const deepLink = createUnisatDeepLink();
  const downloadUrl = 'https://unisat.io/download';

  // Try to open the deep link
  window.location.href = deepLink;

  // Fallback: If the app doesn't open after 2 seconds, redirect to download page
  setTimeout(() => {
    // Check if the page is still visible (app didn't open)
    if (!document.hidden) {
      const shouldRedirect = confirm(
        'Parece que no tienes Unisat instalada. ¿Quieres ir a la página de descarga?'
      );
      if (shouldRedirect) {
        window.open(downloadUrl, '_blank');
      }
    }
  }, 2000);
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
