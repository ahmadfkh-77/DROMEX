import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {companySiteChoices,fuelDestinationOptions,type CompanySite,type FuelDestinationType,type FuelOption} from '../../domain/fuel';
import {colors,radius} from '../theme';
import {AppButton} from './AppPrimitives';
import {ChoiceField} from './ChoiceField';
import {SearchableSelect} from './SearchableSelect';

export type FuelDestinationValue={destinationType:FuelDestinationType;projectId:string;companySiteId:string};

const hints:Record<FuelDestinationType,string>={
  project:'Fuel used on a construction project',
  company_site:'Fuel used at a saved company location, such as the plant or yard',
  unassigned:'Where the fuel went was not recorded',
};

/**
 * DEC-438. Fuel destination for an equipment fill. Choosing a type clears the selection the other
 * type used, so a hidden project or site can never travel with the draft.
 */
/** Supplier Loads reuse this control with their own wording: `label`, `hints` and `siteHelp` replace the fuel text. */
export type DestinationWording={label?:string;hints?:Partial<Record<FuelDestinationType,string>>;siteHelp?:string};
export function FuelDestinationFields({value,onChange,projects,companySites,currentCompanySiteId,onManageSites,wording,variant}:{wording?:DestinationWording;value:FuelDestinationValue;onChange:(next:FuelDestinationValue)=>void;projects:FuelOption[];companySites:CompanySite[];currentCompanySiteId?:string|null;onManageSites?:()=>void;/** `open` shows the destination as one three-way switch and underlined selectors (Supplier Loads). */variant?:'open'}){
  const siteOptions=companySiteChoices(companySites,currentCompanySiteId??null);
  const choose=(destinationType:FuelDestinationType)=>onChange({destinationType,projectId:destinationType==='project'?value.projectId:'',companySiteId:destinationType==='company_site'?value.companySiteId:''});
  const openForm=variant==='open';
  return <View style={styles.group}>
    {openForm?<View style={styles.field}>
      <Text style={styles.switchLabel}>{wording?.label??'Fuel destination *'}</Text>
      <View style={styles.switchTrack} accessibilityRole="radiogroup" accessibilityLabel={(wording?.label??'Destination').replace(/\s*\*$/,'')}>{fuelDestinationOptions.map(option=>{const checked=option.id===value.destinationType;return <TouchableOpacity key={option.id} style={[styles.switchOption,checked&&styles.switchOptionOn]} onPress={()=>choose(option.id)} activeOpacity={.75} accessibilityRole="radio" accessibilityState={{checked}} accessibilityLabel={option.label} accessibilityHint={wording?.hints?.[option.id]??hints[option.id]}><Text style={[styles.switchText,checked&&styles.switchTextOn]} numberOfLines={1}>{option.label}</Text></TouchableOpacity>;})}</View>
      <Text style={styles.switchHint}>{wording?.hints?.[value.destinationType]??hints[value.destinationType]}</Text>
    </View>:<ChoiceField label={wording?.label??"Fuel destination *"} options={fuelDestinationOptions.map(option=>({...option,hint:wording?.hints?.[option.id]??hints[option.id]}))} selectedId={value.destinationType} onSelect={choose}/>}
    {value.destinationType==='project'?<SearchableSelect variant={variant} label="Select project *" options={projects.map(project=>({id:project.id,label:project.name,detail:project.detail}))} selectedId={value.projectId} onSelect={projectId=>onChange({...value,projectId,companySiteId:''})} placeholder="Select project"/>:null}
    {value.destinationType==='company_site'?(siteOptions.length?<SearchableSelect variant={variant} label="Select company site *" options={siteOptions} selectedId={value.companySiteId} onSelect={companySiteId=>onChange({...value,companySiteId,projectId:''})} placeholder="Select company site"/>:<View style={styles.noSites}>
      <Text style={styles.noSitesTitle}>Select company site *</Text>
      <Text style={styles.noSitesBody}>{wording?.siteHelp??'No active company sites are saved yet. Add the plant, yard, workshop, or warehouse that receives fuel, then choose it here.'}</Text>
      {onManageSites?<AppButton label="Add Company Sites" tone="secondary" onPress={onManageSites}/>:null}
    </View>):null}
  </View>;
}

const styles=StyleSheet.create({
  group:{gap:12},
  field:{gap:6},
  switchLabel:{color:'#3C4854',fontSize:12,fontWeight:'800'},
  switchTrack:{flexDirection:'row',backgroundColor:'#E8E3D8',borderRadius:12,padding:3,gap:3},
  switchOption:{flex:1,minHeight:44,borderRadius:9,alignItems:'center',justifyContent:'center',paddingHorizontal:4},
  switchOptionOn:{backgroundColor:colors.navy},
  switchText:{color:colors.muted,fontSize:12,fontWeight:'800'},
  switchTextOn:{color:'#FFF'},
  switchHint:{color:colors.muted,fontSize:12,lineHeight:17},
  noSites:{gap:8,padding:14,borderRadius:radius.md,borderWidth:1,borderStyle:'dashed',borderColor:colors.line,backgroundColor:colors.cream},
  noSitesTitle:{color:colors.ink,fontSize:13,fontWeight:'800'},
  noSitesBody:{color:colors.muted,fontSize:13,lineHeight:19},
});
