import { createContext, useContext } from 'react';

export const AgeGateContext = createContext(null);

export function useAgeGate() {
  const value = useContext(AgeGateContext);
  if (!value) throw new Error('useAgeGate must be used inside AgeGateProvider');
  return value;
}
