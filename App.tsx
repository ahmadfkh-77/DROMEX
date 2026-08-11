import { Suspense } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SQLiteProvider } from 'expo-sqlite';

import { migrateDatabase } from './src/data/database/migrations';
import { DromexApp } from './src/ui/DromexApp';
import { colors } from './src/ui/theme';

function DatabaseFallback() {
  return (
    <View style={styles.fallback}>
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

export default function App() {
  return (
    <Suspense fallback={<DatabaseFallback />}>
      <SQLiteProvider databaseName="dromex.db" onInit={migrateDatabase} useSuspense>
        <DromexApp />
      </SQLiteProvider>
    </Suspense>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});

