'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';

// ============================================================================
// Icons
// ============================================================================

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BrowserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </svg>
);

// ============================================================================
// Component
// ============================================================================

interface UnisatMobileInstructionsProps {
  isOpen: boolean;
  onClose: () => void;
  currentUrl: string;
  urlCopied: boolean;
}

export function UnisatMobileInstructions({
  isOpen,
  onClose,
  currentUrl,
  urlCopied,
}: UnisatMobileInstructionsProps) {
  const [copied, setCopied] = useState(urlCopied);

  useEffect(() => {
    setCopied(urlCopied);
  }, [urlCopied]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl z-[101] overflow-hidden"
          >
            {/* Header */}
            <div className="relative bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-b border-zinc-700 px-6 py-5">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 hover:bg-zinc-800 rounded-lg transition-colors"
                aria-label="Cerrar"
              >
                <CloseIcon />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
                  <BrowserIcon />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Abrir en Unisat</h2>
                  <p className="text-sm text-zinc-400">Conecta tu wallet desde la app</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* URL Copy Section */}
              {copied && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <CheckIcon />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-green-400">¡URL copiada!</div>
                    <div className="text-xs text-zinc-400">Listo para pegar en Unisat</div>
                  </div>
                </motion.div>
              )}

              {/* Instructions */}
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Pasos a seguir:</h3>

                <div className="space-y-3">
                  {[
                    {
                      number: '1',
                      text: 'Abre la app Unisat en tu teléfono',
                      icon: '📱',
                    },
                    {
                      number: '2',
                      text: 'Toca el ícono del navegador (🌐) en la parte inferior',
                      icon: '🌐',
                    },
                    {
                      number: '3',
                      text: 'Pega la URL copiada en la barra de direcciones',
                      icon: '📋',
                    },
                    {
                      number: '4',
                      text: 'Toca "Connect" cuando veas zkUSD',
                      icon: '🔗',
                    },
                  ].map((step) => (
                    <div
                      key={step.number}
                      className="flex items-start gap-3 p-3 bg-zinc-800/50 rounded-lg hover:bg-zinc-800 transition-colors"
                    >
                      <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 text-amber-400 font-bold text-sm">
                        {step.number}
                      </div>
                      <div className="flex-1 text-sm text-zinc-300">{step.text}</div>
                      <div className="text-xl flex-shrink-0">{step.icon}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* URL Display */}
              <div className="bg-zinc-800/50 rounded-xl p-4 space-y-2">
                <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium">
                  URL de tu página
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-zinc-900 px-3 py-2 rounded-lg text-amber-400 overflow-x-auto">
                    {currentUrl}
                  </code>
                  <button
                    onClick={copyUrl}
                    className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-black text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    {copied ? '✓ Copiada' : 'Copiar'}
                  </button>
                </div>
              </div>

              {/* Help text */}
              <div className="text-center pt-2">
                <p className="text-xs text-zinc-500">
                  ¿No tienes Unisat?{' '}
                  <a
                    href="https://unisat.io/download"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 hover:text-amber-300 underline"
                  >
                    Descárgala aquí
                  </a>
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-zinc-700 px-6 py-4 bg-zinc-800/30">
              <button
                onClick={onClose}
                className="w-full px-4 py-3 bg-zinc-700 hover:bg-zinc-600 rounded-xl font-semibold transition-colors"
              >
                Entendido
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
