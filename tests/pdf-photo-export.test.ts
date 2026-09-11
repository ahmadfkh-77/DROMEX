import {beforeEach,describe,expect,it,vi} from 'vitest';

const manipulateAsync=vi.fn();
const readAsStringAsync=vi.fn();

vi.mock('expo-image-manipulator',()=>({manipulateAsync,SaveFormat:{JPEG:'jpeg'}}));
vi.mock('expo-image-picker',()=>({}));
vi.mock('expo-file-system/legacy',()=>({
  documentDirectory:'file:///test/',
  readAsStringAsync,
  EncodingType:{Base64:'base64'},
  makeDirectoryAsync:vi.fn(),
  copyAsync:vi.fn(),
}));

const {photoDataUrlForPrint,photoDataUrlsForPrint}=await import('../src/services/media');

describe('photo preparation for PDF export',()=>{
  beforeEach(()=>{manipulateAsync.mockReset();readAsStringAsync.mockReset();});

  it('returns null for a missing photo',async()=>{
    await expect(photoDataUrlForPrint(null)).resolves.toBeNull();
    expect(manipulateAsync).not.toHaveBeenCalled();
  });

  it('downscales and re-encodes to JPEG instead of embedding the raw file',async()=>{
    manipulateAsync.mockResolvedValue({base64:'QUJD'});

    const result=await photoDataUrlForPrint('file:///camera/IMG_0001.jpg');

    // A full-resolution camera photo decodes to roughly 48 MB of bitmap in the
    // print WebView. Several of those exhaust its memory and it renders a blank
    // page with no error, which is the bug this guards.
    expect(manipulateAsync).toHaveBeenCalledTimes(1);
    const [uri,actions,options]=manipulateAsync.mock.calls[0]!;
    expect(uri).toBe('file:///camera/IMG_0001.jpg');
    expect(actions).toEqual([{resize:{width:1000}}]);
    expect(options).toMatchObject({format:'jpeg',base64:true});
    expect(options.compress).toBeLessThan(1);

    // Re-encoding also fixes a camera that writes HEIC: the raw path declared
    // every non-png, non-webp file as image/jpeg regardless of its real bytes.
    expect(result).toBe('data:image/jpeg;base64,QUJD');

    // The raw file must never be read straight into the document.
    expect(readAsStringAsync).not.toHaveBeenCalled();
  });

  it('fails loudly rather than embedding nothing when preparation yields no data',async()=>{
    manipulateAsync.mockResolvedValue({base64:undefined});

    await expect(photoDataUrlForPrint('file:///camera/IMG_0002.jpg')).rejects.toThrow();
  });
});

describe('preparing multiple photos for a document',()=>{
  beforeEach(()=>{manipulateAsync.mockReset();});

  it('processes photos one at a time, never more than one in flight, and preserves order',async()=>{
    let inFlight=0;
    let maxInFlight=0;
    const startedInOrder:string[]=[];

    // Each call reports itself as started, then yields the microtask queue
    // before resolving. If the caller used Promise.all, a second call would
    // start (and inFlight would reach 2) before the first one's timer fires.
    manipulateAsync.mockImplementation(async(uri:string)=>{
      inFlight+=1;
      maxInFlight=Math.max(maxInFlight,inFlight);
      startedInOrder.push(uri);
      await new Promise(resolve=>setTimeout(resolve,5));
      inFlight-=1;
      const label=uri.match(/([a-z])\.jpg$/)?.[1]??'x';
      return {base64:label};
    });

    const uris=['file:///camera/a.jpg','file:///camera/b.jpg','file:///camera/c.jpg'];
    const results=await photoDataUrlsForPrint(uris);

    expect(maxInFlight).toBe(1);
    expect(startedInOrder).toEqual(uris);
    expect(results).toEqual([
      'data:image/jpeg;base64,a',
      'data:image/jpeg;base64,b',
      'data:image/jpeg;base64,c',
    ]);
  });

  it('passes a missing photo through as null without invoking manipulation, keeping position',async()=>{
    manipulateAsync.mockResolvedValue({base64:'X'});

    const results=await photoDataUrlsForPrint(['file:///a.jpg',null,'file:///c.jpg']);

    expect(manipulateAsync).toHaveBeenCalledTimes(2);
    expect(results).toEqual(['data:image/jpeg;base64,X',null,'data:image/jpeg;base64,X']);
  });

  it('rejects the whole batch when one photo cannot be prepared, matching prior failure behaviour',async()=>{
    manipulateAsync
      .mockResolvedValueOnce({base64:'ok'})
      .mockResolvedValueOnce({base64:undefined});

    await expect(photoDataUrlsForPrint(['file:///a.jpg','file:///b.jpg','file:///c.jpg'])).rejects.toThrow();
    // The batch stopped at the failing photo rather than continuing past it.
    expect(manipulateAsync).toHaveBeenCalledTimes(2);
  });
});
