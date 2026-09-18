import {StyleSheet,View} from 'react-native';

import {colors} from '../theme';
import {AppButton} from './AppPrimitives';

/** A sticky, single-primary-action footer: Save (and, once saved, Continue) -- never several competing buttons at once. */
export function SaveContinueFooter({saveLabel,onSave,busy,disabled,continueLabel,onContinue,secondaryLabel,onSecondary}:{
  saveLabel:string;onSave:()=>void;busy?:boolean;disabled?:boolean;
  continueLabel?:string;onContinue?:()=>void;secondaryLabel?:string;onSecondary?:()=>void;
}){
  return <View style={styles.footer}>
    {continueLabel&&onContinue?<AppButton label={continueLabel} tone="navy" onPress={onContinue}/>:<AppButton label={saveLabel} tone="navy" busy={busy} disabled={disabled} onPress={onSave}/>}
    {secondaryLabel&&onSecondary?<AppButton label={secondaryLabel} tone="secondary" onPress={onSecondary}/>:null}
  </View>;
}

const styles=StyleSheet.create({
  footer:{gap:8,paddingTop:4,borderTopWidth:1,borderTopColor:colors.line,marginTop:6},
});
