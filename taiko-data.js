var SAMPLES = [{"name": "Deep Boom A", "file": "samples/deep-boom-a.mp3"}, {"name": "Deep Boom B", "file": "samples/deep-boom-b.mp3"}, {"name": "Deep Boom C", "file": "samples/deep-boom-c.mp3"}, {"name": "Deep Boom D", "file": "samples/deep-boom-d.mp3"}, {"name": "Big Hit A", "file": "samples/big-hit-a.mp3"}, {"name": "Big Hit B", "file": "samples/big-hit-b.mp3"}, {"name": "Big Hit C", "file": "samples/big-hit-c.mp3"}, {"name": "Big Hit D", "file": "samples/big-hit-d.mp3"}, {"name": "Big Hit E", "file": "samples/big-hit-e.mp3"}, {"name": "Big Hit F", "file": "samples/big-hit-f.mp3"}, {"name": "Big Hit G", "file": "samples/big-hit-g.mp3"}, {"name": "Big Hit H", "file": "samples/big-hit-h.mp3"}, {"name": "Big Hit I", "file": "samples/big-hit-i.mp3"}, {"name": "Mid Hit A", "file": "samples/mid-hit-a.mp3"}, {"name": "Mid Hit B", "file": "samples/mid-hit-b.mp3"}, {"name": "Mid Hit C", "file": "samples/mid-hit-c.mp3"}, {"name": "Mid Hit D", "file": "samples/mid-hit-d.mp3"}, {"name": "Mid Hit E", "file": "samples/mid-hit-e.mp3"}, {"name": "Mid Hit F", "file": "samples/mid-hit-f.mp3"}, {"name": "Mid Hit G", "file": "samples/mid-hit-g.mp3"}, {"name": "Mid Hit H", "file": "samples/mid-hit-h.mp3"}, {"name": "Drum 4a", "file": "samples/drum-4a.mp3"}, {"name": "Drum 4b", "file": "samples/drum-4b.mp3"}, {"name": "Drum 4c", "file": "samples/drum-4c.mp3"}, {"name": "Drum 4d", "file": "samples/drum-4d.mp3"}, {"name": "Drum 4e", "file": "samples/drum-4e.mp3"}, {"name": "Drum 5a", "file": "samples/drum-5a.mp3"}, {"name": "Drum 5b", "file": "samples/drum-5b.mp3"}, {"name": "Drum 5c", "file": "samples/drum-5c.mp3"}, {"name": "Drum 5d", "file": "samples/drum-5d.mp3"}, {"name": "Drum 6a", "file": "samples/drum-6a.mp3"}, {"name": "Drum 6b", "file": "samples/drum-6b.mp3"}, {"name": "Drum 6c", "file": "samples/drum-6c.mp3"}, {"name": "Drum 6d", "file": "samples/drum-6d.mp3"}, {"name": "Drum 6e", "file": "samples/drum-6e.mp3"}, {"name": "Taiko Forte 1", "file": "samples/taiko-forte-1.mp3"}, {"name": "Taiko Forte 2", "file": "samples/taiko-forte-2.mp3"}, {"name": "Taiko Mezzo", "file": "samples/taiko-mezzo.mp3"}, {"name": "Taiko Piano", "file": "samples/taiko-piano.mp3"}, {"name": "Taiko C5", "file": "samples/taiko-c5.mp3"}, {"name": "Quick Hit A", "file": "samples/quick-hit-a.mp3"}, {"name": "Quick Hit B", "file": "samples/quick-hit-b.mp3"}, {"name": "Quick Hit C", "file": "samples/quick-hit-c.mp3"}, {"name": "Crash A", "file": "samples/crash-a.mp3"}, {"name": "Crash B", "file": "samples/crash-b.mp3"}, {"name": "Crash C", "file": "samples/crash-c.mp3"}, {"name": "Crash D", "file": "samples/crash-d.mp3"}, {"name": "Crash E", "file": "samples/crash-e.mp3"}, {"name": "Sticks A", "file": "samples/sticks-a.mp3"}, {"name": "Sticks B", "file": "samples/sticks-b.mp3"}, {"name": "Sticks C", "file": "samples/sticks-c.mp3"}, {"name": "Sticks D", "file": "samples/sticks-d.mp3"}, {"name": "Sticks E", "file": "samples/sticks-e.mp3"}, {"name": "Sticks F", "file": "samples/sticks-f.mp3"}, {"name": "Sticks G", "file": "samples/sticks-g.mp3"}, {"name": "Lt Sticks A", "file": "samples/lt-sticks-a.mp3"}, {"name": "Lt Sticks B", "file": "samples/lt-sticks-b.mp3"}, {"name": "Lt Sticks C", "file": "samples/lt-sticks-c.mp3"}, {"name": "Lt Sticks D", "file": "samples/lt-sticks-d.mp3"}, {"name": "Lt Sticks E", "file": "samples/lt-sticks-e.mp3"}];

/* ---- Taiko pattern codec (URL-safe, compact) ----
   Layout: [ver=1][bpm][swing][stepsCode][nTracks] then per track:
           [trackIndex][vol0-100][ ceil(steps/8) mask bytes ] */
var _STEPMAP={8:0,16:1,32:2,64:3,128:4}, _STEPINV=[8,16,32,64,128];
function _b64u(bytes){var b='';for(var i=0;i<bytes.length;i++)b+=String.fromCharCode(bytes[i]);
  return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function _unb64u(s){s=s.replace(/-/g,'+').replace(/_/g,'/');var b=atob(s);
  var a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}
function encodePattern(p){
  var steps=p.steps||16, nb=Math.ceil(steps/8), rows=[];
  (p.tracks||[]).forEach(function(t,idx){
    if(t.mute) return;
    var active=false; for(var s=0;s<steps;s++){ if(t.steps[s]){active=true;break;} }
    if(!active) return;
    var mask=new Uint8Array(nb);
    for(var s2=0;s2<steps;s2++){ if(t.steps[s2]) mask[s2>>3]|=(1<<(s2&7)); }
    rows.push({idx:idx, vol:Math.round((t.vol==null?0.85:t.vol)*100), mask:mask});
  });
  var buf=new Uint8Array(5+rows.length*(2+nb));
  buf[0]=2; buf[1]=Math.min(255,p.bpm||110); buf[2]=p.swing||0;
  buf[3]=Math.min(255,steps); buf[4]=rows.length;
  var o=5;
  rows.forEach(function(r){ buf[o++]=r.idx; buf[o++]=r.vol; for(var i=0;i<nb;i++) buf[o++]=r.mask[i]; });
  return _b64u(buf);
}
function decodePattern(str){
  var buf=_unb64u(str);
  var ver=buf[0]; if(ver!==1 && ver!==2) throw new Error('unsupported pattern');
  var bpm=buf[1], swing=buf[2], steps=(ver>=2? buf[3] : (_STEPINV[buf[3]]||16)), n=buf[4], nb=Math.ceil(steps/8);
  var tracks=[], o=5;
  for(var k=0;k<n;k++){
    var idx=buf[o++], vol=buf[o++]/100, arr=new Array(steps).fill(false);
    for(var b=0;b<nb;b++){ var byte=buf[o++];
      for(var bit=0;bit<8;bit++){ var s=b*8+bit; if(s<steps && (byte&(1<<bit))) arr[s]=true; } }
    tracks.push({idx:idx, vol:vol, steps:arr});
  }
  return {bpm:bpm, swing:swing, steps:steps, tracks:tracks};
}
if(typeof module!=='undefined'&&module.exports){module.exports={SAMPLES:SAMPLES,encodePattern:encodePattern,decodePattern:decodePattern};}
