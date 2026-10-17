export type CreateAction='receipt'|'dailyReport'|'waste'|'quarry'|'fuelDelivery'|'equipmentFill'|'quickText'|'schedule'|'issue'|'photo';
export type CreateTone='orange'|'navy'|'teal';
export type CreateActionDef={id:CreateAction;title:string;hint:string;/** Without an active project this action goes to the Projects list first. */needsProject?:boolean};
export type CreateGroup={title:string;tone:CreateTone;actions:CreateActionDef[]};

/** The ten actions behind the + button, in three groups. Make Receipt leads the first group as the main tile. */
export const createGroups:CreateGroup[]=[
  {title:'LOADS AND DOCUMENTS',tone:'orange',actions:[
    {id:'receipt',title:'Make Receipt',hint:'An outgoing load and its documents'},
    {id:'quickText',title:'Quick Text',hint:'A printable company document'},
  ]},
  {title:'SITE WORK',tone:'navy',actions:[
    {id:'dailyReport',title:'Daily Report',hint:'Today’s work, people, photos'},
    {id:'schedule',title:'Scheduled Work',hint:'Plan work under a project'},
    {id:'waste',title:'Waste Dump',hint:'Driver counters or one-off'},
    {id:'issue',title:'Project Issue',hint:'A blocker or follow-up',needsProject:true},
    {id:'photo',title:'Site Photo',hint:'Add to this project',needsProject:true},
  ]},
  {title:'MATERIAL AND FUEL',tone:'teal',actions:[
    {id:'quarry',title:'Supplier Load',hint:'Items from a supplier, with cost'},
    {id:'fuelDelivery',title:'Fuel Delivery',hint:'Fuel into the tank'},
    {id:'equipmentFill',title:'Equipment Fill',hint:'Fuel to equipment'},
  ]},
];
