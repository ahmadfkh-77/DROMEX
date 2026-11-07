import qrcode from 'qrcode-generator';

/**
 * DEC-541. Draws the receipt QR. One matrix feeds both outputs: an SVG for the PDF and an ESC/POS raster for the thermal printer, so what the
 * PDF shows and what the printer prints always encode the same text. Text is encoded as UTF-8, so an Arabic project name scans correctly.
 */
const QUIET_ZONE=4;

export function receiptQrMatrix(payload:string):boolean[][]{
  qrcode.stringToBytes=qrcode.stringToBytesFuncs['UTF-8']!;
  const code=qrcode(0,'M');
  code.addData(payload);
  code.make();
  const size=code.getModuleCount();
  return Array.from({length:size},(_,row)=>Array.from({length:size},(_,column)=>code.isDark(row,column)));
}

/** A scalable, crisp SVG (one path of unit squares) with its quiet zone; the caller sets the printed size. */
export function receiptQrSvg(payload:string):string{
  const matrix=receiptQrMatrix(payload),total=matrix.length+QUIET_ZONE*2;
  const cells=matrix.flatMap((row,y)=>row.map((dark,x)=>dark?`M${x+QUIET_ZONE} ${y+QUIET_ZONE}h1v1h-1z`:'')).join('');
  return `<svg viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="Verification QR code"><rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${cells}"/></svg>`;
}

/** ESC/POS `GS v 0` raster bytes (1 = black), whole dots per module so the code stays scannable on a 58 or 80 mm printer. */
export function receiptQrRaster(payload:string,paper:'58'|'80'):{widthBytes:number;height:number;pixels:Uint8Array;scale:number}{
  const matrix=receiptQrMatrix(payload),modules=matrix.length+QUIET_ZONE*2;
  const maxDots=paper==='58'?288:384;
  const scale=Math.max(2,Math.floor(maxDots/modules));
  const width=modules*scale,widthBytes=Math.ceil(width/8),pixels=new Uint8Array(widthBytes*width);
  matrix.forEach((row,y)=>row.forEach((dark,x)=>{
    if(!dark)return;
    for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
      const px=(x+QUIET_ZONE)*scale+dx,py=(y+QUIET_ZONE)*scale+dy,index=py*widthBytes+(px>>3);
      pixels[index]=(pixels[index]??0)|(0x80>>(px&7));
    }
  }));
  return{widthBytes,height:width,pixels,scale};
}
