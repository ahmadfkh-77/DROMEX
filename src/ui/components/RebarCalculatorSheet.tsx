import {useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {
  calculateRebarLine,formatKgFixed,formatMeters,formatPerMeter,LENGTH_QUICK_CHOICES,parseDiameterList,rebarTotals,validateSteelSettings,type SteelSettings,
} from '../../domain/rebar';
import {colors} from '../theme';
import {AppButton,AppCard,AppField,Feedback} from './AppPrimitives';
import {FocusedSheet,SheetActions} from './FocusedSheet';

/**
 * The rebar calculator. One line per diameter: diameter, length per bar and pieces give the kg per meter, the meters and
 * the weight. It only SUGGESTS weights: nothing is saved until "Use calculated weights", and a weight typed on the form is
 * never touched by anything else. The density and the diameter list are one saved setting, edited here and nowhere else.
 */
export type CalculatorLine={key:string;itemId:string;diameter:string;length:string;pieces:string};
export type AppliedLine={key:string;itemId:string;diameterMm:number;lengthPerBarM:number;pieces:number;calculatedKg:number};

const parse=(value:string)=>Number(value.trim().replace(',','.'));

export function RebarCalculatorSheet({visible,onClose,steelItems,initialLines,settings,onSaveSettings,onApply}:{
  visible:boolean;onClose:()=>void;steelItems:{id:string;name:string}[];initialLines:CalculatorLine[];settings:SteelSettings;
  onSaveSettings:(settings:SteelSettings)=>Promise<void>;onApply:(lines:AppliedLine[])=>void}){
  const[lines,setLines]=useState<CalculatorLine[]>(initialLines);
  const[editing,setEditing]=useState(false);const[densityText,setDensityText]=useState(String(settings.densityKgM3));const[diameterText,setDiameterText]=useState(settings.diameters.join(', '));
  const[error,setError]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  useEffect(()=>{if(visible){setLines(initialLines.length?initialLines:[{key:`calc_${Date.now().toString(36)}`,itemId:'',diameter:'',length:'6',pieces:''}]);setEditing(false);setError(null);}},[visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{setDensityText(String(settings.densityKgM3));setDiameterText(settings.diameters.join(', '));},[settings]);
  const results=useMemo(()=>lines.map(line=>calculateRebarLine({diameterMm:parse(line.diameter),lengthPerBarM:parse(line.length),pieces:parse(line.pieces)},settings.densityKgM3)),[lines,settings.densityKgM3]);
  const totals=useMemo(()=>rebarTotals(lines.flatMap((line,index)=>results[index]?[{...results[index]!,pieces:parse(line.pieces)}]:[])),[lines,results]);
  const change=(key:string,patch:Partial<CalculatorLine>)=>setLines(current=>current.map(line=>line.key===key?{...line,...patch}:line));
  const ready=lines.length>0&&lines.every((line,index)=>results[index]&&line.itemId);

  async function saveSettings(){
    const next:SteelSettings={densityKgM3:parse(densityText),diameters:parseDiameterList(diameterText)};
    const issues=validateSteelSettings(next);if(issues.length){setError(issues.join(' '));return;}
    setBusy(true);setError(null);
    try{await onSaveSettings(next);setEditing(false);}catch(cause){setError(cause instanceof Error?cause.message:'Could not save the steel settings.');}finally{setBusy(false);}
  }
  function apply(){
    const applied:AppliedLine[]=[];
    lines.forEach((line,index)=>{const result=results[index];if(result&&line.itemId)applied.push({key:line.key,itemId:line.itemId,diameterMm:parse(line.diameter),lengthPerBarM:parse(line.length),pieces:parse(line.pieces),calculatedKg:result.weightKg});});
    onApply(applied);
  }

  return <FocusedSheet visible={visible} eyebrow="REBAR CALCULATOR" title="Weight from diameter, length and pieces" onClose={onClose}
    footer={<SheetActions primaryLabel="Use calculated weights" disabled={!ready} onCancel={onClose} onPrimary={apply}/>}>
    <AppCard title="Density of steel" hint="Saved once for the whole app. It is changed here and nowhere else.">
      {editing?<>
        <AppField label="Density (kg/m³)" value={densityText} onChangeText={setDensityText} keyboardType="decimal-pad"/>
        <AppField label="Diameter list (mm, separated by commas)" value={diameterText} onChangeText={setDiameterText}/>
        <AppButton label="Save density and diameters" onPress={()=>void saveSettings()} busy={busy}/>
      </>:<>
        <Text style={styles.big}>{settings.densityKgM3.toLocaleString('en-US')} <Text style={styles.unit}>kg/m³</Text></Text>
        <TouchableOpacity onPress={()=>{setError(null);setEditing(true);}} accessibilityRole="button"><Text style={styles.link}>Change density or diameter list</Text></TouchableOpacity>
      </>}
    </AppCard>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {lines.map((line,index)=>{
      const result=results[index];
      return <AppCard key={line.key} title={`Line ${index+1}${line.itemId?` · ${steelItems.find(item=>item.id===line.itemId)?.name??''}`:''}`}>
        <Text style={styles.label}>Item</Text>
        <View style={styles.chips}>{steelItems.map(item=><Chip key={item.id} label={item.name} on={line.itemId===item.id} onPress={()=>change(line.key,{itemId:item.id})}/>)}</View>
        <Text style={styles.label}>Diameter (mm)</Text>
        <View style={styles.chips}>{settings.diameters.map(value=><Chip key={value} label={String(value)} on={parse(line.diameter)===value} onPress={()=>change(line.key,{diameter:String(value)})}/>)}</View>
        <View style={styles.three}>
          <View style={styles.cell}><AppField label="Diameter mm" value={line.diameter} onChangeText={value=>change(line.key,{diameter:value})} keyboardType="decimal-pad"/></View>
          <View style={styles.cell}><AppField label="Length per bar m" value={line.length} onChangeText={value=>change(line.key,{length:value})} keyboardType="decimal-pad"/></View>
          <View style={styles.cell}><AppField label="Pieces" value={line.pieces} onChangeText={value=>change(line.key,{pieces:value.replace(/[^0-9]/g,'')})} keyboardType="number-pad"/></View>
        </View>
        <View style={styles.chips}>{LENGTH_QUICK_CHOICES.map(value=><Chip key={value} label={`${value} m`} on={parse(line.length)===value} onPress={()=>change(line.key,{length:String(value)})}/>)}</View>
        <View style={styles.three}>
          <Result label="kg per meter" value={result?formatPerMeter(result.kgPerMeter):'—'}/>
          <Result label="Total meters" value={result?`${formatMeters(result.meters)} m`:'—'}/>
          <Result label="Weight" value={result?`${formatKgFixed(result.weightKg)} kg`:'—'} strong/>
        </View>
        {lines.length>1?<TouchableOpacity onPress={()=>setLines(current=>current.filter(value=>value.key!==line.key))} accessibilityRole="button"><Text style={styles.link}>Remove this line</Text></TouchableOpacity>:null}
      </AppCard>;
    })}
    <AppButton label="+ Add another diameter" tone="secondary" onPress={()=>setLines(current=>[...current,{key:`calc_${Date.now().toString(36)}_${current.length}`,itemId:'',diameter:'',length:current[current.length-1]?.length||'6',pieces:''}])}/>
    <AppCard tone="navy" title="Delivery total, calculated">
      <Text style={styles.totalBig}>{totals.lines?`${formatKgFixed(totals.weightKg)} kg`:'—'}</Text>
      <Text style={styles.totalMeta}>{totals.lines?`${formatMeters(totals.meters)} m · ${totals.pieces} pcs · ${totals.lines} line${totals.lines===1?'':'s'}`:'Fill in a diameter, a length and the pieces.'}</Text>
    </AppCard>
    <Text style={styles.note}>kg per meter = π/4 × diameter² ÷ 1,000,000 × density. Weight = pieces × length × kg per meter. The calculator only suggests: a weight you typed is changed only when you tap "Use calculated weights". Weights are saved in kg.</Text>
    {!steelItems.length?<Feedback kind="warning">No steel items are enabled for suppliers. Add items such as "Rebar 12 mm" to a catalog category named Steel first.</Feedback>:null}
  </FocusedSheet>;
}

function Chip({label,on,onPress}:{label:string;on:boolean;onPress:()=>void}){
  return <TouchableOpacity style={[styles.chip,on&&styles.chipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{selected:on}}><Text style={[styles.chipText,on&&styles.chipTextOn]}>{label}</Text></TouchableOpacity>;
}
function Result({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={styles.result}><Text style={styles.resultLabel}>{label}</Text><Text style={[styles.resultValue,strong&&styles.resultStrong]}>{value}</Text></View>;
}

const styles=StyleSheet.create({
  big:{fontSize:26,fontWeight:'900',color:colors.navy},unit:{fontSize:14,fontWeight:'700',color:colors.muted},
  link:{color:colors.navy,fontWeight:'800',textDecorationLine:'underline',paddingVertical:8},
  label:{fontSize:13,fontWeight:'700',color:colors.ink,marginTop:4},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:6},
  chip:{minHeight:44,paddingHorizontal:14,borderRadius:999,borderWidth:1.5,borderColor:colors.line,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
  chipOn:{backgroundColor:colors.navy,borderColor:colors.navy},chipText:{color:colors.ink,fontWeight:'700'},chipTextOn:{color:'#FFFFFF'},
  three:{flexDirection:'row',gap:8},cell:{flex:1,minWidth:0},
  result:{flex:1,minWidth:0,backgroundColor:colors.creamSoft,borderRadius:10,padding:8},
  resultLabel:{fontSize:11,color:colors.muted,fontWeight:'700'},resultValue:{fontSize:15,fontWeight:'800',color:colors.ink,marginTop:2},resultStrong:{color:colors.navy},
  totalBig:{fontSize:28,fontWeight:'900',color:'#FFFFFF'},totalMeta:{color:'#C9D6E6',fontSize:13},
  note:{fontSize:12,color:colors.muted,lineHeight:18},
});
