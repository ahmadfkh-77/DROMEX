import {useEffect,useState,type ReactNode} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';

import {localTime,materialView,type CompanyDailyReport,type DayPlace,type DaySection} from '../../domain/companyDailyReport';
import {formatTotalQuantity} from '../../domain/projectTotals';
import {AppButton,AppCard,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import type {ProfileRepository} from '../../data/repositories/ProfileRepository';
import {exportAndShareCompanyDailyReport} from '../../services/documentExport';
import {useExportHeader} from '../components/useExportHeader';
import {tileLabel,tileText} from '../components/CompanyDailyReportCard';
import {DatePickerField} from '../components/DatePickerField';
import {colors} from '../theme';

export type DayRecordRef={kind:'company_load'|'supplier_load';id:string;title:string;subtitle:string;date:string;projectId:string|null};

const two=(value:number)=>String(value).padStart(2,'0');
export const todayKey=(now:Date=new Date())=>`${now.getFullYear()}-${two(now.getMonth()+1)}-${two(now.getDate())}`;
const dash=(value:string|null|undefined)=>value&&value.trim()?value:'-';
const kg=(value:number|null)=>value===null?'-':`${Math.round(value*1000)/1000} kg`;
const sectionTitle:Record<DaySection,string>={loadsOut:'Company loads out',supplierLoads:'Supplier loads in',fills:'Fuel given',dumps:'Waste dumps'};

/** One folding block with the +/× toggle used across DROMEX. Fold state belongs to the screen only; it never changes an export. */
function Fold({title,hint,open,onToggle,children,nested=false}:{title:string;hint?:string;open:boolean;onToggle:()=>void;children:ReactNode;nested?:boolean}){
  return <View style={nested?styles.section:styles.place}>
    <Pressable onPress={onToggle} style={styles.foldHeader} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${title}${hint?`, ${hint}`:''}. ${open?'Fold':'Unfold'}`}>
      <View style={styles.foldCopy}><Text style={nested?styles.sectionTitle:styles.placeTitle}>{title}</Text>{hint?<Text style={styles.hint}>{hint}</Text>:null}</View>
      <Text style={styles.foldMark}>{open?'×':'+'}</Text>
    </Pressable>
    {open?<View style={styles.foldBody}>{children}</View>:null}
  </View>;
}

type Column={title:string;flex:number;align?:'left'|'right'};
/** A bordered table with a navy header row and shaded alternate rows. A row with an onPress opens that record. */
function Table({columns,rows,total}:{columns:Column[];rows:{key:string;cells:string[];onPress?:()=>void}[];total?:string[]}){
  return <View style={styles.table}>
    <View style={styles.tr}>{columns.map((c,i)=><Text key={i} style={[styles.th,{flex:c.flex},i>0&&styles.cellLeft,c.align==='right'&&styles.right]}>{c.title}</Text>)}</View>
    {rows.map((row,r)=><Pressable key={row.key} disabled={!row.onPress} onPress={row.onPress} accessibilityRole={row.onPress?'button':undefined} accessibilityLabel={row.onPress?`Open record. ${row.cells.join(', ')}`:undefined} style={[styles.tr,r%2===1&&styles.alt]}>
      {row.cells.map((cell,i)=><Text key={i} style={[styles.td,{flex:columns[i]!.flex},i>0&&styles.cellLeft,columns[i]!.align==='right'&&styles.right]}>{cell}{row.onPress&&i===row.cells.length-1?'  ›':''}</Text>)}
    </Pressable>)}
    {total?<View style={[styles.tr,styles.totalRow]}>{total.map((cell,i)=><Text key={i} style={[styles.td,styles.totalText,{flex:columns[i]!.flex},i>0&&styles.cellLeft,columns[i]!.align==='right'&&styles.right]}>{cell}</Text>)}</View>:null}
  </View>;
}

function PlaceTables({place,open,toggle,keyOf,onOpenRecord}:{place:DayPlace;open:(key:string)=>boolean;toggle:(key:string)=>void;keyOf:(section:DaySection)=>string;onOpenRecord:(ref:DayRecordRef)=>void}){
  return <>
    {place.sections.map(section=><Fold key={section} nested title={sectionTitle[section]} hint={`${place[section].length}`} open={open(keyOf(section))} onToggle={()=>toggle(keyOf(section))}>
      {section==='loadsOut'?<Table columns={[{title:'Time',flex:1},{title:'No.',flex:1.5},{title:'Item',flex:1.4},{title:'Qty',flex:1.2},{title:'Bitumen',flex:1.3},{title:'Truck / driver',flex:1.8}]}
        rows={place.loadsOut.map(l=>({key:l.id,cells:[localTime(l.time),dash(l.loadNumber),l.itemName,formatTotalQuantity(l.quantity,l.unitSymbol),kg(l.bitumenKg),`${dash(l.truckPlate)} / ${dash(l.driverName)}`],
          onPress:()=>onOpenRecord({kind:'company_load',id:l.id,title:l.loadNumber??'Load',subtitle:l.itemName,date:l.time,projectId:l.projectId})}))}/>:null}
      {section==='supplierLoads'?<Table columns={[{title:'Time',flex:1},{title:'No.',flex:1.3},{title:'Item',flex:1.3},{title:'Supplier',flex:1.5},{title:'Qty',flex:1.2},{title:'By',flex:1.2},{title:'Ticket',flex:1.2}]}
        rows={place.supplierLoads.map(l=>({key:l.id,cells:[localTime(l.time),dash(l.number),l.itemName,dash(l.supplierName),formatTotalQuantity(l.quantity,l.unitSymbol),l.deliveredBy==='supplier'?'Supplier':l.deliveredBy==='company'?'Our driver':'-',dash(l.ticket)],
          onPress:()=>onOpenRecord({kind:'supplier_load',id:l.id,title:l.number??'Supplier Load',subtitle:`${dash(l.supplierName)} · ${l.itemName}`,date:l.time,projectId:l.projectId})}))}/>:null}
      {section==='fills'?<Table columns={[{title:'Time',flex:1},{title:'Given to',flex:2},{title:'Type',flex:1.2},{title:'Litres',flex:1.2,align:'right'}]}
        rows={place.fills.map(f=>({key:f.id,cells:[localTime(f.time),f.givenTo,f.fuelType,`${Math.round(f.litres*1000)/1000} L`]}))}
        total={['','','Total',`${Math.round(place.fills.reduce((sum,f)=>sum+f.litres,0)*1000)/1000} L`]}/>:null}
      {section==='dumps'?<Table columns={[{title:'Time',flex:1},{title:'Material',flex:1.4},{title:'Area',flex:1.4},{title:'Truck / driver',flex:1.8}]}
        rows={place.dumps.map(d=>({key:d.id,cells:[localTime(d.time),dash(d.material),dash(d.area),`${dash(d.truckPlate)} / ${dash(d.driverName)}`]}))}
        total={['','','Trips',`${place.dumps.length}`]}/>:null}
    </Fold>)}
  </>;
}

/**
 * Company Daily Report, phase 1: the preview for one day. Read-only; every place card and section folds with +/×,
 * closed by default except the first place with records. Fold state is screen state only.
 */
export function CompanyDailyReportScreen({profiles,day,onDayChange,loadDay,onBack,onOpenRecord}:{/** Kept by the app so Back from a record returns to the same day. */day:string;onDayChange:(day:string)=>void;profiles:Pick<ProfileRepository,'getCompanySettings'>;loadDay:(day:string)=>Promise<CompanyDailyReport>;onBack:()=>void;onOpenRecord:(ref:DayRecordRef)=>void}){
  const[state,setState]=useState<{status:'loading'|'error'|'ready';report?:CompanyDailyReport}>({status:'loading'});
  const[override,setOverride]=useState<Record<string,boolean>>({});
  const[material,setMaterial]=useState<{itemName:string;unitSymbol:string}|null>(null);
  const[attempt,setAttempt]=useState(0);
  const exportHeader=useExportHeader(null);
  const[exporting,setExporting]=useState(false);const[exportError,setExportError]=useState<string|null>(null);
  /** The PDF always prints everything, open: it is built from the report, never from what is folded on screen. */
  const exportPdf=async()=>{if(!state.report)return;setExporting(true);setExportError(null);try{const[company,chosen]=await Promise.all([profiles.getCompanySettings(),exportHeader.resolve()]);await exportAndShareCompanyDailyReport({report:state.report,logoUri:chosen?chosen.list.logoUri:company.logoUri});}catch(error){setExportError(error instanceof Error?error.message:'The PDF could not be created.');}finally{setExporting(false);}};
  useEffect(()=>{let active=true;setState({status:'loading'});setOverride({});setMaterial(null);
    void loadDay(day).then(report=>{if(active)setState({status:'ready',report});}).catch(()=>{if(active)setState({status:'error'});});
    return()=>{active=false;};},[day,attempt,loadDay]);

  const report=state.report;const firstKey=report?.places[0]?.key??'';
  const isOpen=(key:string)=>key in override?override[key]!:key.split('|')[0]===firstKey;
  const toggle=(key:string)=>setOverride(current=>({...current,[key]:!isOpen(key)}));
  const setAll=(value:boolean)=>setOverride(Object.fromEntries((report?.places??[]).flatMap(p=>[[p.key,value],...p.sections.map(s=>[`${p.key}|${s}`,value])])));
  const view=report&&material?materialView(report,material.itemName,material.unitSymbol):null;

  return <AppPage>
    <PageHeader eyebrow="REPORTS" title={view?`${view.itemName} (${view.unitSymbol})`:'Company Daily Report'} onBack={view?()=>setMaterial(null):onBack}/>
    <DatePickerField label="Day" value={day} onChange={onDayChange}/>
    {state.status==='loading'?<Feedback kind="warning">Reading the records of this day…</Feedback>:null}
    {state.status==='error'?<><Feedback kind="error">The records of this day could not be read.</Feedback><AppButton label="Try again" onPress={()=>setAttempt(v=>v+1)} tone="secondary"/></>:null}
    {report&&report.isEmpty?<EmptyState title="Nothing recorded on this day" body="Loads, supplier loads, fuel and waste dumps recorded for this day appear here. Cancelled records are not shown."/>:null}

    {report&&!report.isEmpty&&view?<>
      <AppCard title="All places" hint="Units are never added together; each unit has its own total.">
        <Table columns={[{title:'',flex:1.6},{title:'Loads',flex:1,align:'right'},{title:'Quantity',flex:1.6,align:'right'}]}
          rows={[...(view.outLoads?[{key:'out',cells:['Out to places',`${view.outLoads}`,formatTotalQuantity(view.outQuantity,view.unitSymbol)]}]:[]),...(view.inLoads?[{key:'in',cells:['Arrived in',`${view.inLoads}`,formatTotalQuantity(view.inQuantity,view.unitSymbol)]}]:[]),...(view.bitumenKg!==null?[{key:'bit',cells:['Bitumen used','',kg(view.bitumenKg)]}]:[])]}/>
      </AppCard>
      {view.places.map(place=><Fold key={place.key} title={place.name} hint={place.kind==='site'?'Company site':place.kind==='project'?'Project':undefined} open={isOpen(place.key)} onToggle={()=>toggle(place.key)}>
        <PlaceTables place={place} open={isOpen} toggle={toggle} keyOf={s=>`${place.key}|${s}`} onOpenRecord={onOpenRecord}/>
      </Fold>)}
    </>:null}

    {report&&!report.isEmpty&&!view?<>
      <AppCard title="Today in total" hint="Only what was recorded. Tap a material to see every record behind it.">
        <View style={styles.tiles}>{report.tiles.map(tile=><View key={tile.key} style={styles.tile}><Text style={styles.tileValue}>{tileText(tile)}</Text><Text style={styles.tileLabel}>{tileLabel[tile.key]}</Text></View>)}</View>
        {report.materials.length?<Table columns={[{title:'Material',flex:1.6},{title:'Out',flex:1.3,align:'right'},{title:'In',flex:1.3,align:'right'}]}
          rows={report.materials.map(m=>({key:`${m.itemName}|${m.unitSymbol}`,cells:[m.itemName,m.outLoads?`${m.outLoads} · ${formatTotalQuantity(m.outQuantity,m.unitSymbol)}`:'-',m.inLoads?`${m.inLoads} · ${formatTotalQuantity(m.inQuantity,m.unitSymbol)}`:'-'],onPress:()=>setMaterial({itemName:m.itemName,unitSymbol:m.unitSymbol})}))}/>:null}
        {report.bitumenKg!==null?<Text style={styles.hint}>Bitumen used by asphalt loads: {kg(report.bitumenKg)}</Text>:null}
      </AppCard>
      <View style={styles.foldAll}><View style={styles.foldAllButton}><AppButton label="Open all" tone="secondary" onPress={()=>setAll(true)}/></View><View style={styles.foldAllButton}><AppButton label="Fold all" tone="secondary" onPress={()=>setAll(false)}/></View></View>
      {report.places.map(place=><Fold key={place.key} title={place.name} hint={place.kind==='site'?'Company site':place.kind==='project'?'Project':'Records without a project or site'} open={isOpen(place.key)} onToggle={()=>toggle(place.key)}>
        <PlaceTables place={place} open={isOpen} toggle={toggle} keyOf={s=>`${place.key}|${s}`} onOpenRecord={onOpenRecord}/>
      </Fold>)}
    </>:null}
    {report&&!report.isEmpty&&!view?<>{exportHeader.picker}{exportError?<Feedback kind="error">{exportError}</Feedback>:null}<AppButton label="Export PDF" onPress={()=>void exportPdf()} busy={exporting} hint="Every place, material and record of this day, all open. Quantities only, no prices."/></>:null}
  </AppPage>;
}

const styles=StyleSheet.create({
  place:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,overflow:'hidden'},
  section:{borderWidth:1,borderColor:colors.line,borderRadius:10,marginTop:8,backgroundColor:colors.surface},
  foldHeader:{flexDirection:'row',alignItems:'center',gap:8,minHeight:52,paddingHorizontal:12,paddingVertical:8},
  foldCopy:{flex:1},placeTitle:{color:colors.navy,fontSize:16,fontWeight:'900'},sectionTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},hint:{color:colors.muted,fontSize:12},
  foldMark:{color:colors.navy,fontSize:24,fontWeight:'800',width:28,textAlign:'center'},foldBody:{paddingHorizontal:10,paddingBottom:10},
  table:{borderWidth:1,borderColor:'#9FB0C2',marginTop:6},tr:{flexDirection:'row'},alt:{backgroundColor:'#F5F8FB'},
  th:{backgroundColor:colors.navy,color:'#FFFFFF',fontSize:10.5,fontWeight:'800',paddingVertical:6,paddingHorizontal:5},
  td:{color:colors.ink,fontSize:11.5,paddingVertical:7,paddingHorizontal:5,borderTopWidth:1,borderTopColor:'#C9D3DE'},
  cellLeft:{borderLeftWidth:1,borderLeftColor:'#C9D3DE'},right:{textAlign:'right'},totalRow:{backgroundColor:'#EEF2F6'},totalText:{fontWeight:'800'},
  tiles:{flexDirection:'row',flexWrap:'wrap',gap:8},tile:{flexGrow:1,minWidth:110,backgroundColor:colors.creamSoft,borderRadius:10,padding:10},
  tileValue:{color:colors.navy,fontSize:20,fontWeight:'900'},tileLabel:{color:colors.muted,fontSize:11,fontWeight:'700',textTransform:'uppercase'},
  foldAll:{flexDirection:'row',gap:8},foldAllButton:{flex:1},
});
