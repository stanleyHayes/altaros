// Ambient types for the Expo build-time environment.
//
// Expo inlines `process.env.EXPO_PUBLIC_*` at bundle time, but the mobile app
// has no Node types (and should not: pulling in @types/node here would make
// server-only globals like `fs` and `Buffer` appear available in code that
// runs on a phone). Declaring only the variables this app actually reads keeps
// the surface honest.
declare const process: {
  env: {
    /** Overrides the API origin. Needed on a physical device or an Android
     *  emulator, where `localhost` is the device rather than the dev machine. */
    EXPO_PUBLIC_API_URL?: string;
    NODE_ENV?: "development" | "production" | "test";
  };
};

declare module '*.png' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
