'use strict';
// Real Chromium, mocked Spotify transport. Coexistence uses pinned original Sort-Play-2 fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const sourceRoot = process.env.SORT_PLAY_SOURCE || path.join(__dirname,'fixtures/sort-play-2');
const structureFile = fs.existsSync(path.join(sourceRoot,'sort-play.js')) ? path.join(sourceRoot,'sort-play.js') : path.join(sourceRoot,'tracklist-structure.js');
if (!fs.existsSync(structureFile)) throw new Error('Sort Play compatibility sources are missing: '+sourceRoot);
function nativeFunction(source,name) {
  const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));
  if(start < 0) throw new Error('Missing original function: '+name);
  return source.slice(start,source.indexOf('\n  }',start)+6);
}
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>
body{background:#121212;color:#eee;font:14px sans-serif;margin:20px}main{width:100%}
.main-trackList-trackList{width:100%;box-sizing:border-box}
[role=row]{display:grid;grid-template-columns:[index] 16px [first] minmax(200px,1fr) [var1] 180px [var2] 128px [last] 110px;gap:16px;align-items:center;padding:0 12px;box-sizing:border-box;height:56px}
[role=columnheader],[role=gridcell]{min-width:0;overflow:hidden;white-space:nowrap}
.main-trackList-rowSectionEnd{grid-column:last}
[role=menu]{position:absolute;right:20px;top:90px;background:#282828;padding:8px;list-style:none;width:220px}
</style><body><main></main></body></html>`;
(async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});server.listen(0,'127.0.0.1');await once(server,'listening');
  const browser=await chromium.launch({headless:true,...(fs.existsSync(chromium.executablePath())?{}:{executablePath:'/usr/bin/chromium'}),args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:720}});page.setDefaultTimeout(6000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(()=>{
      window.calls=[];window.pending=new Map();window.path='/playlist/fixture';window.sortPlayClicks=0;
      window.Spicetify={Platform:{Transport:{},History:{location:{get pathname(){return window.path}},listen(fn){window.navigate=fn;return ()=>{window.navigate=null}}}}};
      function bytes(name,score=.9){const text=new TextEncoder().encode(name);const float=new Uint8Array(4);new DataView(float.buffer).setFloat32(0,score,true);return [10,text.length+7,10,text.length,...text,21,...float];}
      class MetadataService{
        static SERVICE_ID='spotify.mdata_esperanto.proto.MetadataService';
        async fetch(request){const uri=request.extensionQuery[0].entityUri[0];calls.push(uri);
          if(uri.endsWith('slow'))await new Promise(resolve=>pending.set(uri,resolve));
          if(uri.endsWith('error'))throw new Error('fixture failure');
          const value=uri.endsWith('empty')?[]:[...bytes(uri.endsWith('new')?'techno':'electro house'),...bytes('happy'),...bytes('brazil'),...bytes('house',.01)];
          return {extension:[{extensionKind:6,entityExtension:[{entityUri:uri,extensionData:{value}}]}]};
        }
      }
      const req=id=>({MetadataService});req.m={fixture:()=>{}};
      window.rspackChunk={push([ids,modules,callback]){return callback(req)}};
      window.build=(uri='spotify:track:fixture',wrapped=false)=>{
        document.querySelector('main').innerHTML='<div class="main-trackList-trackList" role="grid" aria-colcount="5"><div class="main-trackList-trackListHeaderRow" role="row" aria-rowindex="1"></div><div class="main-trackList-trackListRow" role="row" aria-rowindex="2"></div></div>';
        window.grid=document.querySelector('[role=grid]');window.row=grid.querySelector('.main-trackList-trackListRow');const header=grid.querySelector('.main-trackList-trackListHeaderRow');
        ['#','Título','Álbum','Adicionada em','Duração'].forEach((text,i)=>{
          for(const [parent,role]of[[header,'columnheader'],[row,'gridcell']]){
            const c=document.createElement('div');c.setAttribute('role',role);c.setAttribute('aria-colindex',i+1);
            c.className=i===4?'main-trackList-rowSectionEnd':i===1?'main-trackList-rowSectionStart':i===0?'main-trackList-rowSectionIndex':'main-trackList-rowSectionVariable';
            c.textContent=parent===header?text:['1','A.T.C.','Real Thing','há 2 dias','7:46'][i];parent.append(c);
          }
        });
        row.__reactProps$fixture={item:{uri,name:'A.T.C.',artists:[{name:'Fixture Artist'}]}};
        if(wrapped){const wrapper=document.createElement('div');wrapper.style.cssText=row.style.cssText;wrapper.style.display='grid';wrapper.style.gridTemplateColumns='16px minmax(200px,1fr) 180px 128px 110px';wrapper.style.gap='16px';wrapper.append(...row.children);row.append(wrapper);row.style.display='block';}
      };
      window.openMenu=()=>{
        document.querySelector('[role=menu]')?.remove();const menu=document.createElement('ul');menu.setAttribute('role','menu');menu.innerHTML='<li>Colunas</li>'+['Forma de onda','Álbum','Adicionada em','Data de lançamento','Duração'].map(t=>'<li><button role="menuitemcheckbox" aria-checked="true">'+t+'</button></li>').join('');document.body.append(menu);
      };
      build();
    });
    await page.addScriptTag({path:path.join(root,'Genre4all.js')});
    await page.locator('.g4a-data[data-genre-state=success]').waitFor();
    assert.equal(await page.locator('genre4all-column[data-kind=header]').count(),1);
    assert.equal(await page.locator('.g4a-genre-chip').filter({hasText:'happy'}).count(),0);
    assert.ok(await page.locator('.g4a-genre-chip').filter({hasText:'electro house'}).count());
    assert.equal(await page.evaluate(()=>row.offsetHeight),56);
    const ax=await (await page.context().newCDPSession(page)).send('Accessibility.getFullAXTree');
    assert.ok(ax.nodes.some(n=>n.role?.value==='columnheader'&&n.name?.value==='Gênero'),'ElementInternals exposes real accessibility role without light-DOM selector collisions');
    await page.evaluate(()=>openMenu());
    const toggle=page.getByRole('menuitemcheckbox',{name:'Gênero',exact:true});await toggle.waitFor().catch(async e=>{console.log(await page.locator('[role=menu]').evaluate(n=>n.outerHTML),errors);throw e});assert.equal(await toggle.getAttribute('aria-checked'),'true');
    await toggle.click();await page.waitForFunction(()=>!document.querySelector('genre4all-column'));
    assert.equal(await page.evaluate(()=>grid.style.cssText),'','no foreign inline style is replaced');
    await toggle.click();await page.locator('.g4a-data[data-genre-state=success]').waitFor();
    assert.equal(await page.evaluate(()=>calls.length),1,'toggling reuses the independent cache');
    await page.evaluate(()=>document.querySelector('[role=menu]').remove());
    await page.getByRole('button',{name:/Detalhes dos gêneros/}).click();await page.getByRole('dialog').waitFor();
    assert.match(await page.getByRole('dialog').textContent(),/Spotify/);
    await page.getByRole('button',{name:'Atualizar gêneros desta faixa'}).click();await page.locator('.g4a-data[data-genre-state=success]').waitFor();
    assert.ok(await page.evaluate(()=>calls.length)>=2,'refresh performs a fresh request');
    // Exact original Sort-Play-2 native functions, isolated from all unrelated features.
    {
      const source=fs.readFileSync(structureFile,'utf8');
      await page.addScriptTag({path:path.join(sourceRoot,'src/native-layout.js')});
      await page.addScriptTag({content:`
        var currentContext='playlist',showAdditionalColumn=true,showSecondAdditionalColumn=true;
        var selectedColumnType='tempo',selectedSecondColumnType='popularity',myScrobblesDisplayMode='count',removeDateAdded=false,excludedPlaylistNames=[];
        var getCurrentUri=()=>currentContext,getCurrentPlaylistName=()=> 'Fixture';
        var URI={isPlaylistV1OrV2:u=>u==='playlist'},isLikedSongsPage=()=>false,isLocalFilesPage=()=>false;
        var showColumnSelector=()=>{window.sortPlayClicks++};
        var nativeLayoutController=SortPlayNativeLayout.createController({getContext:()=>window.path});
        function syncNativeTracklistLayout(root){nativeLayoutController.sync(root,{context:'playlist',extras:{playlist1:selectedColumnType,playlist2:selectedSecondColumnType}})}
        ${nativeFunction(source,'updateTracklistStructure')}
      `});
      for(const extras of [2,1,0,2]){
        await page.evaluate(extras=>{showAdditionalColumn=extras>0;showSecondAdditionalColumn=extras>1;updateTracklistStructure(grid)},extras);
        await page.waitForFunction(()=>!!document.querySelector('.g4a-data[data-genre-state=success]'));
        await page.evaluate(()=>new Promise(r=>setTimeout(r,80)));
        const result=await page.evaluate(()=>{
          const row=document.querySelector('.main-trackList-trackListRow'),cs=[...row.children].filter(c=>getComputedStyle(c).display!=='none');
          return {boxes:cs.map(c=>({x:c.getBoundingClientRect().x,right:c.getBoundingClientRect().right,width:c.getBoundingClientRect().width,name:c.tagName==='GENRE4ALL-COLUMN'?'Genre4all':c.className})),genre:row.querySelectorAll('genre4all-column').length,slots:row.querySelectorAll('.sort-play-data-column,.sort-play-second-data-column').length,nativeRoles:[...row.children].filter(c=>c.matches('[role=gridcell]')).length};
        });
        assert.equal(result.genre,1);assert.equal(result.slots,extras);
        for(let i=1;i<result.boxes.length;i++)assert.ok(result.boxes[i].x>=result.boxes[i-1].right-1,JSON.stringify(result));
        assert.equal(result.nativeRoles,5+extras,'Sort Play role scans never consume Genre4all');
      }
      await page.addScriptTag({path:path.join(root,'Genre4all.js')});await page.locator('.g4a-data[data-genre-state=success]').waitFor();
      assert.equal(await page.locator('genre4all-column[data-kind=data]').count(),1,'loading after Sort Play is also idempotent');
      await page.locator('.sort-play-column-header').first().click();assert.equal(await page.evaluate(()=>sortPlayClicks),1,'Sort Play icon/header action is preserved');
      for(const file of ['genre-service.js','genre-column.js'])await page.addScriptTag({path:path.join(sourceRoot,'src',file)});
      await page.evaluate(async()=>{
        selectedColumnType='genre';updateTracklistStructure(grid);
        window.originalService=SortPlayGenres.createService({providers:{spotify:async()=>({provider:'spotify',status:'success',labels:SortPlayGenres.labelsFrom(['Original Sort Play genre']),expiresAt:Date.now()+3600000})}});
        await originalService.ready;
        window.originalView=SortPlayGenreColumn.createController(originalService,{getUri:r=>r.__reactProps$fixture?.item.uri,getTrack:r=>r.__reactProps$fixture?.item,getContext:()=>window.path,isEnabled:c=>c.matches('.sort-play-data')});
        originalView.sync(grid,[{type:'genre',dataSelector:'.sort-play-data'}]);
      });
      await page.locator('.sort-play-data[data-genre-state=success]').waitFor();
      assert.equal(await page.locator('.sort-play-data .sp-genre-chip').textContent(),'Original Sort Play genre');
      assert.ok(await page.locator('.g4a-data .g4a-genre-chip').count(),'both genre renderers coexist');
      assert.equal(await page.locator('#genre4all-column-style').count(),1);assert.equal(await page.locator('#sort-play-genre-column-style').count(),1);
      await page.evaluate(()=>{originalView.close();originalService.close();});
      await page.setViewportSize({width:620,height:720});
      await page.evaluate(()=>Genre4all.sync());await page.waitForTimeout(100);
      const reached=await page.evaluate(()=>{grid.scrollLeft=grid.scrollWidth;const g=row.querySelector('genre4all-column').getBoundingClientRect(),r=grid.getBoundingClientRect();return {ok:g.right<=r.right+1&&g.left>=r.left-1,g:g.toJSON(),r:r.toJSON(),scroll:grid.scrollLeft,width:grid.scrollWidth,html:grid.outerHTML.slice(0,3000)}});assert.ok(reached.ok,JSON.stringify(reached));assert.ok(reached,'Genre4all remains reachable when extra columns overflow');
      await page.evaluate(()=>{nativeLayoutController.close();build();Genre4all.sync()});
    }
    await page.evaluate(()=>{build('spotify:track:slow');Genre4all.sync()});
    await page.waitForFunction(()=>pending.has('spotify:track:slow'));
    await page.evaluate(()=>{row.__reactProps$fixture.item.uri='spotify:track:new';row.setAttribute('aria-rowindex','4');pending.get('spotify:track:slow')()});
    await page.locator('.g4a-data[data-genre-state=success]').waitFor();
    await page.waitForFunction(()=>document.querySelector('.g4a-data')?.textContent.includes('techno'));
    assert.ok(!(await page.locator('.g4a-data').textContent()).includes('electro house'),'late response never fills a recycled row');
    for(const state of ['empty','error']){
      await page.evaluate(state=>{build('spotify:track:'+state);Genre4all.sync()},state);
      await page.locator(`.g4a-data[data-genre-state=${state}]`).waitFor();
    }
    await page.evaluate(()=>{build('spotify:local:artist:album:title:200');Genre4all.sync()});await page.locator('.g4a-data[data-genre-state=unsupported]').waitFor();
    await page.evaluate(()=>{build('spotify:track:fixture',true);Genre4all.sync()});await page.locator('.g4a-data[data-genre-state=success]').waitFor();
    assert.equal(await page.locator('genre4all-column').count(),2,'nested row containers work');
    await page.addScriptTag({path:path.join(root,'Genre4all.js')});await page.locator('.g4a-data[data-genre-state=success]').waitFor();
    assert.equal(await page.locator('#genre4all-runtime-style').count(),1,'reload is idempotent');
    await page.evaluate(()=>Genre4all.setVisible(false));await page.reload();
    await page.evaluate(()=>{window.Spicetify={Platform:{History:{listen(){}}}}});await page.addScriptTag({path:path.join(root,'Genre4all.js')});
    assert.equal(await page.evaluate(()=>Genre4all.visible),false,'preference survives reload');
    await page.evaluate(()=>Genre4all.close());assert.equal(await page.locator('[id^=genre4all],genre4all-column,.g4a-row').count(),0);
    assert.deepEqual(errors,[]);
    console.log('Browser integration passed: standalone bundle, MetadataService wire format, native menu, refresh, original Sort Play extra columns, overflow, virtualization, statuses, nested rows, reload and cleanup. Mocked Spotify; not Spotify Desktop.');
  }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
})().catch(error=>{console.error(error);process.exitCode=1});
