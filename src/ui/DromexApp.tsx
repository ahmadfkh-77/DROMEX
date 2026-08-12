import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { SqliteCatalogRepository } from '../data/repositories/SqliteCatalogRepository';
import { SqliteFinancialRepository } from '../data/repositories/SqliteFinancialRepository';
import { SqliteLoadRepository } from '../data/repositories/SqliteLoadRepository';
import { SqliteProfileRepository } from '../data/repositories/SqliteProfileRepository';
import { SqliteProjectReportRepository } from '../data/repositories/SqliteProjectReportRepository';
import { SqliteQuarryRepository } from '../data/repositories/SqliteQuarryRepository';
import { SqliteQuickTextRepository } from '../data/repositories/SqliteQuickTextRepository';
import { SqliteWasteRepository } from '../data/repositories/SqliteWasteRepository';
import { CatalogScreen } from './screens/CatalogScreen';
import { CustomersScreen } from './screens/CustomersScreen';
import { FinancialsScreen } from './screens/FinancialsScreen';
import { PeopleEquipmentScreen } from './screens/PeopleEquipmentScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LoadHistoryScreen } from './screens/LoadHistoryScreen';
import { LoadCorrectionsScreen } from './screens/LoadCorrectionsScreen';
import { MakeReceiptScreen } from './screens/MakeReceiptScreen';
import { ReceiptSetupScreen } from './screens/ReceiptSetupScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { QuarryPurchasesScreen } from './screens/QuarryPurchasesScreen';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { QuickTextScreen } from './screens/QuickTextScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WasteDumpScreen } from './screens/WasteDumpScreen';
import { colors } from './theme';

type Screen = 'home' | 'makeReceipt' | 'loads' | 'loadCorrections' | 'receiptSetup' | 'directory' | 'customers' | 'catalog' | 'projects' | 'reports' | 'quarry' | 'waste' | 'quickText' | 'financials' | 'settings';

export function DromexApp() {
  const db = useSQLiteContext();
  const catalogRepository = useMemo(() => new SqliteCatalogRepository(db), [db]);
  const profileRepository = useMemo(() => new SqliteProfileRepository(db), [db]);
  const loadRepository = useMemo(() => new SqliteLoadRepository(db), [db]);
  const projectReportRepository = useMemo(() => new SqliteProjectReportRepository(db), [db]);
  const quarryRepository = useMemo(() => new SqliteQuarryRepository(db), [db]);
  const financialRepository = useMemo(() => new SqliteFinancialRepository(db), [db]);
  const wasteRepository = useMemo(() => new SqliteWasteRepository(db), [db]);
  const quickTextRepository = useMemo(() => new SqliteQuickTextRepository(db), [db]);
  const [screen, setScreen] = useState<Screen>('home');

  let content;
  if (screen === 'home') {
    content = (
      <HomeScreen
        onMakeReceipt={() => setScreen('makeReceipt')}
        onOpenLoads={() => setScreen('loads')}
        onOpenReceiptSetup={() => setScreen('receiptSetup')}
        onOpenDirectory={() => setScreen('directory')}
        onOpenCustomers={() => setScreen('customers')}
        onOpenCatalog={() => setScreen('catalog')}
        onOpenReports={() => setScreen('reports')}
        onOpenQuarry={() => setScreen('quarry')}
        onOpenProjects={() => setScreen('projects')}
        onOpenFinancials={() => setScreen('financials')}
        onOpenWaste={() => setScreen('waste')}
        onOpenQuickText={() => setScreen('quickText')}
        onOpenLoadCorrections={() => setScreen('loadCorrections')}
        onOpenSettings={() => setScreen('settings')}
      />
    );
  } else if (screen === 'makeReceipt') {
    content = <ReceiptEntrance><MakeReceiptScreen repository={loadRepository} onBack={() => setScreen('home')} onOpenSetup={() => setScreen('receiptSetup')} onOpenDirectory={() => setScreen('directory')} onOpenProjects={() => setScreen('projects')} /></ReceiptEntrance>;
  } else if (screen === 'loads') {
    content = <LoadHistoryScreen repository={loadRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'loadCorrections') {
    content = <LoadCorrectionsScreen repository={loadRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'receiptSetup') {
    content = <ReceiptSetupScreen repository={loadRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'directory') {
    content = <PeopleEquipmentScreen repository={loadRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'customers') {
    content = <CustomersScreen repository={profileRepository} financialRepository={financialRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'catalog') {
    content = <CatalogScreen repository={catalogRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'reports') {
    content = <ReportsScreen repository={projectReportRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'quarry') {
    content = <QuarryPurchasesScreen repository={quarryRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'projects') {
    content = <ProjectsScreen repository={loadRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'financials') {
    content = <FinancialsScreen repository={financialRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'waste') {
    content = <WasteDumpScreen repository={wasteRepository} onBack={() => setScreen('home')} />;
  } else if (screen === 'quickText') {
    content = <QuickTextScreen repository={quickTextRepository} onBack={() => setScreen('home')} />;
  } else {
    content = <SettingsScreen repository={profileRepository} demoRepository={loadRepository} onBack={() => setScreen('home')} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <View style={styles.shell}>{content}</View>
      <View style={styles.nav}>
        <NavButton label="Home" active={screen === 'home'} onPress={() => setScreen('home')} />
        <NavButton label="Loads" active={screen === 'loads'} onPress={() => setScreen('loads')} />
        <NavButton
          label="Reports"
          active={screen === 'reports'}
          onPress={() => setScreen('reports')}
        />
        <NavButton
          label="Settings"
          active={screen === 'settings'}
          onPress={() => setScreen('settings')}
        />
      </View>
    </SafeAreaView>
  );
}

function ReceiptEntrance({children}:{children:ReactNode}) {
  const progress=useState(()=>new Animated.Value(0))[0];
  useEffect(()=>{const animation=Animated.spring(progress,{toValue:1,useNativeDriver:true,speed:18,bounciness:3});animation.start();return()=>animation.stop();},[progress]);
  return <View style={styles.receiptStage}><Animated.View style={[styles.receiptPage,{opacity:progress.interpolate({inputRange:[0,.18,1],outputRange:[.35,.8,1]}),transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[90,0]})},{scale:progress.interpolate({inputRange:[0,1],outputRange:[.94,1]})}]}]}>{children}</Animated.View></View>;
}

function NavButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navButton} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text>
      {active ? <View style={styles.navIndicator} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  shell: { flex: 1 },
  receiptStage: { flex: 1, backgroundColor: colors.brand, overflow: 'hidden' },
  receiptPage: { flex: 1, backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  nav: {
    minHeight: 68,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  navButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  navLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  navLabelActive: { color: colors.brandDark },
  navIndicator: { width: 32, height: 3, borderRadius: 2, backgroundColor: colors.brand },
});
