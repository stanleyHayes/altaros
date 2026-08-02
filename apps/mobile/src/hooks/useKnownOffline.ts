import { useNetInfo } from '@react-native-community/netinfo';
import { isKnownOffline } from '../services/connectivity';

/** React view of the same definitive-offline policy used by the API boundary. */
export function useKnownOffline(): boolean {
  const { isConnected, isInternetReachable } = useNetInfo();
  return isKnownOffline({ isConnected, isInternetReachable });
}
