import {useCallback,useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {WasteRepository} from '../../data/repositories/WasteRepository';
import {buildWasteHistory,dumpsText,wasteRangeFor,wasteRangeLabel,type WasteDriverLine,type WasteHistoryRow,type WasteProjectBlock,type WastePreset} from '../../domain/wasteHistory';
import {exportAndShareWasteHistory} from '../../services/documentExport';
import {colors,radius} from '../theme';
import {AppButton,AppCard,EmptyState,Feedback} from './AppPrimitives';
import {DatePickerField,todayIso} from './DatePickerField';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';
import {useExportHeader} from './useExportHeader';

/**
 * Waste Dump History: every project in one place, grouped by day (newest first, the newest day open), each day showing each
 * project with its location, each driver's dumps and the project total, then the period totals per driver. Filters are This
 * week (Monday to Sunday), This month, or a custom range, and one project or all. Every number is a count of dumps. Cancelled
 * dumps are never counted. This view only reads records.
 */
function Drivers({drivers,totalLabel,total}:{drivers:WasteDriverLine[];totalLabel:string;total:number}){
  return <View style={styles.drivers}>
    {drivers.map(driver=><View key={driver.key} style={styles.line}><Text style={styles.driver}>{driver.name}</Text><Text style={styles.count}>{driver.count}</Text></View>)}
    <View style={[styles.line,styles.totalLine]}><Text style={styles.totalLabel}>{totalLabel}</Text><Text style={styles.totalCount}>{total}</Text></View>
  </View>;
}
function ProjectBlock({block}:{block:WasteProjectBlock}){
  const totalLabel=block.locationType==='company_site'?'Site total':'Project total';
  return <View style={styles.project}>
    <Text style={styles.typeWord}>{block.locationType==='company_site'?'COMPANY SITE':'PROJECT'}</Text>
    <Text style={styles.projectName}>{block.projectName}</Text>
    {block.location?<Text style={styles.location}>{block.location}</Text>:null}
    <Drivers drivers={block.drivers} totalLabel={totalLabel} total={block.total}/>
  </View>;
}

export function WasteHistoryView({repository,locations,initialLocationKey}:{repository:WasteRepository;/** Every project and company site, each with a key like project:<id> or site:<id>. */locations:{id:string;label:string;detail?:string}[];initialLocationKey?:string}){
  const[preset,setPreset]=useState<WastePreset>('week'),[customFrom,setCustomFrom]=useState(''),[customTo,setCustomTo]=useState(''),[scopeKey,setScopeKey]=useState(initialLocationKey??'');
  const[rows,setRows]=useState<WasteHistoryRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const[closedDays,setClosedDays]=useState<Record<string,boolean>>({}),[openDays,setOpenDays]=useState<Record<string,boolean>>({});
  const{picker,resolve}=useExportHeader(scopeKey.startsWith('project:')?scopeKey.slice(8):null);
  const range=useMemo(()=>wasteRangeFor(preset,todayIso(),{fromDate:customFrom,toDate:customTo}),[preset,customFrom,customTo]);
  const load=useCallback(async()=>{setLoading(true);setError(null);try{setRows(await repository.listWasteHistory(range.fromDate,range.toDate));}catch(cause){setError(cause instanceof Error?cause.message:'Could not load the waste history.');}finally{setLoading(false);}},[range.fromDate,range.toDate,repository]);
  useEffect(()=>{void load();},[load]);
  const history=useMemo(()=>buildWasteHistory(rows,range,scopeKey||undefined),[rows,range,scopeKey]);
  // The newest day is open; every other day is closed until tapped. A tap on any day flips it from its default.
  const isOpen=(day:string,index:number)=>index===0?!closedDays[day]:!!openDays[day];
  const toggle=(day:string,index:number)=>{if(index===0)setClosedDays(current=>({...current,[day]:!current[day]}));else setOpenDays(current=>({...current,[day]:!current[day]}));};
  const showAllDrivers=history.periodProjects.length>1;
  const projectLabel=scopeKey?locations.find(location=>location.id===scopeKey)?.label??'Selected location':'All locations';
  const run=async()=>{
    setBusy(true);setError(null);setMessage(null);
    try{
      const[chosen,identity]=await Promise.all([resolve(),repository.getCompanyIdentity()]);
      const company=chosen?{name:chosen.list.companyName,logoUri:chosen.list.logoUri,contactLine:chosen.list.contactLine}:identity;
      await exportAndShareWasteHistory({companyName:company.name,logoUri:company.logoUri,contactLine:company.contactLine,generatedAt:new Date().toISOString(),projectLabel,periodLabel:wasteRangeLabel(range),history,includeAllProjectsDriverTotals:showAllDrivers,fileName:`DROMEX-Waste-Dump-History-${range.fromDate.startsWith('0000')?'all':range.fromDate}.pdf`});
      setMessage('Waste Dump History PDF ready to share.');
    }catch(cause){setError(cause instanceof Error?cause.message:'The PDF could not be created.');}
    finally{setBusy(false);}
  };
  return <View style={styles.wrap}>
    <AppCard title="Waste Dump History" hint="Every number is a count of dumps. Cancelled dumps are not counted.">
      <SegmentedChoice label="Period" options={[{id:'week',label:'This week'},{id:'month',label:'This month'},{id:'custom',label:'Custom'}]} selectedId={preset} onSelect={setPreset} mode="tabs"/>
      {preset==='custom'?<View style={styles.pair}><View style={styles.flex}><DatePickerField label="From" value={customFrom} onChange={setCustomFrom} maxDate={customTo||todayIso()} allowClear placeholder="Any date"/></View><View style={styles.flex}><DatePickerField label="To" value={customTo} onChange={setCustomTo} allowClear placeholder="Any date"/></View></View>:null}
      <SearchableSelect label="Location" options={locations} selectedId={scopeKey} onSelect={setScopeKey} placeholder="All locations" allowClear/>
      <Text style={styles.muted}>{wasteRangeLabel(range)} · {projectLabel}</Text>
    </AppCard>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    {loading?<Text style={styles.muted}>Loading the waste history…</Text>:!history.days.length?<EmptyState title="No waste dumps in this period" body="Change the period or the location. Cancelled dumps are not listed."/>:<>
      <View style={styles.summaryRow}><Text style={styles.summaryText}>{dumpsText(history.total)} · {history.days.length} day{history.days.length===1?'':'s'}</Text>{history.cancelledCount?<Text style={styles.muted}>{history.cancelledCount} cancelled not counted</Text>:null}</View>
      {history.days.map((day,index)=>{const open=isOpen(day.day,index);return <View key={day.day} style={styles.day}>
        <TouchableOpacity style={styles.dayBar} onPress={()=>toggle(day.day,index)} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${day.label}, ${dumpsText(day.total)}`}>
          <Text style={styles.mark} importantForAccessibility="no">{open?'−':'+'}</Text><Text style={styles.dayName}>{day.label}</Text><Text style={styles.dayTotal}>{dumpsText(day.total)}</Text>
        </TouchableOpacity>
        {open?<View style={styles.dayBody}>{day.projects.map(block=><ProjectBlock key={block.locationKey} block={block}/>)}</View>:null}
      </View>;})}
      <AppCard title="Period totals per driver" hint={wasteRangeLabel(range)}>
        {history.periodProjects.map(block=><ProjectBlock key={block.locationKey} block={block}/>)}
      </AppCard>
      {showAllDrivers?<AppCard title="Each driver, all locations"><Drivers drivers={history.periodDrivers} totalLabel="All drivers" total={history.total}/></AppCard>:null}
      {picker}
      <AppButton label="Export Waste Dump History PDF" tone="secondary" busy={busy} onPress={()=>void run()}/>
    </>}
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:12},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  muted:{color:colors.muted,fontSize:12},
  summaryRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:4},
  summaryText:{color:colors.navy,fontSize:15,fontWeight:'900'},
  day:{borderWidth:1,borderColor:colors.line,borderRadius:radius.lg,backgroundColor:colors.surface,overflow:'hidden'},
  dayBar:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:14,minHeight:48,backgroundColor:colors.creamSoft},
  mark:{color:colors.navy,fontSize:20,fontWeight:'900',width:18,textAlign:'center'},
  dayName:{flex:1,color:colors.navy,fontSize:15,fontWeight:'900'},
  dayTotal:{color:colors.navy,fontSize:14,fontWeight:'900'},
  dayBody:{padding:14,gap:14},
  project:{gap:2},
  typeWord:{color:colors.navy,fontSize:10,fontWeight:'900',letterSpacing:1.2},
  projectName:{color:colors.projectName,fontSize:16,fontWeight:'900'},
  location:{color:colors.muted,fontSize:13},
  drivers:{marginTop:6,gap:4},
  line:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,paddingVertical:4},
  driver:{flex:1,color:colors.ink,fontSize:14},
  count:{color:colors.ink,fontSize:14,fontWeight:'800',minWidth:28,textAlign:'right'},
  totalLine:{borderTopWidth:1,borderTopColor:colors.navy,marginTop:2},
  totalLabel:{flex:1,color:colors.navy,fontSize:14,fontWeight:'900'},
  totalCount:{color:colors.navy,fontSize:14,fontWeight:'900',minWidth:28,textAlign:'right'},
});
