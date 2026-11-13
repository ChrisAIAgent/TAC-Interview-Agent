const readline=require('node:readline');
let replyPulse=true, replyPing=true, epoch=0;
function send(o){process.stdout.write(JSON.stringify(o)+'\n')}
send({t:'ready',platform:'test',sameDevice:true});
readline.createInterface({input:process.stdin}).on('line',s=>{
 const m=JSON.parse(s);
 if(m.t==='reset') { epoch=m.seq; send({t:'armed',epoch}); }
 if(m.t==='ping' && replyPing) send({t:'pong',seq:m.seq});
 if(m.t==='pulse' && replyPulse) send({t:'pulse-ack',seq:m.seq});
 if(m.t==='test-stale') send({t:'combo',pressed:true,epoch:epoch-1});
 if(m.t==='test-press') send({t:'combo',pressed:true,epoch});
 if(m.t==='test-freeze') replyPulse=false;
 if(m.t==='test-freeze-all') { replyPulse=false; replyPing=false; }
 if(m.t==='stop') process.exit(0);
});
