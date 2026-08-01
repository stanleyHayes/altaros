import React, { useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { AppNavigator } from './src/components/navigation/AppNavigator';
import { SplashScreen } from './src/screens/auth/SplashScreen';
import { OfflineBanner } from './src/components/common/OfflineBanner';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SplashScreen onComplete={() => setShowSplash(false)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1 }}>
          <OfflineBanner />
          <AppNavigator />
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
