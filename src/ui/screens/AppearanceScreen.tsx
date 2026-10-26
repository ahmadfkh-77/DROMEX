import {useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {resolveSkylineStyle,skylineOptions,type SkylineStyle} from '../../domain/appearance';
import {pickSkylineImage} from '../../services/media';
import {loadAppearance,saveSkylineImage,saveSkylineStyle,type Appearance} from '../appearanceStore';
import {AppButton,AppCard,AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {HomeSkyline} from '../components/HomeSkyline';
import {colors} from '../theme';

/**
 * Setup › Appearance (DEC-530). Chooses the picture under the logo on Home. A choice is saved the moment it is tapped, so there is no Save
 * button. The picture and the choice are saved preferences: they work offline and travel inside a backup.
 */
export function AppearanceScreen({onBack}:{onBack:()=>void}){
  const[appearance,setAppearance]=useState<Appearance|null>(null);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[saved,setSaved]=useState<string|null>(null);
  useEffect(()=>{let active=true;void loadAppearance().then(value=>{if(active)setAppearance(value);});return()=>{active=false;};},[]);

  const choose=useCallback(async(style:SkylineStyle,replacePicture=false)=>{
    if(!appearance||busy)return;
    setError(null);setSaved(null);setBusy(true);
    try{
      let image=appearance.image;
      if(style==='custom'&&(!image||replacePicture)){
        const picked=await pickSkylineImage();
        if(!picked){setBusy(false);return;}
        await saveSkylineImage(picked);image=picked;
      }
      await saveSkylineStyle(style);
      setAppearance({style,image});
      setSaved(style==='hidden'?'Saved. Home no longer shows a picture.':'Saved. Home now shows this picture.');
    }catch(cause){setError(cause instanceof Error?cause.message:'The choice could not be saved.');}
    finally{setBusy(false);}
  },[appearance,busy]);

  if(!appearance)return <View style={styles.loading}><ActivityIndicator color={colors.navy}/></View>;
  const showing=resolveSkylineStyle(appearance.style,appearance.image);

  return <AppPage>
    <PageHeader eyebrow="SETUP" title="Appearance" onBack={onBack}/>
    <AppCard title="Home skyline" hint="The picture under your logo on Home. Tap a style to use it.">
      <View style={styles.preview} accessibilityLabel="Preview of the Home picture">
        {showing==='hidden'?<Text style={styles.previewEmpty}>No picture on Home</Text>:<HomeSkyline style={appearance.style} image={appearance.image}/>}
      </View>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {skylineOptions.map(option=>{
          const selected=appearance.style===option.style;
          const hasPicture=option.style==='custom'&&appearance.image!==null;
          return <TouchableOpacity key={option.style} style={[styles.tile,selected&&styles.tileSelected]} disabled={busy} onPress={()=>void choose(option.style)} accessibilityRole="radio" accessibilityState={{selected,disabled:busy}} accessibilityLabel={option.label}>
            <View style={[styles.tilePreview,(option.style==='custom'&&!hasPicture)||option.style==='hidden'?styles.tileDashed:null]}>
              {option.style==='hidden'?<Text style={styles.tileDashedText}>No picture</Text>
                :option.style==='custom'&&!hasPicture?<Text style={styles.tileDashedText}>＋ Choose my picture</Text>
                :<HomeSkyline style={option.style} image={appearance.image} compact/>}
            </View>
            <Text style={styles.tileLabel}>{option.label}</Text>
            {selected?<View style={styles.check} importantForAccessibility="no"><Text style={styles.checkText}>✓</Text></View>:null}
          </TouchableOpacity>;
        })}
      </View>
      {appearance.style==='custom'&&appearance.image?<AppButton label="Replace my picture" tone="secondary" disabled={busy} onPress={()=>void choose('custom',true)}/>:null}
      {saved?<Feedback kind="success">{saved}</Feedback>:null}
      {error?<Feedback kind="error">{error}</Feedback>:null}
      <Text style={styles.note}>Your own picture is shrunk, saved on this phone, and included in your backups. A wide picture with a transparent background looks best.</Text>
    </AppCard>
  </AppPage>;
}

const styles=StyleSheet.create({
  loading:{flex:1,alignItems:'center',justifyContent:'center'},
  preview:{backgroundColor:colors.creamSoft,borderRadius:14,padding:12,minHeight:70,justifyContent:'center'},
  previewEmpty:{color:colors.muted,fontSize:12,textAlign:'center'},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:10},
  tile:{flexBasis:'47%',flexGrow:1,borderWidth:1.5,borderColor:colors.line,borderRadius:13,padding:7,backgroundColor:'#FCFBF8'},
  tileSelected:{borderColor:colors.brand,backgroundColor:colors.surface},
  tilePreview:{height:58,borderRadius:9,backgroundColor:colors.creamSoft,alignItems:'center',justifyContent:'center',overflow:'hidden',paddingHorizontal:4},
  tileDashed:{backgroundColor:colors.surface,borderWidth:1.5,borderColor:'#B9B2A4',borderStyle:'dashed'},
  tileDashedText:{color:colors.muted,fontSize:11,fontWeight:'700',textAlign:'center'},
  tileLabel:{color:colors.ink,fontSize:12,fontWeight:'800',marginTop:6},
  check:{position:'absolute',top:-8,right:-8,width:22,height:22,borderRadius:11,backgroundColor:colors.brand,alignItems:'center',justifyContent:'center'},
  checkText:{color:'#FFF',fontSize:13,fontWeight:'900'},
  note:{color:colors.muted,fontSize:11,lineHeight:16},
});
