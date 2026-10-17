import {useMemo,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import {formatStockQuantity} from '../../domain/stock';
import {currentVersion,emptyStockRuleDraft,materialForLoad,type StockRule,type StockRuleDraft,type StockRulesSetup} from '../../domain/stockRules';
import {localDateKey} from '../../domain/fuel';
import {AppButton,AppCard,AppField,EmptyState,Feedback} from './AppPrimitives';
import {DatePickerField} from './DatePickerField';
import {SearchableSelect} from './SearchableSelect';
import {colors} from '../theme';

/**
 * Usage rules: which item delivered on receipts takes which Stock materials, and how much of each for one unit of it (7 bags per 1 m³).
 * A rule is never edited in place; saving a change adds a version that applies from the date chosen on the calendar, and loads already
 * counted keep the amounts they were counted with.
 */
const today=()=>localDateKey(new Date());
const amountText=(value:number)=>value.toLocaleString('en-US',{maximumFractionDigits:3});

/** The lines of a rule as words, in the rule's current version: "Cement 350 kg". */
export function ruleLineTexts(rule:StockRule,setup:Pick<StockRulesSetup,'materials'>):string[]{
  const version=currentVersion(rule,today());
  return version?version.lines.map(line=>{const material=setup.materials.find(value=>value.id===line.stockItemId);return `${material?.name??'Material'} ${amountText(line.amount)} ${material?.unitSymbol??''}`.trim();}):[];
}
/** What one Stock item is used for: "350 kg per 1 m³ of Ready-mix C30", one entry per rule that lists it. */
export function itemRuleTexts(itemId:string,rules:readonly StockRule[]):string[]{
  const result:string[]=[];
  for(const rule of rules){
    const version=currentVersion(rule,today());
    const line=version?.lines.find(value=>value.stockItemId===itemId);
    if(version&&line)result.push(`${amountText(line.amount)} per ${amountText(version.perQuantity)} ${rule.unitSymbol} of ${rule.loadItemName}${rule.enabled?'':' (rule off)'}`);
  }
  return result;
}

export function StockRulesList({setup,busy,error,onBack,onNew,onEdit,onToggle}:{setup:StockRulesSetup;busy:boolean;error:string|null;onBack:()=>void;onNew:()=>void;onEdit:(ruleId:string)=>void;onToggle:(rule:StockRule)=>void}){
  return <View style={styles.stack}>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {setup.rules.length?setup.rules.map(rule=>{
      const version=currentVersion(rule,today());
      return <AppCard key={rule.id} title={rule.loadItemName} hint={version?`Per ${amountText(version.perQuantity)} ${rule.unitSymbol} delivered · counting loads from ${rule.versions[0]?.effectiveFrom??''}`:undefined}>
        <Text style={[styles.badge,rule.enabled?styles.badgeOn:styles.badgeOff]}>{rule.enabled?'On':'Off'}</Text>
        {ruleLineTexts(rule,setup).map(text=><Text key={text} style={styles.line}>{text}</Text>)}
        <AppButton label="Edit rule" tone="secondary" onPress={()=>onEdit(rule.id)}/>
        <AppButton label={rule.enabled?'Turn the rule off':'Turn the rule on'} tone="secondary" busy={busy} onPress={()=>onToggle(rule)}/>
      </AppCard>;
    }):<EmptyState title="No rules yet" body="An item without a rule stays inventory only: you record its use by hand. Add a rule to take materials out of Stock for you from confirmed loads."/>}
    <AppButton label="+ New rule" onPress={onNew}/>
    <AppButton label="Back to Stock" tone="secondary" onPress={onBack}/>
  </View>;
}

export function StockRuleForm({setup,rule,busy,error,onSave,onBack}:{setup:StockRulesSetup;rule:StockRule|null;busy:boolean;error:string|null;onSave:(draft:StockRuleDraft)=>void;onBack:()=>void}){
  const version=rule?currentVersion(rule,today()):null;
  const[draft,setDraft]=useState<StockRuleDraft>(()=>rule&&version?{ruleId:rule.id,loadItemId:rule.loadItemId,unitId:'',perQuantity:String(version.perQuantity),effectiveFrom:today(),lines:version.lines.map(line=>({stockItemId:line.stockItemId,amount:String(line.amount)}))}:{...emptyStockRuleDraft,effectiveFrom:today(),lines:[{stockItemId:'',amount:''}]});
  const[example,setExample]=useState('8');
  const set=<K extends keyof StockRuleDraft>(key:K,value:StockRuleDraft[K])=>setDraft(current=>({...current,[key]:value}));
  const setLine=(index:number,patch:Partial<StockRuleDraft['lines'][number]>)=>setDraft(current=>({...current,lines:current.lines.map((line,at)=>at===index?{...line,...patch}:line)}));
  const loadItem=setup.loadItems.find(value=>value.id===draft.loadItemId);
  const unit=rule?rule.unitSymbol:setup.units.find(value=>value.id===draft.unitId)?.symbol??'';
  const per=Number(draft.perQuantity.replace(',','.')),quantity=Number(example.replace(',','.'));
  const available=useMemo(()=>setup.loadItems.filter(value=>!value.hasRule&&!value.bitumen).map(value=>({id:value.id,label:value.name,detail:`${value.categoryName}${value.unitSymbol?` · ${value.unitSymbol}`:''}`})),[setup.loadItems]);
  const preview=draft.lines.map(line=>{const material=setup.materials.find(value=>value.id===line.stockItemId),amount=Number(line.amount.replace(',','.'));return material&&Number.isFinite(amount)&&amount>0&&Number.isFinite(per)&&per>0&&Number.isFinite(quantity)&&quantity>0?`${material.name} ${formatStockQuantity(materialForLoad(quantity,per,amount),material.unitSymbol)}`:null;}).filter((value):value is string=>value!==null);
  const chosen=new Set(draft.lines.map(line=>line.stockItemId).filter(Boolean));
  return <View style={styles.stack}>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppCard title="1 · The load" hint="Loads of this item, confirmed on receipts, take the materials below out of Stock.">
      {rule?<Text style={styles.line}>{rule.loadItemName} · per {unit}</Text>:<>
        <SearchableSelect label="When this item is delivered *" options={available} selectedId={draft.loadItemId} onSelect={id=>{const item=setup.loadItems.find(value=>value.id===id);setDraft(current=>({...current,loadItemId:id,unitId:item?.unitId??current.unitId}));}} placeholder="Choose the item"/>
        {setup.loadItems.some(value=>value.bitumen)?<Text style={styles.note}>Items that Bitumen already counts are not listed.</Text>:null}
        <SearchableSelect label="The rule is per *" options={setup.units.map(value=>({id:value.id,label:value.name,detail:value.symbol}))} selectedId={draft.unitId} onSelect={id=>set('unitId',id)} placeholder="Choose the unit, for example m³"/>
      </>}
      <AppField label={`Quantity the amounts below are for${unit?` (${unit})`:''} *`} value={draft.perQuantity} onChangeText={value=>set('perQuantity',value)} keyboardType="decimal-pad"/>
      <DatePickerField label={rule?'Applies to loads from *':'Count loads from *'} value={draft.effectiveFrom} onChange={value=>set('effectiveFrom',value)}/>
      <Text style={styles.note}>{rule?'Loads already counted keep the amounts they were counted with. This change starts from the date above.':'Loads confirmed before this day are never touched.'}</Text>
    </AppCard>
    <AppCard title="2 · Materials used" hint="Pick each material from your Stock, then type how much of it goes in.">
      {draft.lines.map((line,index)=>{const material=setup.materials.find(value=>value.id===line.stockItemId);return <View key={index} style={styles.lineBox}>
        <SearchableSelect label={`Material ${index+1} *`} options={setup.materials.filter(value=>value.id===line.stockItemId||!chosen.has(value.id)).map(value=>({id:value.id,label:value.name,detail:value.unitSymbol}))} selectedId={line.stockItemId} onSelect={id=>setLine(index,{stockItemId:id})} placeholder="Choose from your Stock"/>
        <AppField label={`Amount${material?` (${material.unitSymbol})`:''} per ${draft.perQuantity||'1'} ${unit||'unit'} *`} value={line.amount} onChangeText={value=>setLine(index,{amount:value})} keyboardType="decimal-pad"/>
        {draft.lines.length>1?<AppButton label="Remove this material" tone="secondary" onPress={()=>setDraft(current=>({...current,lines:current.lines.filter((_,at)=>at!==index)}))}/>:null}
      </View>;})}
      {setup.materials.length?<AppButton label="+ Add material" tone="secondary" onPress={()=>setDraft(current=>({...current,lines:[...current.lines,{stockItemId:'',amount:''}]}))}/>:<Text style={styles.note}>Nothing is in Stock yet. Add a material to Stock first, then come back.</Text>}
    </AppCard>
    <AppCard title="3 · Check with a quantity">
      <AppField label={`Example load${unit?` (${unit})`:''}`} value={example} onChangeText={setExample} keyboardType="decimal-pad"/>
      {preview.length?preview.map(text=><Text key={text} style={styles.line}>{text}</Text>):<Text style={styles.note}>Fill in the quantity and the amounts to see what a load would use.</Text>}
    </AppCard>
    {rule?<AppCard title="Rule history">{rule.versions.map(item=><View key={item.id} style={styles.history}><Text style={styles.sub}>from {item.effectiveFrom} · per {amountText(item.perQuantity)} {rule.unitSymbol}</Text><Text style={styles.line}>{item.lines.map(line=>{const material=setup.materials.find(value=>value.id===line.stockItemId);return `${material?.name??'Material'} ${amountText(line.amount)} ${material?.unitSymbol??''}`.trim();}).join(' · ')}</Text></View>)}</AppCard>:null}
    <AppButton label={rule?'Save rule change':'Save rule'} busy={busy} onPress={()=>onSave(draft)}/>
    <AppButton label="Cancel" tone="secondary" onPress={onBack}/>
    {loadItem&&!rule&&loadItem.unitSymbol===null?<Text style={styles.note}>{loadItem.name} has no default unit, so choose the unit above.</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  stack:{gap:12},
  line:{color:colors.ink,fontSize:14,fontWeight:'600'},
  note:{color:colors.muted,fontSize:12,lineHeight:17},
  sub:{color:colors.muted,fontSize:12},
  lineBox:{gap:8,paddingBottom:10,borderBottomWidth:1,borderBottomColor:colors.line},
  history:{gap:2,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line},
  badge:{alignSelf:'flex-start',fontSize:11,fontWeight:'800',borderRadius:999,borderWidth:1,paddingHorizontal:9,paddingVertical:3,overflow:'hidden'},
  badgeOn:{color:colors.success,borderColor:'#9FD2B3',backgroundColor:'#E6F3EC'},
  badgeOff:{color:colors.muted,borderColor:'#C7D3E2',backgroundColor:'#EEF2F7'},
});
