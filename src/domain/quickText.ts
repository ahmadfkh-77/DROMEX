import type {PaperWidth} from '../services/documentTemplates';
export type QuickTextAlignment='left'|'center'|'right';
export type QuickTextEmphasis='normal'|'bold'|'notice';
export type QuickTextDraft={title:string;reference:string;customerId:string;projectId:string;message:string;alignment:QuickTextAlignment;emphasis:QuickTextEmphasis;preparedBy:string;showSignatureLine:boolean;paperWidth:PaperWidth};
export type QuickTextDocument={id:string;documentNumber:string;createdAt:string;title:string;reference:string|null;customerId:string|null;customerName:string|null;projectId:string|null;projectName:string|null;message:string;alignment:QuickTextAlignment;emphasis:QuickTextEmphasis;preparedBy:string|null;showSignatureLine:boolean;paperWidth:PaperWidth;companyName:string;companyAddress:string|null;companyPhone:string|null;companyEmail:string|null;companyTaxVatNumber:string|null;companyReceiptFooter:string|null;companyLogoUri:string|null};
export type QuickTextCompany={name:string;address:string|null;phone:string|null;email:string|null;taxVatNumber:string|null;receiptFooter:string|null;logoUri:string|null};
export type QuickTextSetup={customers:{id:string;name:string}[];projects:{id:string;name:string;customerId:string;customerName:string}[];company:QuickTextCompany};
export const emptyQuickTextDraft:QuickTextDraft={title:'Quick Text',reference:'',customerId:'',projectId:'',message:'',alignment:'left',emphasis:'normal',preparedBy:'',showSignatureLine:false,paperWidth:'58'};
