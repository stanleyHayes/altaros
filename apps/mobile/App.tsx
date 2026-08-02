import React, { useEffect, useState } from 'react';
import { Text, TextInput, View, type TextInputProps, type TextProps } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_500Medium } from '@expo-google-fonts/outfit/500Medium';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { AppNavigator } from './src/components/navigation/AppNavigator';
import { SplashScreen } from './src/screens/auth/SplashScreen';
import { OfflineBanner } from './src/components/common/OfflineBanner';
import { AppErrorBoundary } from './src/components/common/AppErrorBoundary';
import { configureNotificationPresentation } from './src/services/notification.service';
import { typography } from './src/theme';
import {
  FONT_LOAD_WAIT_MS,
  shouldHoldLaunchForFonts,
} from './src/services/font-readiness';

// Expo drops foreground presentation unless the app declares a handler. Set
// it before the first React render so an early receipt or pastoral alert has
// the same visible behavior as a background delivery.
configureNotificationPresentation();

let defaultTypographyConfigured = false;

/** Apply the product font to native text without replacing every RN primitive. */
function configureDefaultTypography(): void {
  if (defaultTypographyConfigured) return;
  const nativeText = Text as unknown as { defaultProps?: TextProps };
  const nativeInput = TextInput as unknown as { defaultProps?: TextInputProps };
  nativeText.defaultProps = {
    ...nativeText.defaultProps,
    style: [{ fontFamily: typography.families.regular }, nativeText.defaultProps?.style],
  };
  nativeInput.defaultProps = {
    ...nativeInput.defaultProps,
    style: [{ fontFamily: typography.families.regular }, nativeInput.defaultProps?.style],
  };
  defaultTypographyConfigured = true;
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [fontWaitExpired, setFontWaitExpired] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) return undefined;
    const timer = setTimeout(() => setFontWaitExpired(true), FONT_LOAD_WAIT_MS);
    return () => clearTimeout(timer);
  }, [fontError, fontsLoaded]);

  if (fontsLoaded) configureDefaultTypography();
  const preparingFonts = shouldHoldLaunchForFonts(
    fontsLoaded,
    Boolean(fontError),
    fontWaitExpired,
  );

  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <AuthProvider>
          {showSplash || preparingFonts ? (
            <>
              <StatusBar style="light" />
              <SplashScreen onComplete={() => setShowSplash(false)} />
            </>
          ) : (
            <>
              <StatusBar style="dark" />
              <View style={{ flex: 1 }}>
                <OfflineBanner />
                <AppNavigator />
              </View>
            </>
          )}
        </AuthProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}
