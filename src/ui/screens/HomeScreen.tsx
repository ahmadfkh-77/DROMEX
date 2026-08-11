import {ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {colors} from '../theme';

type HomeProps={onMakeReceipt:()=>void;onOpenLoads:()=>void;onOpenReceiptSetup:()=>void;onOpenDirectory:()=>void;onOpenCustomers:()=>void;onOpenCatalog:()=>void;onOpenReports:()=>void;onOpenQuarry:()=>void;onOpenProjects:()=>void;onOpenFinancials:()=>void;onOpenWaste:()=>void;onOpenLoadCorrections:()=>void;onOpenSettings:()=>void};

export function HomeScreen({onMakeReceipt,onOpenLoads,onOpenReceiptSetup,onOpenDirectory,onOpenCustomers,onOpenCatalog,onOpenReports,onOpenQuarry,onOpenProjects,onOpenFinancials,onOpenWaste,onOpenLoadCorrections,onOpenSettings}:HomeProps){return <ScrollView contentContainerStyle={styles.content}>
  <View style={styles.header}><View><Text style={styles.eyebrow}>PLANT MANAGEMENT</Text><Text style={styles.title}>DROMEX</Text></View><View style={styles.offlineBadge}><View style={styles.offlineDot}/><Text style={styles.offlineText}>Works offline</Text></View></View>
  <TouchableOpacity style={styles.primaryAction} accessibilityRole="button" onPress={onMakeReceipt}><Text style={styles.primaryEyebrow}>NEW OUTGOING LOAD</Text><Text style={styles.primaryActionLabel}>Make Receipt</Text><Text style={styles.primaryActionHint}>Enter the load once, calculate it, preview both documents, and confirm.</Text></TouchableOpacity>

  <ActionSection title="Daily operations" hint="Use these while site or plant work is happening.">
    <QuickAction number="01" title="Waste Dump Tracking" body="Tap once per waste truck, then add material and destination details." onPress={onOpenWaste}/>
    <QuickAction number="02" title="Quarry purchases" body="Record incoming supplier deliveries, tickets, photos, price, and VAT." onPress={onOpenQuarry}/>
    <QuickAction number="03" title="Daily project reports" body="Record work, people, equipment, loads, waste dumps, notes, and photos." onPress={onOpenReports}/>
  </ActionSection>

  <ActionSection title="Records" hint="Find confirmed work and maintain reusable information.">
    <QuickAction number="01" title="Load History" body="Open confirmed loads, documents, signatures, payment status, and PDFs." onPress={onOpenLoads}/>
    <QuickAction number="02" title="Customers" body="Search customers and review their order, payment, and balance summaries." onPress={onOpenCustomers}/>
    <QuickAction number="03" title="Projects" body="Create projects, manage Active or Completed status, and review details." onPress={onOpenProjects}/>
    <QuickAction number="04" title="People & equipment" body="Manage workers, drivers, trucks, and machines used in dropdowns." onPress={onOpenDirectory}/>
  </ActionSection>

  <ActionSection title="Reports & finance" hint="Review results, money, exports, and corrections.">
    <QuickAction number="01" title="Reports center" body="Choose a project, open daily history, and create detailed PDF reports." onPress={onOpenReports}/>
    <QuickAction number="02" title="Payments & balances" body="Record payments, opening balances, remaining amounts, and cancellations." onPress={onOpenFinancials}/>
    <QuickAction number="03" title="Correct confirmed loads" body="Correct allowed values while preserving transaction identity and payments." onPress={onOpenLoadCorrections}/>
  </ActionSection>

  <ActionSection title="Setup" hint="Configure choices used when creating future records.">
    <QuickAction number="01" title="Item catalog" body="Create categories and items for loads, quarry purchases, and reports." onPress={onOpenCatalog}/>
    <QuickAction number="02" title="Receipt setup" body="Manage measurement units, conversions, and receipt-related choices." onPress={onOpenReceiptSetup}/>
    <QuickAction number="03" title="Company & VAT" body="Set company identity, logo, contact details, footer, and VAT rate." onPress={onOpenSettings}/>
  </ActionSection>
</ScrollView>;}

function ActionSection({title,hint,children}:{title:string;hint:string;children:React.ReactNode}){return <View style={styles.section}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionHint}>{hint}</Text></View><View style={styles.actionList}>{children}</View></View>;}
function QuickAction({number,title,body,onPress}:{number:string;title:string;body:string;onPress:()=>void}){return <TouchableOpacity style={styles.quickAction} onPress={onPress} accessibilityRole="button"><Text style={styles.actionNumber}>{number}</Text><View style={styles.actionCopy}><Text style={styles.quickActionTitle}>{title}</Text><Text style={styles.quickActionBody}>{body}</Text></View><Text style={styles.chevron}>›</Text></TouchableOpacity>;}

const styles=StyleSheet.create({content:{padding:20,paddingBottom:40,gap:22},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},eyebrow:{color:colors.brand,fontWeight:'900',fontSize:11,letterSpacing:1.6},title:{color:colors.ink,fontSize:34,lineHeight:40,fontWeight:'900',letterSpacing:-1},offlineBadge:{flexDirection:'row',alignItems:'center',gap:7,paddingHorizontal:11,paddingVertical:8,borderRadius:18,backgroundColor:'#E5F3EC'},offlineDot:{width:8,height:8,borderRadius:4,backgroundColor:colors.success},offlineText:{color:colors.success,fontSize:12,fontWeight:'800'},primaryAction:{backgroundColor:colors.brand,borderRadius:19,padding:21,gap:5},primaryEyebrow:{color:'#F7D9D1',fontSize:10,fontWeight:'900',letterSpacing:1.2},primaryActionLabel:{color:'#FFF',fontSize:25,fontWeight:'900'},primaryActionHint:{color:'#F7D9D1',fontSize:13,lineHeight:18},section:{gap:10},sectionHeader:{gap:3},sectionTitle:{color:colors.ink,fontWeight:'900',fontSize:20},sectionHint:{color:colors.muted,fontSize:12,lineHeight:17},actionList:{backgroundColor:colors.surface,borderRadius:17,overflow:'hidden'},quickAction:{minHeight:82,flexDirection:'row',alignItems:'center',gap:12,padding:14,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},actionNumber:{width:28,color:colors.brand,fontSize:11,fontWeight:'900'},actionCopy:{flex:1,gap:3},quickActionTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},quickActionBody:{color:colors.muted,fontSize:12,lineHeight:17},chevron:{color:colors.brandDark,fontSize:27,fontWeight:'700'}});
