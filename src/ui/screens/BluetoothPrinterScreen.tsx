import {useCallback,useEffect,useState} from 'react';
import {Platform,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {bluetoothPrintingAvailable,discoverBluetoothDevices,forgetSavedBluetoothPrinter,getSavedBluetoothPrinter,listPairedBluetoothDevices,openAndroidBluetoothSettings,pairBluetoothDevice,printBluetoothTest,saveBluetoothPrinter,type BluetoothPrinterDevice,type SavedBluetoothPrinter} from '../../services/bluetoothPrinter';
import type {PaperWidth} from '../../services/documentTemplates';
import {AppButton,AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {colors} from '../theme';

export function BluetoothPrinterScreen({onBack}:{onBack:()=>void}){
  const[paired,setPaired]=useState<BluetoothPrinterDevice[]>([]),[found,setFound]=useState<BluetoothPrinterDevice[]>([]),[saved,setSaved]=useState<SavedBluetoothPrinter|null>(null),[paper,setPaper]=useState<PaperWidth>('58'),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null);
  const load=useCallback(async()=>{const current=await getSavedBluetoothPrinter();setSaved(current);setPaper(current?.paperWidth??'58');if(bluetoothPrintingAvailable())setPaired(await listPairedBluetoothDevices());},[]);
  useEffect(()=>{void load().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load Bluetooth printers.'));},[load]);
  async function run(action:()=>Promise<void>){setBusy(true);setError(null);setMessage(null);try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'Bluetooth printer action failed.');}finally{setBusy(false);}}
  function choose(device:BluetoothPrinterDevice){void run(async()=>{const value={name:device.name,address:device.address,paperWidth:paper};await saveBluetoothPrinter(value);setSaved(value);setMessage(`${device.name} selected as the DROMEX printer.`);});}
  function choosePaper(value:PaperWidth){setPaper(value);if(saved)void saveBluetoothPrinter({...saved,paperWidth:value}).then(()=>setSaved({...saved,paperWidth:value}));}
  return <ScrollView contentContainerStyle={styles.content}><PageHeader eyebrow="SETUP" title="Bluetooth printer" onBack={onBack}/>
    <AppCard tone="navy" title="Pair once, print offline" hint="Pair the thermal printer with this Android phone, select it in DROMEX, and print confirmed documents without internet.">
      <View style={styles.statusRow}><Text style={styles.statusLabel}>SELECTED PRINTER</Text><Text style={styles.statusValue}>{saved?.name??'None selected'}</Text></View>
    </AppCard>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    {Platform.OS!=='android'?<Feedback kind="error">This pairing screen is Android-first. iPhone support requires a physically identified MFi/BLE-compatible printer protocol.</Feedback>:null}
    {!bluetoothPrintingAvailable()&&Platform.OS==='android'?<Feedback kind="error">This installed build does not contain the native Bluetooth module. Create and install the next DROMEX APK; this feature does not work inside Expo Go.</Feedback>:null}
    <AppCard title="1 · Pair the printer" hint="Turn on the printer and keep it close. Samsung may request a PIN such as 0000 or 1234; use the printer manual's PIN.">
      <AppButton label="Open Samsung Bluetooth Pairing" tone="secondary" disabled={!bluetoothPrintingAvailable()||busy} onPress={()=>{try{openAndroidBluetoothSettings();}catch(cause){setError(cause instanceof Error?cause.message:'Could not open Bluetooth settings.');}}}/>
      <AppButton label="Scan Inside DROMEX" disabled={!bluetoothPrintingAvailable()} busy={busy} onPress={()=>void run(async()=>{const devices=await discoverBluetoothDevices();setFound(devices);setMessage(devices.length?`${devices.length} Bluetooth device${devices.length===1?'':'s'} found.`:'No device found. Check that the printer is on and discoverable.');})}/>
      {found.map(device=><DeviceRow key={device.address} device={device} action={device.bonded?'Select':'Pair'} disabled={busy} onPress={()=>device.bonded?choose(device):void run(async()=>{const pairedDevice=await pairBluetoothDevice(device.address);setFound(current=>current.map(value=>value.address===device.address?pairedDevice:value));await load();setMessage(`${pairedDevice.name} paired. Select it below.`);})}/>) }
    </AppCard>
    <AppCard tone="cream" title="2 · Select paper width" hint="Use the roll installed in this printer. DROMEX keeps 58 mm and 80 mm layouts separate.">
      <View style={styles.paperRow}>{(['58','80'] as PaperWidth[]).map(value=><TouchableOpacity key={value} style={[styles.paper,value===paper&&styles.paperSelected]} onPress={()=>choosePaper(value)}><Text style={[styles.paperText,value===paper&&styles.paperTextSelected]}>{value} mm</Text></TouchableOpacity>)}</View>
    </AppCard>
    <AppCard title="3 · Select a paired printer" hint="Refresh after pairing in Samsung Settings, then choose the printer DROMEX should remember.">
      <AppButton label="Refresh Paired Devices" tone="secondary" disabled={!bluetoothPrintingAvailable()} busy={busy} onPress={()=>void run(async()=>{await load();setMessage('Paired-device list refreshed.');})}/>
      {paired.length?paired.map(device=><DeviceRow key={device.address} device={device} selected={saved?.address===device.address} action={saved?.address===device.address?'Selected':'Select'} disabled={busy||saved?.address===device.address} onPress={()=>choose(device)}/>):<Text style={styles.helper}>No paired devices are visible yet.</Text>}
    </AppCard>
    <AppCard tone="navy" title="4 · Test before real printing" hint="A successful test confirms Bluetooth transport and basic ESC/POS compatibility for this device.">
      <AppButton label="Print DROMEX Test" disabled={!saved} busy={busy} onPress={()=>void run(async()=>{if(!saved)throw new Error('Select a paired printer first.');const current={...saved,paperWidth:paper};await saveBluetoothPrinter(current);await printBluetoothTest(current);setSaved(current);setMessage('Test data sent. Confirm that the printer produced a clear DROMEX test slip.');})}/>
      {saved?<AppButton label="Forget Selected Printer" tone="danger" disabled={busy} onPress={()=>void run(async()=>{await forgetSavedBluetoothPrinter();setSaved(null);setMessage('Selected printer removed from DROMEX. Android pairing was not removed.');})}/>:null}
    </AppCard>
    <Text style={styles.helper}>Official compatibility still requires a successful physical test. This workflow targets Bluetooth Classic ESC/POS thermal printers; pairing alone cannot guarantee that an unknown printer protocol will print correctly.</Text>
  </ScrollView>;
}

function DeviceRow({device,selected,action,onPress,disabled}:{device:BluetoothPrinterDevice;selected?:boolean;action:string;onPress:()=>void;disabled?:boolean}){return <View style={[styles.device,selected&&styles.deviceSelected]}><View style={styles.deviceCopy}><Text style={styles.deviceName}>{device.name}</Text><Text style={styles.deviceAddress}>{device.address} · {device.bonded?'Paired':'Not paired'} · {device.type}</Text></View><TouchableOpacity style={[styles.deviceAction,disabled&&styles.disabled]} disabled={disabled} onPress={onPress}><Text style={styles.deviceActionText}>{action}</Text></TouchableOpacity></View>;}
const styles=StyleSheet.create({content:{padding:20,paddingBottom:45,gap:15},statusRow:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#6F8FA9',paddingTop:12,gap:4},statusLabel:{color:'#F2A184',fontSize:9,fontWeight:'900',letterSpacing:1.1},statusValue:{color:colors.cream,fontSize:18,fontWeight:'900'},helper:{color:colors.muted,fontSize:12,lineHeight:18},paperRow:{flexDirection:'row',gap:9},paper:{flex:1,borderWidth:1,borderColor:colors.line,borderRadius:11,padding:13,alignItems:'center',backgroundColor:'#FFF'},paperSelected:{borderColor:colors.brand,backgroundColor:'#FBE9E4'},paperText:{color:colors.muted,fontWeight:'900'},paperTextSelected:{color:colors.brandDark},device:{borderWidth:1,borderColor:colors.line,borderRadius:12,padding:12,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:'#FFF'},deviceSelected:{borderColor:colors.success,backgroundColor:'#E5F3EC'},deviceCopy:{flex:1,minWidth:0,gap:3},deviceName:{color:colors.ink,fontSize:15,fontWeight:'900'},deviceAddress:{color:colors.muted,fontSize:10},deviceAction:{backgroundColor:colors.navy,borderRadius:9,paddingHorizontal:12,paddingVertical:9},deviceActionText:{color:'#FFF',fontSize:11,fontWeight:'900'},disabled:{opacity:.45}});
