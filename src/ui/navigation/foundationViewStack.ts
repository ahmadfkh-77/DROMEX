/**
 * DEC-469. The Foundation workspace's navigation history, as a plain immutable stack.
 *
 * Before this, every screen's Back went to a hardcoded parent (`setView({kind:'overview'})`), so the
 * Concrete Matrix editor could only ever return to the lifts list -- never to the Stone phase it was
 * opened from, even though the two are consecutive steps of the same lift. Keeping the path actually
 * taken means Back retraces it, and the rule lives in one tested place instead of being re-decided at
 * every call site.
 */
export type FoundationLiftContext={liftId:string;reference:string;parentType:'foundation'|'wall'};
export type FoundationView=
  |{kind:'overview'}|{kind:'geometry'}|{kind:'lifts'}|{kind:'summary'}|{kind:'curing'}|{kind:'history'}|{kind:'diagram'}
  |{kind:'wall'}|{kind:'wallGeometry'}|{kind:'wallLifts'}|{kind:'wallMaterials'}|{kind:'wallHistory'}
  |{kind:'stoneEditor';lift:FoundationLiftContext}|{kind:'concreteEditor';lift:FoundationLiftContext}
  |{kind:'liftCorrection';lift:FoundationLiftContext};
export type FoundationViewKind=FoundationView['kind'];

/** The workspace always opens on the overview, which is the one screen Back can never pop away. */
export const initialFoundationViewStack=():FoundationView[]=>[{kind:'overview'}];

export function currentView(stack:FoundationView[]):FoundationView{
  return stack[stack.length-1]??{kind:'overview'};
}

export function pushView(stack:FoundationView[],next:FoundationView):FoundationView[]{
  return[...stack,next];
}

/** Pops one screen. At the root it is a no-op: leaving the workspace is the caller's decision (see `isRootView`). */
export function backView(stack:FoundationView[]):FoundationView[]{
  return stack.length>1?stack.slice(0,-1):stack;
}

/** True when Back should close the whole workspace and return to the Wall Construction directory. */
export function isRootView(stack:FoundationView[]):boolean{
  return stack.length<=1;
}

/**
 * Returns to an earlier screen by kind, dropping everything above it -- what a successful save wants,
 * so the editor it was saved from is not left on the stack for Back to walk into again. A screen that
 * was never visited collapses to the root rather than inventing history.
 */
export function popToView(stack:FoundationView[],kind:FoundationViewKind):FoundationView[]{
  for(let index=stack.length-1;index>=0;index-=1){
    if(stack[index]!.kind===kind)return stack.slice(0,index+1);
  }
  return initialFoundationViewStack();
}
