const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
const STATE = { idle:0, listening:1, thinking:2, executing:3, responding:4, success:5, error:6, offline:7 };
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const presets={eco:{particles:6500,pixelRatio:1,glow:.75},balanced:{particles:22000,pixelRatio:1.25,glow:1},high:{particles:42000,pixelRatio:1.5,glow:1.35}};
const colors={idle:0x9b72ff,listening:0x70e5ff,thinking:0xc5a6ff,executing:0xfb4668,responding:0xe458d0,success:0x76e8b4,error:0xfb4668,offline:0x5e566d};
function fallbackCore(host,onStatus,options){
  const canvas=document.createElement("canvas");canvas.className="core-canvas";canvas.setAttribute("aria-label","Animated energy core visualization; system state is also shown in text.");canvas.setAttribute("role","img");host.append(canvas);
  const ctx=canvas.getContext("2d");if(!ctx){onStatus?.({available:false,reason:"Canvas rendering unavailable"});return {setState(){},setOptions(){},dispose(){canvas.remove()}}}
  const reduced=()=>options.reducedMotion||matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width=0,height=0,frame=0,live=true,state="idle",time=0;
  let particles=[];
  const resize=()=>{const rect=host.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);const dpr=Math.min(window.devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+"px";canvas.style.height=height+"px";ctx.setTransform(dpr,0,0,dpr,0,0);const n=window.innerWidth<700?65:130;particles=Array.from({length:n},(_,i)=>({a:Math.random()*Math.PI*2,r:.1+Math.random()*.45,z:Math.random()*Math.PI*2,s:.35+Math.random()*1.7}));};
  const draw=()=>{if(!live)return;frame=requestAnimationFrame(draw);if(document.hidden){return}time+=reduced()?0.0007:.006*(Number(options.speed)||1);ctx.clearRect(0,0,width,height);const cx=width/2,cy=height*.47,R=Math.min(width,height)*.19;const accent=colors[state]||colors.idle;ctx.save();ctx.globalCompositeOperation="lighter";const gradient=ctx.createRadialGradient(cx,cy,1,cx,cy,R*1.4);gradient.addColorStop(0,"rgba(238,222,255,.9)");gradient.addColorStop(.16,"rgba(176,130,255,.58)");gradient.addColorStop(.55,"rgba(112,57,198,.15)");gradient.addColorStop(1,"rgba(75,22,110,0)");ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(cx,cy,R*1.4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#"+accent.toString(16).padStart(6,"0");ctx.globalAlpha=.32;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(cx,cy,R*(1.4+i*.2),R*(.32+i*.07),time*(.12+i*.05)*(i%2?-1:1),0,Math.PI*2);ctx.stroke()}ctx.globalAlpha=.75;particles.forEach(p=>{const t=p.a+time*p.s*.15;const rr=R*(.55+p.r);const x=cx+Math.cos(t)*rr;const y=cy+Math.sin(t)*rr*.8+Math.sin(time+p.z)*R*.04;ctx.fillStyle=iColor(p.s,accent);ctx.globalAlpha=.18+p.s*.12;ctx.beginPath();ctx.arc(x,y,clamp(p.s*(Number(options.glow)||1),.4,2.5),0,Math.PI*2);ctx.fill()});ctx.restore();};
  function iColor(s,color){return color===colors.listening?"#70e5ff":color===colors.executing||color===colors.error?"#fb4668":color===colors.responding?"#e458d0":"#bd9dff"}
  const observer=new ResizeObserver(resize);observer.observe(host);const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame)}else if(live)draw()};document.addEventListener("visibilitychange",visibility);resize();draw();onStatus?.({available:false,fallback:true,reason:"Three.js/WebGL unavailable; using reduced canvas core"});
  return {setState(v){state=STATE[v]===undefined?"idle":v},setOptions(v){options={...options,...v};resize()},dispose(){live=false;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener("visibilitychange",visibility);canvas.remove()}};
}
export async function createEnergyCore(host,onStatus=()=>{},initialOptions={}){
  let options={quality:"balanced",speed:1,scale:1,glow:1,orbit:1,turbulence:.5,reducedMotion:false,...initialOptions};
  if(!host)return {setState(){},setOptions(){},dispose(){}};
  let THREE;
  try{THREE=await import(THREE_URL)}catch(error){return fallbackCore(host,onStatus,options)}
  let renderer,scene,camera,cloud,nucleus,ambient,orbital=[],frame=0,disposed=false,state="idle",time=0,resizeObserver=null,geometry=null,material=null;
  try{
    const isMobile=window.matchMedia("(max-width: 700px)").matches;
    const lowDevice=(navigator.deviceMemory&&navigator.deviceMemory<=4)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4);
    if(isMobile||lowDevice)options.quality="eco";
    renderer=new THREE.WebGLRenderer({alpha:true,antialias:!isMobile,powerPreference:lowDevice?"low-power":"high-performance",premultipliedAlpha:false});
    renderer.setClearColor(0x000000,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
    host.append(renderer.domElement);renderer.domElement.className="core-canvas";renderer.domElement.setAttribute("aria-label","Three-dimensional animated energy core. State is also provided in text.");renderer.domElement.setAttribute("role","img");
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(43,1,.1,200);camera.position.set(0,0,40);
    ambient=new THREE.Group();scene.add(ambient);
    const nucleusGeo=new THREE.SphereGeometry(3.05,48,36);
    const nucleusMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uTime:{value:0},uPulse:{value:0},uColor:{value:new THREE.Color(colors.idle)},uReduced:{value:0}},vertexShader:`varying vec3 vNormal;varying vec3 vPos;void main(){vNormal=normalize(normalMatrix*normal);vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`uniform float uTime;uniform float uPulse;uniform vec3 uColor;uniform float uReduced;varying vec3 vNormal;varying vec3 vPos;void main(){float facing=pow(max(dot(normalize(vNormal),vec3(0.0,0.0,1.0)),0.0),1.7);float wave=0.92+0.08*sin(vPos.y*2.8+uTime*(1.0-uReduced*.95));float edge=pow(1.0-abs(vNormal.z),2.6);vec3 core=mix(vec3(0.42,0.26,0.72),vec3(0.95,0.88,1.0),facing*.86);core=mix(core,uColor,edge*.5);float alpha=(.24+facing*.56+edge*.22)*wave*(1.0+uPulse*.45);gl_FragColor=vec4(core,alpha);}`});
    nucleus=new THREE.Mesh(nucleusGeo,nucleusMat);nucleus.material.uniforms.uColor.value.set(colors.idle);ambient.add(nucleus);
    const haloGeo=new THREE.SphereGeometry(4.25,32,28);const haloMat=new THREE.MeshBasicMaterial({color:0x8a4fff,transparent:true,opacity:.055,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.BackSide});const halo=new THREE.Mesh(haloGeo,haloMat);ambient.add(halo);
    function makeCloud(count,layer){
      const positions=new Float32Array(count*3),scales=new Float32Array(count),phases=new Float32Array(count),colorsArr=new Float32Array(count*3);
      const a=new THREE.Color(),b=new THREE.Color();
      for(let i=0;i<count;i++){const z=Math.random()*2-1;const angle=Math.random()*Math.PI*2;const radius=(layer===0?5.8+Math.random()*4.1:9.3+Math.random()*4.3)*Math.sqrt(1-z*z);positions[i*3]=Math.cos(angle)*radius;positions[i*3+1]=z*(layer===0?9.3:11.8);positions[i*3+2]=Math.sin(angle)*radius*.78;scales[i]=.55+Math.random()*1.5;phases[i]=Math.random()*Math.PI*2;a.setHSL(.73+Math.random()*.07,.78,.42+Math.random()*.3);b.setHSL(.88+Math.random()*.04,.82,.45+Math.random()*.28);const c=a.lerp(b,Math.random()*.55);colorsArr[i*3]=c.r;colorsArr[i*3+1]=c.g;colorsArr[i*3+2]=c.b;}
      const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(positions,3));g.setAttribute("aScale",new THREE.BufferAttribute(scales,1));g.setAttribute("aPhase",new THREE.BufferAttribute(phases,1));g.setAttribute("aColor",new THREE.BufferAttribute(colorsArr,3));
      const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{uTime:{value:0},uSpeed:{value:1},uTurbulence:{value:.5},uPixelRatio:{value:1},uAccent:{value:new THREE.Color(colors.idle)},uState:{value:0},uGlow:{value:1}},vertexShader:`attribute float aScale;attribute float aPhase;attribute vec3 aColor;uniform float uTime;uniform float uSpeed;uniform float uTurbulence;uniform float uPixelRatio;varying vec3 vColor;varying float vAlpha;void main(){vec3 p=position;float t=uTime*uSpeed;float rot=t*(.035+fract(aPhase)*.02);float x=p.x*cos(rot)-p.z*sin(rot);float z=p.x*sin(rot)+p.z*cos(rot);p.x=x;p.z=z;p.y+=sin(t*.25+aPhase+p.x*.18)*uTurbulence*.42;p.x+=cos(t*.17+aPhase+p.y*.14)*uTurbulence*.18;vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aScale*(210.0/max(1.0,-mv.z))*uPixelRatio,1.0,8.0);vColor=aColor;vAlpha=.27+.46*fract(aPhase*3.17);}`,fragmentShader:`uniform vec3 uAccent;uniform float uState;uniform float uGlow;varying vec3 vColor;varying float vAlpha;void main(){float d=length(gl_PointCoord-vec2(.5));float alpha=(1.0-smoothstep(.05,.5,d))*vAlpha*uGlow;if(alpha<.01)discard;vec3 c=mix(vColor,uAccent,clamp(uState*.42,0.0,.58));gl_FragColor=vec4(c,alpha);}`});
      return new THREE.Points(g,m);
    }
    geometry=[];
    let total=0;
    function rebuildParticleClouds(requested){
      geometry.forEach(points=>{ambient.remove(points);points.geometry.dispose();points.material.dispose()});
      geometry.length=0;
      const preset=presets[options.quality]||presets.balanced;
      total=clamp(Number(requested)||Number(options.particles)||preset.particles,3500,65000);
      const inner=Math.floor(total*.68);
      cloud=makeCloud(inner,0);
      const farCloud=makeCloud(total-inner,1);
      ambient.add(cloud,farCloud);
      geometry.push(cloud,farCloud);
    }
    rebuildParticleClouds(options.particles);
    for(const spec of [{rx:13,ry:4.25,rz:0.8,color:0xa879ff,opacity:.36},{rx:11,ry:7.2,rz:-.9,color:0xf64c91,opacity:.28},{rx:15.5,ry:6.2,rz:1.55,color:0x70dfff,opacity:.17}]){
      const points=[];for(let i=0;i<512;i++){const a=i/512*Math.PI*2;points.push(new THREE.Vector3(Math.cos(a)*spec.rx,Math.sin(a)*spec.ry,Math.sin(a)*spec.rx*.07));}
      const ringGeo=new THREE.BufferGeometry().setFromPoints(points);const ringMat=new THREE.LineBasicMaterial({color:spec.color,transparent:true,opacity:spec.opacity,blending:THREE.AdditiveBlending,depthWrite:false});const ring=new THREE.LineLoop(ringGeo,ringMat);ring.rotation.z=spec.rz;ring.rotation.x=spec.rz*.17;ambient.add(ring);orbital.push(ring);
    }
    const starsCount=220;const starPos=new Float32Array(starsCount*3);for(let i=0;i<starsCount;i++){starPos[i*3]=(Math.random()-.5)*48;starPos[i*3+1]=(Math.random()-.5)*35;starPos[i*3+2]=-5-Math.random()*15;}
    const starGeo=new THREE.BufferGeometry();starGeo.setAttribute("position",new THREE.BufferAttribute(starPos,3));const starMat=new THREE.PointsMaterial({color:0xb9a2f2,size:.055,transparent:true,opacity:.43,depthWrite:false});const stars=new THREE.Points(starGeo,starMat);scene.add(stars);
    const syncOptions=()=>{const p=presets[options.quality]||presets.balanced;const dpr=Math.min(window.devicePixelRatio||1,options.quality==="eco"?1:p.pixelRatio);renderer.setPixelRatio(dpr);const px=renderer.getPixelRatio();for(const points of geometry){points.material.uniforms.uPixelRatio.value=px;points.material.uniforms.uSpeed.value=Number(options.speed)||1;points.material.uniforms.uTurbulence.value=Number(options.turbulence)||0;points.material.uniforms.uGlow.value=Number(options.glow)||1;}orbital.forEach((ring,i)=>{ring.visible=(Number(options.orbit)||0)>.05;ring.material.opacity=[.36,.28,.17][i]*(Number(options.orbit)||0);});halo.material.opacity=.055*(Number(options.glow)||1);};
    const resize=()=>{if(disposed)return;const rect=host.getBoundingClientRect();const w=Math.max(1,rect.width),h=Math.max(1,rect.height);camera.aspect=w/h;camera.position.z=w<500?45:40;camera.updateProjectionMatrix();renderer.setSize(w,h,false);syncOptions();};
    resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);resize();
    const reducedNow=()=>options.reducedMotion||matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stateColor=new THREE.Color(colors.idle);function setState(next){state=STATE[next]===undefined?"idle":next;stateColor.set(colors[state]||colors.idle);const stateValue=STATE[state]||0;nucleus.material.uniforms.uColor.value.copy(stateColor);nucleus.material.uniforms.uReduced.value=reducedNow()?1:0;for(const points of geometry){points.material.uniforms.uAccent.value.copy(stateColor);points.material.uniforms.uState.value=stateValue/7;}if(state==="success"){nucleus.material.uniforms.uPulse.value=1;setTimeout(()=>{if(!disposed)nucleus.material.uniforms.uPulse.value=0;},520)}}
    function animate(){if(disposed)return;frame=requestAnimationFrame(animate);if(document.hidden)return;const dt=reducedNow()?0.0008:.008;time+=dt;const motion=reducedNow()?.08:1;for(const points of geometry){points.material.uniforms.uTime.value=time*70;}nucleus.material.uniforms.uTime.value=time*45;nucleus.rotation.y=time*.11*motion;nucleus.rotation.x=Math.sin(time*.08)*.06*motion;ambient.rotation.y=time*.055*motion;ambient.rotation.x=Math.sin(time*.07)*.055*motion;orbital[0].rotation.z+=.00025*motion*(Number(options.orbit)||0);orbital[1].rotation.y+=.00018*motion*(Number(options.orbit)||0);orbital[2].rotation.x+=.00015*motion*(Number(options.orbit)||0);renderer.render(scene,camera);}
    const onContextLost=(event)=>{event.preventDefault();onStatus?.({available:false,reason:"WebGL context lost"});};renderer.domElement.addEventListener("webglcontextlost",onContextLost);
    const onVisibility=()=>{if(!document.hidden&&!disposed){resize();}};document.addEventListener("visibilitychange",onVisibility);
    const oldDispose=()=>{renderer.domElement.removeEventListener("webglcontextlost",onContextLost);document.removeEventListener("visibilitychange",onVisibility);};
    setState("idle");animate();onStatus?.({available:true,renderer:"Three.js WebGL",quality:options.quality,particles:total});
    return {setState,setOptions(next){const previousQuality=options.quality;const previousParticles=options.particles;options={...options,...next};if(next.quality||next.particles){rebuildParticleClouds(options.particles)}syncOptions();if(typeof options.scale==="number")ambient.scale.setScalar(clamp(options.scale,.65,1.45));if(previousQuality!==options.quality||previousParticles!==options.particles){onStatus?.({available:true,renderer:"Three.js WebGL",quality:options.quality,particles:total})}},dispose(){disposed=true;cancelAnimationFrame(frame);oldDispose();resizeObserver?.disconnect();scene?.traverse(obj=>{obj.geometry?.dispose?.();if(Array.isArray(obj.material))obj.material.forEach(m=>m.dispose());else obj.material?.dispose?.()});renderer?.dispose();renderer?.domElement.remove()}};
  }catch(error){try{renderer?.dispose();renderer?.domElement.remove();}catch{}host.replaceChildren();onStatus?.({available:false,reason:"WebGL initialization failed"});return fallbackCore(host,onStatus,options);}
}
