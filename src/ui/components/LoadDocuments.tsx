import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { formatUsd } from '../../domain/loads';
import { colors } from '../theme';

export type DocumentViewData = {
  quantityMethod: 'weighbridge' | 'direct';
  companyName: string; companyAddress: string | null; companyPhone: string | null;
  companyEmail: string | null; companyTaxVatNumber: string | null; companyReceiptFooter: string | null;
  transactionNumber: string; dateTime: string; customerName: string; projectName: string | null;
  destinationAddress: string | null; itemName: string; driverName: string; truckPlate: string;
  requestedQuantityKg: number | null; emptyWeightKg: number | null; fullWeightKg: number | null;
  netWeightKg: number | null; convertedQuantity: number | null; outputUnitSymbol: string | null;
  unitPriceUsd: number | null; subtotalUsd: number | null; vatRatePercent: number | null;
  vatAmountUsd: number | null; finalTotalUsd: number | null;
  signaturePaths: string[];
};

export function LoadDocuments({ data, isDraft }: { data: DocumentViewData; isDraft: boolean }) {
  const [tab, setTab] = useState<'receipt' | 'authorization'>('receipt');
  const [paper, setPaper] = useState<'58' | '80'>('58');
  const missing = (value: string | number | null) => value === '' || value == null ? '—' : String(value);
  return (
    <View style={styles.wrapper}>
      <View style={styles.controls}>
        <Toggle label="Receipt" selected={tab === 'receipt'} onPress={() => setTab('receipt')} />
        <Toggle label="Delivery authorization" selected={tab === 'authorization'} onPress={() => setTab('authorization')} />
      </View>
      <View style={styles.controls}>
        <Toggle label="58 mm" selected={paper === '58'} onPress={() => setPaper('58')} />
        <Toggle label="80 mm" selected={paper === '80'} onPress={() => setPaper('80')} />
      </View>
      <View style={[styles.paper, paper === '80' && styles.paperWide]}>
        {isDraft ? <Text style={styles.draft}>DRAFT PREVIEW</Text> : null}
        <Text style={styles.company}>{missing(data.companyName)}</Text>
        {data.companyAddress ? <Text style={styles.contact}>{data.companyAddress}</Text> : null}
        {data.companyPhone ? <Text style={styles.contact}>{data.companyPhone}</Text> : null}
        {data.companyEmail ? <Text style={styles.contact}>{data.companyEmail}</Text> : null}
        {data.companyTaxVatNumber ? <Text style={styles.contact}>Tax/VAT: {data.companyTaxVatNumber}</Text> : null}
        <View style={styles.rule} />
        <Text style={styles.documentTitle}>{tab === 'receipt' ? 'RECEIPT' : 'DELIVERY AUTHORIZATION'}</Text>
        <Line label="Transaction" value={missing(data.transactionNumber)} />
        <Line label="Date" value={data.dateTime ? new Date(data.dateTime).toLocaleString() : '—'} />
        <Line label="Customer" value={missing(data.customerName)} />
        {data.projectName ? <Line label="Project" value={data.projectName} /> : null}
        <Line label="Item" value={missing(data.itemName)} />
        {tab === 'receipt' ? (
          <>
            <Line label="Quantity" value={data.convertedQuantity == null ? '—' : `${data.convertedQuantity} ${data.outputUnitSymbol ?? ''}`} />
            <Line label="Unit price" value={data.unitPriceUsd == null ? 'Unpriced' : formatUsd(data.unitPriceUsd)} />
            {data.unitPriceUsd != null ? <><Line label="Subtotal" value={formatUsd(data.subtotalUsd)} /><Line label="VAT rate" value={`${data.vatRatePercent ?? 0}%`} /><Line label="VAT amount" value={formatUsd(data.vatAmountUsd)} /><Line label="Final total" value={formatUsd(data.finalTotalUsd)} strong /></> : null}
          </>
        ) : (
          <>
            {data.destinationAddress ? <Line label="Destination" value={data.destinationAddress} /> : null}
            <Line label="Driver" value={missing(data.driverName)} />
            <Line label="Truck plate" value={missing(data.truckPlate)} />
            {data.quantityMethod==='weighbridge'?<>{data.requestedQuantityKg != null ? <Line label="Requested quantity" value={`${data.requestedQuantityKg} kg`} /> : null}<Line label="Empty weight" value={data.emptyWeightKg == null ? '—' : `${data.emptyWeightKg} kg`} /><Line label="Full weight" value={data.fullWeightKg == null ? '—' : `${data.fullWeightKg} kg`} /><Line label="Net weight" value={data.netWeightKg == null ? '—' : `${data.netWeightKg} kg`} strong /><Line label="Converted quantity" value={data.convertedQuantity == null ? '—' : `${data.convertedQuantity} ${data.outputUnitSymbol ?? ''}`} /></>:<Line label="Quantity" value={data.convertedQuantity == null ? '—' : `${data.convertedQuantity} ${data.outputUnitSymbol ?? ''}`} strong />}
            {data.signaturePaths.length ? <View style={styles.signature}><Svg width="100%" height={80} viewBox="0 0 320 140">{data.signaturePaths.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#111" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg><Text style={styles.signatureLabel}>Driver signature: {data.driverName}</Text></View> : <Line label="Driver signature" value="Unsigned" />}
          </>
        )}
        {data.companyReceiptFooter ? <><View style={styles.rule} /><Text style={styles.footer}>{data.companyReceiptFooter}</Text></> : null}
      </View>
      {isDraft ? <Text style={styles.previewNote}>Draft previews cannot be printed, shared, or exported.</Text> : null}
    </View>
  );
}

function Toggle({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <TouchableOpacity onPress={onPress} style={[styles.toggle, selected && styles.toggleSelected]}><Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>{label}</Text></TouchableOpacity>; }
function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <View style={styles.line}><Text style={[styles.lineText, strong && styles.strong]}>{label}:</Text><Text style={[styles.value, strong && styles.strong]}>{value}</Text></View>; }
const styles = StyleSheet.create({
  wrapper: { gap: 12 }, controls: { flexDirection: 'row', gap: 8 }, toggle: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 9, padding: 9, alignItems: 'center', backgroundColor: colors.surface }, toggleSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' }, toggleText: { color: colors.muted, fontSize: 12, fontWeight: '800' }, toggleTextSelected: { color: colors.brandDark },
  paper: { width: '78%', alignSelf: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: colors.line, padding: 16, gap: 7 }, paperWide: { width: '100%', paddingHorizontal: 24 }, draft: { color: colors.warning, textAlign: 'center', fontWeight: '900', letterSpacing: 1 }, company: { color: '#111', textAlign: 'center', fontSize: 20, fontWeight: '900' }, contact: { color: '#333', textAlign: 'center', fontSize: 11 }, rule: { height: 1, backgroundColor: '#222', marginVertical: 5 }, documentTitle: { color: '#111', textAlign: 'center', fontSize: 14, fontWeight: '900', marginBottom: 4 }, line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, lineText: { width: '43%', color: '#222', fontSize: 11, fontWeight: '700' }, value: { flex: 1, color: '#111', fontSize: 11 }, strong: { fontWeight: '900' }, footer: { color: '#333', textAlign: 'center', fontSize: 10 }, previewNote: { color: colors.muted, textAlign: 'center', fontSize: 12 },
  signature: { borderTopWidth: 1, borderTopColor: '#AAA', marginTop: 5 }, signatureLabel: { color: '#222', fontSize: 10, textAlign: 'center' },
});
