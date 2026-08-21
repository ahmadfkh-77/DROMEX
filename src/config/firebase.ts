export type FirebasePublicConfig = {
  apiKey: string;
  projectId: string;
  storageBucket: string;
};

export const firebasePublicConfig: FirebasePublicConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
};

export const isFirebaseConfigured = (config: FirebasePublicConfig = firebasePublicConfig) =>
  Boolean(config.apiKey.trim() && config.projectId.trim() && config.storageBucket.trim());
