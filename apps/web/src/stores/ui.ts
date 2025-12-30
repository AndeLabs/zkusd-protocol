import { create } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export type ModalType =
  | 'connect-wallet'
  | 'open-vault'
  | 'adjust-vault'
  | 'close-vault'
  | 'deposit-sp'
  | 'withdraw-sp'
  | 'transaction-pending'
  | 'transaction-success'
  | 'transaction-error'
  | null;

interface ModalData {
  vaultId?: string;
  txid?: string;
  error?: string;
  message?: string;
}

interface UIState {
  // Modals
  activeModal: ModalType;
  modalData: ModalData | null;

  // Global loading
  isGlobalLoading: boolean;
  loadingMessage: string | null;

  // Sidebar (for mobile)
  isSidebarOpen: boolean;

  // Theme
  theme: 'dark' | 'light';
}

interface UIActions {
  openModal: (modal: ModalType, data?: ModalData) => void;
  closeModal: () => void;

  setGlobalLoading: (loading: boolean, message?: string) => void;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: UIState = {
  activeModal: null,
  modalData: null,
  isGlobalLoading: false,
  loadingMessage: null,
  isSidebarOpen: false,
  theme: 'dark',
};

// ============================================================================
// Store
// ============================================================================

export const useUIStore = create<UIState & UIActions>()((set) => ({
  ...initialState,

  openModal: (modal, data) =>
    set({ activeModal: modal, modalData: data ?? null }),

  closeModal: () =>
    set({ activeModal: null, modalData: null }),

  setGlobalLoading: (loading, message) =>
    set({ isGlobalLoading: loading, loadingMessage: loading ? (message ?? null) : null }),

  toggleSidebar: () =>
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setSidebarOpen: (open) =>
    set({ isSidebarOpen: open }),

  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
    set({ theme });
  },

  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', newTheme === 'dark');
      }
      return { theme: newTheme };
    }),
}));

// ============================================================================
// Selectors
// ============================================================================

export const selectActiveModal = (state: UIState) => state.activeModal;
export const selectModalData = (state: UIState) => state.modalData;
export const selectIsGlobalLoading = (state: UIState) => state.isGlobalLoading;
export const selectTheme = (state: UIState) => state.theme;
