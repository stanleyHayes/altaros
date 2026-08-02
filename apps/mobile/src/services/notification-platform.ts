// Native/default implementation. Metro prefers notification-platform.web.ts
// for the web bundle, keeping expo-notifications and its native-only global
// registration side effects out of that runtime.
export * from 'expo-notifications';
