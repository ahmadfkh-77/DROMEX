import Storage from 'expo-sqlite/kv-store';
import RNBluetoothClassic,{type BluetoothDevice} from 'react-native-bluetooth-classic';
import {NativeModules,PermissionsAndroid,Platform,type Permission} from 'react-native';
import type {Buffer} from 'buffer';

import type {ConfirmedLoad} from '../domain/loads';
import type {QuickTextDocument} from '../domain/quickText';
import {buildLoadEscPos,buildQuickTextEscPos,buildTestEscPos} from './escpos';
import type {LoadDocumentKind,PaperWidth} from './documentTemplates';

export type BluetoothPrinterDevice={name:string;address:string;bonded:boolean;type:string};
export type SavedBluetoothPrinter={name:string;address:string;paperWidth:PaperWidth};
const settingsKey='dromex.bluetooth-printer.v1';

function assertAndroidNative(){
  if(Platform.OS!=='android')throw new Error('Direct Bluetooth printer pairing is currently available in the Android build.');
  if(!NativeModules.RNBluetoothClassic)throw new Error('Bluetooth printing is not included in this installed build. Install the new DROMEX APK; Expo Go cannot use this feature.');
}

export function bluetoothPrintingAvailable(){return Platform.OS==='android'&&Boolean(NativeModules.RNBluetoothClassic);}

export async function requestBluetoothPermissions(){
  assertAndroidNative();
  const api=Number(Platform.Version);
  const permissions=(api>=31?['android.permission.BLUETOOTH_SCAN','android.permission.BLUETOOTH_CONNECT']:['android.permission.ACCESS_FINE_LOCATION']) as Permission[];
  const result=await PermissionsAndroid.requestMultiple(permissions);
  if(permissions.some(permission=>result[permission]!==PermissionsAndroid.RESULTS.GRANTED))throw new Error('Bluetooth permission is required to find, pair, and print to the thermal printer.');
}

export async function ensureBluetoothEnabled(){
  assertAndroidNative();await requestBluetoothPermissions();
  if(await RNBluetoothClassic.isBluetoothEnabled())return true;
  const enabled=await RNBluetoothClassic.requestBluetoothEnabled();
  if(!enabled)throw new Error('Turn on Bluetooth to continue.');
  return true;
}

const mapDevice=(device:BluetoothDevice):BluetoothPrinterDevice=>({name:device.name?.trim()||'Unnamed Bluetooth device',address:device.address,bonded:Boolean(device.bonded),type:device.type});
export async function listPairedBluetoothDevices(){await ensureBluetoothEnabled();return (await RNBluetoothClassic.getBondedDevices()).map(mapDevice).sort((a,b)=>a.name.localeCompare(b.name));}
export async function discoverBluetoothDevices(){await ensureBluetoothEnabled();const values=await RNBluetoothClassic.startDiscovery();const unique=new Map(values.map(value=>[value.address,mapDevice(value)]));return [...unique.values()].sort((a,b)=>a.name.localeCompare(b.name));}
export async function pairBluetoothDevice(address:string){await ensureBluetoothEnabled();return mapDevice(await RNBluetoothClassic.pairDevice(address));}
export function openAndroidBluetoothSettings(){assertAndroidNative();RNBluetoothClassic.openBluetoothSettings();}

export async function getSavedBluetoothPrinter():Promise<SavedBluetoothPrinter|null>{const value=await Storage.getItem(settingsKey);if(!value)return null;try{return JSON.parse(value) as SavedBluetoothPrinter;}catch{return null;}}
export async function saveBluetoothPrinter(value:SavedBluetoothPrinter){await Storage.setItem(settingsKey,JSON.stringify(value));}
export async function forgetSavedBluetoothPrinter(){await Storage.removeItem(settingsKey);}

async function write(address:string,payload:Buffer){
  await ensureBluetoothEnabled();
  let device:BluetoothDevice;
  try{device=await RNBluetoothClassic.getConnectedDevice(address);if(!(await device.isConnected()))throw new Error('Disconnected');}
  catch{device=await RNBluetoothClassic.connectToDevice(address,{connectorType:'rfcomm',connectionType:'binary',secureSocket:false,readSize:2048});}
  for(let start=0;start<payload.length;start+=768){const sent=await device.write(payload.subarray(start,start+768));if(!sent)throw new Error('The printer did not accept the print data.');if(start+768<payload.length)await new Promise(resolve=>setTimeout(resolve,18));}
}

async function selected(){const printer=await getSavedBluetoothPrinter();if(!printer)throw new Error('No printer is selected. Open More → Setup → Bluetooth Printer first.');return printer;}
export async function printBluetoothTest(printer:SavedBluetoothPrinter){await write(printer.address,buildTestEscPos(printer.name,printer.paperWidth));}
export async function printLoadBluetooth(record:ConfirmedLoad,kind:LoadDocumentKind,paper?:PaperWidth){const printer=await selected();await write(printer.address,buildLoadEscPos(record,kind,paper??printer.paperWidth));return printer;}
export async function printQuickTextBluetooth(record:QuickTextDocument){const printer=await selected();await write(printer.address,buildQuickTextEscPos(record));return printer;}
