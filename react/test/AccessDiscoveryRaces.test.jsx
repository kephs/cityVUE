import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import AccessDiscovery, { useAccessRead } from '../src/admin/AccessDiscovery.jsx';

const staff=(id)=>({id,displayName:`Staff ${id}`,active:true,categories:[],source:'none',departments:0,divisions:0});
const page=(name)=>({items:[staff(name)],total:1,organizationTotal:1,page:1,pageSize:25});
const detail=(id)=>({staff:staff(id),permissions:[],effective:[],contributions:[],departments:[],divisions:[],accessAdministrator:false});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function finish(promise,value){await act(async()=>{promise.resolve(value);await promise.promise;});}
function clientWith(handler){return {get:vi.fn((url,options)=>{
  if(url.endsWith('/scopes'))return Promise.resolve({departments:[],divisions:[]});
  if(url.endsWith('/permissions'))return Promise.resolve({items:[]});
  return handler(url,options);
})};}
test('Search race: late Dev cannot replace Development results',async()=>{
  const a=deferred(),b=deferred();const client=clientWith(url=>{
    const search=new URLSearchParams(url.split('?')[1]).get('search');
    return search==='Dev'?a.promise:search==='Development'?b.promise:Promise.resolve(page('initial'));
  });
  const user=userEvent.setup();render(<AccessDiscovery client={client}/>);
  await screen.findByText('Staff initial');await user.type(screen.getByLabelText('Search Staff'),'Dev');
  await waitFor(()=>expect(client.get.mock.calls.some(([url])=>new URLSearchParams(url.split('?')[1]).get('search')==='Dev')).toBe(true));
  await user.type(screen.getByLabelText('Search Staff'),'elopment');
  await waitFor(()=>expect(client.get.mock.calls.some(([url])=>new URLSearchParams(url.split('?')[1]).get('search')==='Development')).toBe(true));
  await finish(b,page('Development'));await screen.findByText('Staff Development');await finish(a,page('Dev'));
  expect(screen.getByText('Staff Development')).toBeVisible();expect(screen.queryByText('Staff Dev')).not.toBeInTheDocument();
});
test('Filter race: late active filter cannot replace inactive results',async()=>{
  const a=deferred(),b=deferred();const client=clientWith(url=>{const status=new URLSearchParams(url.split('?')[1]).get('status');return status==='active'?a.promise:status==='inactive'?b.promise:Promise.resolve(page('initial'));});
  const user=userEvent.setup();render(<AccessDiscovery client={client}/>);await screen.findByText('Staff initial');
  await user.selectOptions(screen.getByLabelText('Reqro Status'),'active');await user.selectOptions(screen.getByLabelText('Reqro Status'),'inactive');
  await finish(b,page('inactive'));await finish(a,page('active'));expect(screen.getByText('Staff inactive')).toBeVisible();expect(screen.queryByText('Staff active')).not.toBeInTheDocument();
});
test('Page race: production read hook keeps page 2 when pending page 1 finishes last',async()=>{
  const a=deferred(),b=deferred();const client=clientWith(url=>url.endsWith('page=1')?a.promise:b.promise);
  // Initial pending list has no pagination controls; rerender changes the same
  // production hook path used by list navigation without fabricating loaded data.
  function Harness({pageNumber}){const state=useAccessRead(client,`/admin/access/principals?page=${pageNumber}`);return <p>{state?.data?.label||'Loading'}</p>;}
  const view=render(<Harness pageNumber={1}/>);expect(client.get).toHaveBeenCalledTimes(1);
  view.rerender(<Harness pageNumber={2}/>);expect(client.get).toHaveBeenCalledTimes(2);
  await finish(b,{label:'Page two'});await finish(a,{label:'Page one'});expect(screen.getByText('Page two')).toBeVisible();expect(screen.queryByText('Page one')).not.toBeInTheDocument();
});
test('Detail race: Staff A response cannot populate Staff B drawer',async()=>{
  const a=deferred(),b=deferred();const client=clientWith(url=>url.includes('principals?')?Promise.resolve({...page('A'),items:[staff('A'),staff('B')],total:2}):url.endsWith('/A')?a.promise:b.promise);
  const user=userEvent.setup();render(<AccessDiscovery client={client}/>);await user.click(await screen.findByRole('button',{name:'View Access for Staff A'}));
  await user.click(screen.getByRole('button',{name:'Close configuration'}));await user.click(screen.getByRole('button',{name:'View Access for Staff B'}));
  await finish(b,detail('B'));await finish(a,detail('A'));
  expect(screen.getByRole('dialog')).toHaveTextContent('Staff B');expect(screen.getByRole('dialog')).not.toHaveTextContent('Staff A');
});
test('History race: Staff A history cannot replace Staff B history',async()=>{
  const a=deferred(),b=deferred();const client=clientWith(url=>{
    if(url.includes('principals?'))return Promise.resolve({...page('A'),items:[staff('A'),staff('B')],total:2});
    if(url.includes('/history'))return url.includes('/A/')?a.promise:b.promise;
    return Promise.resolve(detail(url.endsWith('/A')?'A':'B'));
  });
  const user=userEvent.setup();render(<AccessDiscovery client={client}/>);await user.click(await screen.findByRole('button',{name:'View Access for Staff A'}));await user.click(await screen.findByRole('button',{name:'View Access History'}));
  await user.click(screen.getByRole('button',{name:'Close configuration'}));await user.click(screen.getByRole('button',{name:'View Access for Staff B'}));await user.click(await screen.findByRole('button',{name:'View Access History'}));
  const history=actor=>({page:1,pageSize:25,total:1,items:[{id:actor,actor,operation:'update_managed_access',createdAt:'2026-01-01T00:00:00Z',deltas:[]}]});
  await finish(b,history('B recorded actor'));await finish(a,history('A recorded actor'));expect(screen.getByRole('dialog')).toHaveTextContent('B recorded actor');expect(screen.getByRole('dialog')).not.toHaveTextContent('A recorded actor');
});
