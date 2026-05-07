import { createContext, useContext, useState } from 'react';

export interface SelectedAddress {
  label: string;
  meta: string;
  lat: number | null;
  lon: number | null;
}

const DEFAULT_ADDRESS: SelectedAddress = {
  label: 'Houston, TX',
  meta: 'DEFAULT',
  lat: 29.7604,
  lon: -95.3698,
};

const STORAGE_KEY = 'pluvik-selected-address';

interface AddressContextType {
  address: SelectedAddress;
  setAddress: (addr: SelectedAddress) => void;
}

const AddressContext = createContext<AddressContextType | null>(null);

export function AddressProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddressState] = useState<SelectedAddress>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return DEFAULT_ADDRESS;
  });

  const setAddress = (addr: SelectedAddress) => {
    setAddressState(addr);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(addr));
    } catch {
      // ignore
    }
  };

  return (
    <AddressContext.Provider value={{ address, setAddress }}>
      {children}
    </AddressContext.Provider>
  );
}

export function useAddress() {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error('useAddress must be used within AddressProvider');
  return ctx;
}