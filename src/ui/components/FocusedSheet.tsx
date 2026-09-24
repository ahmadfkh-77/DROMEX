import type {ReactNode} from 'react';
import {KeyboardAvoidingView,Modal,Platform,SafeAreaView,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {colors} from '../theme';
import {useReducedMotion} from './ExpandableMenu';

/**
 * The Focused Record Sheet (DESIGN.md), shared: a full-screen page sheet with an eyebrow, a title, a
 * Close pill, a scrolling keyboard-safe body, and a sticky footer holding the one primary action.
 * Errors belong inside the body so the sheet stays open and the user's typing survives. Do not open a
 * second Modal (such as SearchableSelect) from inside a sheet; Android nests modals unreliably.
 */
export function FocusedSheet({visible,eyebrow,title,onClose,footer,children,scrollEnabled=true}:{visible:boolean;eyebrow:string;title:string;onClose:()=>void;footer:ReactNode;children:ReactNode;
  /** Turned off while a finger is drawing a signature, so the stroke is not taken as a scroll. */
  scrollEnabled?:boolean}){
  const reducedMotion=useReducedMotion();
  return <Modal visible={visible} animationType={reducedMotion?'none':'slide'} presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.sheet}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
        </View>
        <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close without saving"><Text style={styles.closeText}>Close</Text></TouchableOpacity>
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS==='ios'?'padding':undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" scrollEnabled={scrollEnabled}>{children}</ScrollView>
        <View style={styles.footer}>{footer}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

/** Footer buttons for a FocusedSheet: a quiet Cancel and the sheet's single Signal Orange action. */
export function SheetActions({primaryLabel,onPrimary,onCancel,busy=false,disabled=false}:{primaryLabel:string;onPrimary:()=>void;onCancel:()=>void;busy?:boolean;disabled?:boolean}){
  return <>
    <TouchableOpacity style={styles.cancel} onPress={onCancel} disabled={busy} accessibilityRole="button" accessibilityLabel="Cancel"><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
    <TouchableOpacity style={[styles.primary,(busy||disabled)&&styles.disabled]} onPress={onPrimary} disabled={busy||disabled} accessibilityRole="button" accessibilityLabel={primaryLabel} accessibilityState={{disabled:busy||disabled,busy}}><Text style={styles.primaryText}>{busy?'Saving…':primaryLabel}</Text></TouchableOpacity>
  </>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  sheet:{flex:1,backgroundColor:colors.background},
  header:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:20,paddingTop:18,paddingBottom:14},
  eyebrow:{color:colors.brand,fontSize:10,fontWeight:'900',letterSpacing:1.2},
  title:{color:colors.ink,fontSize:24,fontWeight:'900',marginTop:2},
  close:{minHeight:48,minWidth:48,paddingHorizontal:14,borderRadius:10,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
  closeText:{color:colors.ink,fontWeight:'800'},
  body:{padding:20,paddingTop:4,paddingBottom:28,gap:16},
  footer:{flexDirection:'row',gap:10,paddingHorizontal:20,paddingTop:12,paddingBottom:16,backgroundColor:colors.surface,shadowColor:'#17212B',shadowOpacity:.12,shadowRadius:8,shadowOffset:{width:0,height:-3},elevation:8},
  cancel:{minHeight:48,paddingHorizontal:20,borderRadius:13,borderWidth:1,borderColor:colors.navy,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
  cancelText:{color:colors.navy,fontWeight:'800',fontSize:15},
  primary:{flex:1,minHeight:48,borderRadius:13,backgroundColor:colors.brand,alignItems:'center',justifyContent:'center',paddingHorizontal:12},
  primaryText:{color:'#FFFFFF',fontWeight:'800',fontSize:15},
  disabled:{opacity:.4},
});
