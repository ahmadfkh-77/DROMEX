import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';

import type {CompanyHeaderRepository} from '../../data/repositories/CompanyHeaderRepository';
import {listHeaderFrom,type HeaderCompany,type HeaderCompanyKind} from '../../domain/companyHeaders';
import {HeaderCompanyPicker} from './HeaderCompanyPicker';

/**
 * Phase 5. Lets any export screen offer the shared Header company picker without threading props through every
 * layer: the app provides the repository once, and an export calls `useExportHeader()`. Without a provider (such
 * as in a test) the picker is simply absent and the export keeps using the Plant Company profile, as before.
 */
type HeaderCompaniesValue={headers:CompanyHeaderRepository;openSetups:()=>void};
const HeaderCompaniesContext=createContext<HeaderCompaniesValue|null>(null);
export function HeaderCompaniesProvider({headers,openSetups,children}:{headers:CompanyHeaderRepository;openSetups:()=>void;children:ReactNode}){
  return <HeaderCompaniesContext.Provider value={{headers,openSetups}}>{children}</HeaderCompaniesContext.Provider>;
}

export type ListHeader={companyName:string;logoUri:string|null;contactLine:string|null};

/**
 * The picker element and a `resolve()` that returns the chosen header (and remembers it for `projectId` when the
 * checkbox is ticked). `resolve()` is null without a provider, so callers fall back to the Company profile.
 */
export function useExportHeader(projectId?:string|null):{picker:ReactNode;resolve:()=>Promise<{header:HeaderCompany;list:ListHeader}|null>}{
  const context=useContext(HeaderCompaniesContext);
  const[kind,setKind]=useState<HeaderCompanyKind>('plant');
  const[remember,setRemember]=useState(false);
  const headers=context?.headers;
  useEffect(()=>{
    if(!headers||!projectId)return;
    let active=true;
    headers.getProjectHeaderDefault(projectId).then(stored=>{if(active)setKind(stored);}).catch(()=>undefined);
    return()=>{active=false;};
  },[headers,projectId]);
  const picker=context?<HeaderCompanyPicker headers={context.headers} value={kind} onChange={setKind} remember={projectId?{checked:remember,onChange:setRemember}:undefined} onOpenSetups={context.openSetups}/>:null;
  const resolve=async()=>{
    if(!headers)return null;
    const header=await headers.resolveHeader(kind);
    if(remember&&projectId)await headers.setProjectHeaderDefault(projectId,header.kind);
    return {header,list:listHeaderFrom(header)};
  };
  return {picker,resolve};
}
