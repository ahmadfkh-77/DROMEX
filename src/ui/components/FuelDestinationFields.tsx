import {StyleSheet,Text,View} from 'react-native';

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
export function FuelDestinationFields({value,onChange,projects,companySites,currentCompanySiteId,onManageSites}:{value:FuelDestinationValue;onChange:(next:FuelDestinationValue)=>void;projects:FuelOption[];companySites:CompanySite[];currentCompanySiteId?:string|null;onManageSites?:()=>void}){
  const siteOptions=companySiteChoices(companySites,currentCompanySiteId??null);
  const choose=(destinationType:FuelDestinationType)=>onChange({destinationType,projectId:destinationType==='project'?value.projectId:'',companySiteId:destinationType==='company_site'?value.companySiteId:''});
  return <View style={styles.group}>
    <ChoiceField label="Fuel destination *" options={fuelDestinationOptions.map(option=>({...option,hint:hints[option.id]}))} selectedId={value.destinationType} onSelect={choose}/>
    {value.destinationType==='project'?<SearchableSelect label="Select project *" options={projects.map(project=>({id:project.id,label:project.name,detail:project.detail}))} selectedId={value.projectId} onSelect={projectId=>onChange({...value,projectId,companySiteId:''})} placeholder="Select project"/>:null}
    {value.destinationType==='company_site'?(siteOptions.length?<SearchableSelect label="Select company site *" options={siteOptions} selectedId={value.companySiteId} onSelect={companySiteId=>onChange({...value,companySiteId,projectId:''})} placeholder="Select company site"/>:<View style={styles.noSites}>
      <Text style={styles.noSitesTitle}>Select company site *</Text>
      <Text style={styles.noSitesBody}>No active company sites are saved yet. Add the plant, yard, workshop, or warehouse that receives fuel, then choose it here.</Text>
      {onManageSites?<AppButton label="Add Company Sites" tone="secondary" onPress={onManageSites}/>:null}
    </View>):null}
  </View>;
}

const styles=StyleSheet.create({
  group:{gap:12},
  noSites:{gap:8,padding:14,borderRadius:radius.md,borderWidth:1,borderStyle:'dashed',borderColor:colors.line,backgroundColor:colors.cream},
  noSitesTitle:{color:colors.ink,fontSize:13,fontWeight:'800'},
  noSitesBody:{color:colors.muted,fontSize:13,lineHeight:19},
});
