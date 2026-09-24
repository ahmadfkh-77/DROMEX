import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

// Static contract for the Project Command Center action cards (the `polished` MenuAction variant,
// used only there): each action is its own bordered card, readable, without a coloured side stripe
// or an ordinal number. No React Native renderer is available in this suite.
const source=readFileSync(join(__dirname,'..','src/ui/components/ExpandableMenu.tsx'),'utf8');
const style=(name:string)=>new RegExp(`${name}:\\{([^}]*)\\}`).exec(source)?.[1]??'';

describe('Project Command Center action cards',()=>{
  it('are separate bordered cards with no coloured side stripe',()=>{
    const card=style('actionCard');
    expect(card).toContain('borderWidth:1');
    expect(card).toContain('borderLeftWidth:1');
    expect(card).not.toMatch(/borderLeftColor:colors\.(navy|brand)/);
    expect(style('actionCards')).toMatch(/gap:1\d/);
  });
  it('drop the ordinal number and keep descriptions readable',()=>{
    expect(source).toMatch(/\{polished\?null:<Text style=\{\[styles\.number/);
    expect(Number(/fontSize:(\d+)/.exec(style('actionCardBody'))?.[1])).toBeGreaterThanOrEqual(13);
  });
  it('announce the title and what the action does',()=>{
    expect(source).toContain('accessibilityLabel={title} accessibilityHint={body}');
  });
});
