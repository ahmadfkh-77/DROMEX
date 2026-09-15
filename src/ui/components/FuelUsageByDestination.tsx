import {useMemo,useState} from 'react';
import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {fillCostLabel,fuelDestinationLabels,fuelTypeLabels,fuelUsageCostLabel,groupFuelUsageByDestination,type FuelDestinationFilter,type FuelDestinationType,type FuelDestinationUsage,type FuelMovement} from '../../domain/fuel';
import {colors,radius} from '../theme';
import {AppButton,AppCard,AppField,EmptyState,Feedback,MetricCard} from './AppPrimitives';
import {useReducedMotion} from './ExpandableMenu';

const filters:{id:FuelDestinationFilter;label:string}[]=[{id:'all',label:'All'},{id:'project',label:'Projects'},{id:'company_site',label:'Company Sites'},{id:'unassigned',label:'Unassigned'}];
const typeColor:Record<FuelDestinationType,string>={project:colors.navy,company_site:colors.brandDark,unassigned:colors.warning};
const litres=(value:number)=>`${value.toFixed(2)} L`;
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;

/**
 * DEC-438. Every active equipment fill, grouped by project, company site, and Unassigned. Blocks start
 * closed; opening one lists the fills that used that destination's fuel.
 */
export function FuelUsageByDestination({movements,onSelectFill}:{movements:FuelMovement[];onSelectFill:(fill:FuelMovement)=>void}){
  const[filter,setFilter]=useState<FuelDestinationFilter>('all');
  const[query,setQuery]=useState('');
  const[open,setOpen]=useState<Set<string>>(new Set());
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  const review=useMemo(()=>groupFuelUsageByDestination(movements,{filter,query}),[filter,movements,query]);
  const hasAnyFill=useMemo(()=>movements.some(value=>value.type==='fill'&&value.status==='Active'),[movements]);
  const {totals}=review;
  const toggle=(key:string)=>{animate();setOpen(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});};
  const chooseFilter=(next:FuelDestinationFilter)=>{animate();setFilter(next);};

  return <>
    <AppCard title="Fuel Usage by Destination" hint="Equipment fills grouped by where the fuel went. Purchases and tank readings are not included. Fills without a saved price add litres but no cost.">
      <View style={styles.metrics}>
        <MetricCard label={filter==='all'&&!query.trim()?'Litres used':'Litres shown'} value={litres(totals.totalLitres)} accent/>
        <MetricCard label="Priced cost" value={fuelUsageCostLabel({pricedCostUsd:totals.pricedCostUsd,pricedFillCount:totals.fillCount-totals.unpricedFillCount})}/>
      </View>
      {totals.unpricedLitres>0?<Feedback kind="warning">{litres(totals.unpricedLitres)} from {plural(totals.unpricedFillCount,'fill')} has no saved price, so it is not in the cost.</Feedback>:null}
      <Text style={styles.filterLabel}>Show</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Destinations to show">
        {filters.map(option=>{const selected=filter===option.id;return <TouchableOpacity key={option.id} style={[styles.chip,selected&&styles.chipOn]} onPress={()=>chooseFilter(option.id)} accessibilityRole="radio" accessibilityState={{checked:selected}}><Text style={[styles.chipText,selected&&styles.chipTextOn]}>{option.label}</Text></TouchableOpacity>;})}
      </View>
      <AppField label="Search destinations, equipment, or notes" value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" accessibilityHint="Narrows the destinations below as you type"/>
    </AppCard>

    {!hasAnyFill?<EmptyState title="No equipment fills yet" body="Record an equipment fill and choose its fuel destination. Usage for each project, company site, and Unassigned appears here."/>
      :review.groups.length===0?<View style={styles.emptyWrap}>
        <EmptyState title={query.trim()?`Nothing matches "${query.trim()}"`:`No ${filters.find(option=>option.id===filter)?.label.toLowerCase()} fuel usage`} body={query.trim()?'Check the spelling, or search for a destination, machine, truck, or note.':'Fills recorded to this kind of destination will be grouped here.'}/>
        {query.trim()?<AppButton label="Clear Search" tone="secondary" onPress={()=>setQuery('')}/>:null}
      </View>
      :<View style={styles.list}>
        <Text style={styles.sectionTitle}>{plural(review.groups.length,'destination')}</Text>
        {review.groups.map(group=><DestinationBlock key={group.key} group={group} isOpen={open.has(group.key)} onToggle={()=>toggle(group.key)} onSelectFill={onSelectFill}/>)}
      </View>}
  </>;
}

