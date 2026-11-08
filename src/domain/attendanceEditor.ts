import type {AttendanceEntry,AttendancePlace,AttendanceSubject,AttendanceSubjectType} from './attendance';

/**
 * DEC-544. The editing rules of the attendance screen, apart from the screen. The editor holds the day as the user changes it and writes nothing
 * until Save attendance; `diffEditor` says exactly what to write. A person, truck or machine is "worked" when it has an entry; adding a place marks
 * it as worked, taking the mark off clears its places, and taking the last place off removes the mark. Every function returns a new state.
 */
export type EditorEntry={worked:true;places:AttendancePlace[]};
export type EditorState=Record<string,EditorEntry>;

export const editorKey=(subject:AttendanceSubject)=>`${subject.type}:${subject.id}`;
const subjectOf=(key:string):AttendanceSubject=>{const at=key.indexOf(':');return {type:key.slice(0,at) as AttendanceSubjectType,id:key.slice(at+1)};};
const placeKey=(place:AttendancePlace)=>place.type==='typed'?`typed:${place.name.toLowerCase()}`:`${place.type}:${place.id}`;
const clean=(name:string)=>name.replace(/\s+/g,' ').trim();

/** The editor as it starts: what is saved for the day. */
export function editorFromEntries(entries:readonly AttendanceEntry[]):EditorState{
  return Object.fromEntries(entries.map(entry=>[editorKey({type:entry.subjectType,id:entry.subjectId}),{worked:true as const,places:entry.places.map(p=>({...p}))}]));
}

/** Tapping the name: marks worked (with no place yet), or takes the mark off and clears the places. */
export function toggleWorked(state:EditorState,subject:AttendanceSubject):EditorState{
  const key=editorKey(subject);
  if(state[key]){const {[key]:_removed,...rest}=state;return rest;}
  return {...state,[key]:{worked:true,places:[]}};
}

function withPlaces(state:EditorState,subject:AttendanceSubject,places:AttendancePlace[]):EditorState{
  const key=editorKey(subject);
  if(!places.length){const {[key]:_removed,...rest}=state;return rest;}
  return {...state,[key]:{worked:true,places}};
}

/** Chooses a place, or takes it off if it was already chosen. Choosing one marks the entry as worked; taking the last one off removes the mark. */
export function togglePlace(state:EditorState,subject:AttendanceSubject,place:AttendancePlace):EditorState{
  const current=state[editorKey(subject)]?.places??[];const wanted=placeKey(place);
  return withPlaces(state,subject,current.some(p=>placeKey(p)===wanted)?current.filter(p=>placeKey(p)!==wanted):[...current,{...place}]);
}

/** A typed place: free text for this day only, once, whatever the capital letters. Empty text changes nothing. */
export function addTypedPlace(state:EditorState,subject:AttendanceSubject,name:string):EditorState{
  const text=clean(name);if(!text)return state;
  const current=state[editorKey(subject)]?.places??[];
  if(current.some(p=>p.type==='typed'&&p.name.toLowerCase()===text.toLowerCase()))return state;
  return withPlaces(state,subject,[...current,{type:'typed',id:null,name:text}]);
}

/** How many of the given people, trucks or machines are marked as worked: the "x of N worked" line. */
export const countWorked=(state:EditorState,subjects:readonly AttendanceSubject[])=>subjects.filter(subject=>state[editorKey(subject)]).length;

/** Who is marked as worked but has no place yet. Save asks for a place for each of them. */
export const missingPlaces=(state:EditorState):AttendanceSubject[]=>Object.entries(state).filter(([,entry])=>!entry.places.length).map(([key])=>subjectOf(key));

/** What Save writes: entries that are new or whose places changed, and entries whose mark was taken off. A marked entry with no place is not written. */
export function diffEditor(saved:readonly AttendanceEntry[],state:EditorState):{save:{subject:AttendanceSubject;places:AttendancePlace[]}[];remove:AttendanceSubject[]}{
  const before=editorFromEntries(saved);
  const save=Object.entries(state).filter(([key,entry])=>{
    if(!entry.places.length)return false;
    const old=before[key];return !old||old.places.map(placeKey).join('|')!==entry.places.map(placeKey).join('|');
  }).map(([key,entry])=>({subject:subjectOf(key),places:entry.places}));
  const remove=Object.keys(before).filter(key=>!state[key]).map(subjectOf);
  return {save,remove};
}
