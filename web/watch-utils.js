export function pcmWav(parts,count,rate){
 const buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);const str=(at,text)=>[...text].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
 str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);let at=44;
 for(const part of parts)for(const sample of part){v.setInt16(at,Math.max(-1,Math.min(1,sample))*32767,true);at+=2;}
 return new Blob([buffer],{type:'audio/wav'});
}
export function cropBounds(crop,width,height){const x=Math.max(0,Math.min(.99,crop.x||0)),y=Math.max(0,Math.min(.99,crop.y||0));return {x:Math.floor(x*width),y:Math.floor(y*height),w:Math.max(1,Math.floor(Math.min(1-x,Math.max(.01,crop.w??1))*width)),h:Math.max(1,Math.floor(Math.min(1-y,Math.max(.01,crop.h??1))*height))};}
export function frameDifference(a,b){if(!a||!b||a.length!==b.length)return 1;let value=0;for(let i=0;i<a.length;i+=4)value+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return value/(a.length/4*3*255);}
export function clockLabel(seconds){if(seconds==null)return '未同步';seconds=Math.max(0,seconds);return `${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds/60)%60}`.replace(/:(\d)$/,':0$1')+':'+Math.floor(seconds%60).toString().padStart(2,'0');}