function DestinationBlock({group,isOpen,onToggle,onSelectFill}:{group:FuelDestinationUsage;isOpen:boolean;onToggle:()=>void;onSelectFill:(fill:FuelMovement)=>void}){
  const cost=fuelUsageCostLabel(group);
  const typeLabel=fuelDestinationLabels[group.destinationType];
  const fuelTypes=(Object.keys(group.fuelTypes) as (keyof typeof group.fuelTypes)[]).filter(type=>group.fuelTypes[type].fillCount>0);
  return <View style={[styles.block,group.destinationType==='unassigned'&&styles.blockUnassigned]}>
    <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={.75} accessibilityRole="button" accessibilityState={{expanded:isOpen}} accessibilityLabel={`${group.name}, ${typeLabel}${group.isActive?'':', inactive'}. ${litres(group.totalLitres)} from ${plural(group.fillCount,'fill')}. ${cost}.`} accessibilityHint={isOpen?'Hides the fills':'Shows the fills'}>
      <View style={styles.flex}>
        <View style={styles.tagRow}>
          <Text style={[styles.type,{color:typeColor[group.destinationType]}]}>{typeLabel}</Text>
          {group.isActive?null:<Text style={styles.inactive}>Inactive</Text>}
        </View>
        <Text style={styles.name}>{group.name}</Text>
        <Text style={styles.meta}>{plural(group.fillCount,'fill')}   {cost}</Text>
        {group.unpricedLitres>0&&group.pricedFillCount>0?<Text style={styles.unpriced}>{litres(group.unpricedLitres)} unpriced, not in cost</Text>:null}
      </View>
      <Text style={styles.total}>{litres(group.totalLitres)}</Text>
      <Text style={styles.fold}>{isOpen?'×':'+'}</Text>
    </TouchableOpacity>
    {isOpen?<View style={styles.body}>
      <View style={styles.breakdown}>
        {fuelTypes.map(type=><View key={type} style={styles.breakdownItem}><Text style={styles.breakdownLabel}>{fuelTypeLabels[type]}</Text><Text style={styles.breakdownValue}>{litres(group.fuelTypes[type].litres)}</Text><Text style={styles.breakdownMeta}>{plural(group.fuelTypes[type].fillCount,'fill')}</Text></View>)}
        {group.unpricedFillCount>0?<View style={styles.breakdownItem}><Text style={styles.breakdownLabel}>Unpriced</Text><Text style={[styles.breakdownValue,styles.unpricedValue]}>{litres(group.unpricedLitres)}</Text><Text style={styles.breakdownMeta}>{plural(group.unpricedFillCount,'fill')}</Text></View>:null}
      </View>
      {group.fills.map(fill=><TouchableOpacity key={fill.id} style={styles.fill} onPress={()=>onSelectFill(fill)} activeOpacity={.75} accessibilityRole="button" accessibilityLabel={`${fill.equipmentName??'Unknown equipment'}, ${new Date(fill.confirmedAt).toLocaleDateString()}, ${fuelTypeLabels[fill.fuelType]}, ${litres(fill.litres)}, ${fillCostLabel(fill)}`} accessibilityHint="Opens this fill to review, correct, or cancel it">
        <View style={styles.flex}>
          <Text style={styles.fillTitle}>{fill.equipmentName??'Unknown equipment'}</Text>
          <Text style={styles.meta}>{new Date(fill.confirmedAt).toLocaleString()}   {fuelTypeLabels[fill.fuelType]}</Text>
          <Text style={[styles.cost,fill.consumptionCostUsd==null&&styles.costMissing]}>{fill.pricePerLitreUsd==null?'Unpriced':`$${fill.pricePerLitreUsd.toFixed(2)}/L`}   {fillCostLabel(fill)}</Text>
          {fill.notes?<Text style={styles.notes} numberOfLines={2}>{fill.notes}</Text>:null}
          {fill.correctionHistory.length?<Text style={styles.corrected}>Corrected {fill.correctionHistory.length===1?'once':`${fill.correctionHistory.length} times`}</Text>:null}
        </View>
        <Text style={styles.fillLitres}>{litres(fill.litres)}</Text>
      </TouchableOpacity>)}
    </View>:null}
  </View>;
}

const styles=StyleSheet.create({
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:10},
  filterLabel:{color:colors.ink,fontSize:13,fontWeight:'800'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:{minHeight:48,justifyContent:'center',borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface,borderRadius:24,paddingHorizontal:16},
  chipOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  chipText:{color:colors.ink,fontSize:13,fontWeight:'800'},
  chipTextOn:{color:'#FFF'},
  emptyWrap:{gap:10},
  list:{gap:10},
  sectionTitle:{color:colors.ink,fontSize:19,fontWeight:'900'},
  block:{backgroundColor:colors.surface,borderRadius:radius.lg,borderWidth:1,borderColor:colors.line,overflow:'hidden'},
  blockUnassigned:{backgroundColor:colors.cream,borderColor:'#E8DED0'},
  header:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:15,paddingVertical:14},
  flex:{flex:1,minWidth:0},
  tagRow:{flexDirection:'row',alignItems:'center',gap:8},
  type:{fontSize:12,fontWeight:'900'},
  inactive:{color:colors.muted,fontSize:11,fontWeight:'900',borderWidth:1,borderColor:colors.line,borderRadius:8,paddingHorizontal:6,paddingVertical:1},
  name:{color:colors.ink,fontSize:17,fontWeight:'900',marginTop:2},
  meta:{color:colors.muted,fontSize:13,lineHeight:19},
  unpriced:{color:colors.warning,fontSize:12,fontWeight:'800',marginTop:2},
  total:{color:colors.navy,fontSize:16,fontWeight:'900'},
  fold:{color:colors.brand,fontSize:24,fontWeight:'900',width:24,textAlign:'center'},
  body:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},
  breakdown:{flexDirection:'row',flexWrap:'wrap',gap:8,padding:12,backgroundColor:colors.background},
  breakdownItem:{minWidth:96,flexGrow:1,padding:10,borderRadius:radius.sm,backgroundColor:colors.surface},
  breakdownLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  breakdownValue:{color:colors.ink,fontSize:15,fontWeight:'900',marginTop:2},
  unpricedValue:{color:colors.warning},
  breakdownMeta:{color:colors.muted,fontSize:11},
  fill:{minHeight:48,flexDirection:'row',alignItems:'flex-start',gap:10,paddingHorizontal:15,paddingVertical:12,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,backgroundColor:colors.surface},
  fillTitle:{color:colors.ink,fontSize:15,fontWeight:'900'},
  cost:{color:colors.brandDark,fontSize:13,fontWeight:'900',marginTop:3},
  costMissing:{color:colors.warning},
  notes:{color:colors.ink,fontSize:13,lineHeight:18,marginTop:3},
  corrected:{color:colors.warning,fontSize:12,fontWeight:'800',marginTop:3},
  fillLitres:{color:colors.navy,fontSize:15,fontWeight:'900'},
});
