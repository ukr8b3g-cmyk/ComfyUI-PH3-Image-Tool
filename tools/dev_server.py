"""Isolated editor/API harness. Not ComfyUI, not a model runtime.

Run with --mock-generation to simulate result delivery for browser regression tests.
Nothing in the installed extension imports this file.
"""
from __future__ import annotations
import argparse
import asyncio
import importlib
import io
from pathlib import Path
import sys
import types
import uuid
from aiohttp import web
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
PKG="ph3tool_dev"
package=types.ModuleType(PKG);package.__path__=[str(ROOT)];sys.modules[PKG]=package
storage=importlib.import_module(PKG+'.storage')
generation=importlib.import_module(PKG+'.generation')
api=importlib.import_module(PKG+'.api')
MODELS={'diffusion_models':['minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
 'text_encoders':['p-h3-image_text_encoder_int8_convrot.safetensors','p-h3-image_prompt_upsampler_w4a8.safetensors'],
 'vae':['p-h3-image_vae_int8_convrot.safetensors'],'loras':['P-H3-Image/p-h3-image_lora_bf16.safetensors'],
 'samplers':['er_sde','euler'],'missing_nodes':[],'enhancer_available':True,
 'cutout':{'onnx_available':False,'model_available':False}}
NAMES=set(generation.CORE_NODES)|{'PH3ImageToolAsset','PH3ImageToolResult','TextGenerateV2','PH3ImageToolTextResult'}


def make_app(root, mock_generation=False, delay=.8):
    store=storage.Store(root);app=web.Application(client_max_size=260*1024*1024);routes=web.RouteTableDef()
    api.register_routes(routes,lambda:store,lambda:{**MODELS,'storage':str(store.root)},lambda:NAMES)
    history={};running=[];pending=[];tasks=set();prompt_tasks={}
    @routes.get('/')
    async def index(request):
        return web.Response(text='''<!doctype html><html><head><meta charset="utf-8"><title>PH3 Image Tool — isolated test harness</title></head><body style="background:#111;color:#eee;font:14px system-ui"><p>ISOLATED TEST HARNESS — no ComfyUI, no P-H3 model inference.</p><script type="module">
import {Client} from '/web/client.mjs';import {openStudio} from '/web/studio.mjs';
const client=new Client();const id=new URLSearchParams(location.search).get('project')||'';
window.ph3Harness={client,editor:await openStudio({client,hostLocale:new URLSearchParams(location.search).get('locale'),projectId:id,onApply:record=>{window.ph3Applied=record;},onClose:()=>{}})};
</script></body></html>'''.replace('/web/studio.mjs', '/web/studio.mjs?v='+str((Path(__file__).resolve().parents[1]/'web/studio.mjs').stat().st_mtime_ns)),content_type='text/html')
    @routes.get('/fixture.png')
    async def fixture(request):
        image=Image.new('RGBA',(640,480),'#70a897');d=ImageDraw.Draw(image)
        d.rounded_rectangle((160,130,490,400),radius=32,fill='#f5ead6');d.rectangle((220,315,440,350),fill='#d0b0a0');d.ellipse((260,170,370,280),fill='#ba5a61')
        d.text((25,25),'PH3 Image Tool / CPU TEST IMAGE',fill='white');buf=io.BytesIO();image.save(buf,format='PNG');return web.Response(body=buf.getvalue(),content_type='image/png')
    @routes.post('/prompt')
    async def prompt(request):
        if not mock_generation:return web.json_response({'error':{'message':'Test harness never performs model inference. Enable --mock-generation explicitly for simulated delivery.'}},status=503)
        payload=await request.json();graph=payload['prompt'];job_id=graph['90']['inputs']['job_id'];prompt_id=str(uuid.uuid4());job=store.job(job_id)
        entry=[0,prompt_id,graph,{},['90']];running.append(entry)
        async def finish():
            try:
                await asyncio.sleep(delay)
                if job['request']['mode']=='enhance':store.finish_job(job_id,text='Edit <Picture 1>. Add one red apple on the palm. Keep unrelated details. [SIMULATED TEST]')
                else:
                    req=job['request'];size=tuple(req['generation_size'])
                    if req['mode']=='lettering':
                        image=Image.new('RGB',size,'white');d=ImageDraw.Draw(image);w,h=size
                        from ph3tool_dev.lettering import vertical_units
                        lines=vertical_units(req['lettering']['text']) if req['lettering']['vertical'] else req['lettering']['text'].splitlines()
                        font_path=Path('C:/Windows/Fonts/meiryo.ttc')
                        point=max(12,int(min(w*.6/max(1,max(map(len,lines))),h*.6/max(1,len(lines)))))
                        font=ImageFont.truetype(str(font_path),point) if font_path.exists() else ImageFont.load_default(size=point)
                        for i,line in enumerate(lines):d.text((w/2,h*.25+i*h*.5/max(1,len(lines))),line,font=font,anchor='mt',fill='black')
                        d.text((w*.4,h*.87),'SIMULATED TEST',fill='black')
                    else:
                        image=store.image(req['crop_asset']).resize(size) if req.get('crop_asset') else Image.new('RGBA',size,'#559a8d')
                        image=image.copy();d=ImageDraw.Draw(image);w,h=size;d.ellipse((w*.25,h*.2,w*.7,h*.75),fill='#b83749');d.text((8,8),'SIMULATED TEST',fill='white')
                    generation.capture_images(store,job_id,[image])
                history[prompt_id]={'status':{'status_str':'success','completed':True},'outputs':{'90':{'ph3_job':[job_id]}}}
            except Exception as exc:
                history[prompt_id]={'status':{'status_str':'error','messages':[['execution_error',{'exception_message':str(exc)}]]}}
            finally:
                if entry in running:running.remove(entry)
        task=asyncio.create_task(finish());prompt_tasks[prompt_id]=task;tasks.add(task);task.add_done_callback(tasks.discard)
        return web.json_response({'prompt_id':prompt_id,'number':0,'node_errors':{}})
    @routes.post('/api/jobs/{id}/cancel')
    async def cancel_one(request):
        task=prompt_tasks.get(request.match_info['id'])
        cancelled=bool(task and not task.done())
        if cancelled:
            task.cancel()
            await asyncio.gather(task,return_exceptions=True)
        return web.json_response({'cancelled':cancelled})
    @routes.get('/history/{id}')
    async def get_history(request):
        key=request.match_info['id'];return web.json_response({key:history[key]} if key in history else {})
    @routes.get('/queue')
    async def queue(request):return web.json_response({'queue_running':running,'queue_pending':pending})
    @routes.post('/queue')
    async def cancel(request):return web.json_response({})
    app.add_routes(routes);app.router.add_static('/web/',ROOT/'web')
    async def cleanup(application):
        for task in tasks:task.cancel()
        if tasks:await asyncio.gather(*tasks,return_exceptions=True)
    app.on_cleanup.append(cleanup)
    return app

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8767);parser.add_argument('--data',default=str(ROOT/'.test-data'));parser.add_argument('--mock-generation',action='store_true');parser.add_argument('--delay',type=float,default=.8);args=parser.parse_args()
    web.run_app(make_app(args.data,args.mock_generation,args.delay),host='127.0.0.1',port=args.port,print=print)
