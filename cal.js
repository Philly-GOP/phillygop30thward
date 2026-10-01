// Renders data/events.json into any <ol class="events" data-limit="N"> on the page,
// with an "Add to calendar" button that downloads an .ics file.
// data-show: "local" (default, hides around:true events), "around" (only those, plus alsoAround), or "all".
// data-past="show" keeps past events; data-empty sets the empty message. Exposes window.WardCal for calendar.html.
(function(){
  var MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  var DAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  function d(e){return new Date(e.date+'T12:00:00');}
  function time12(t){var h=+t.slice(0,2),m=t.slice(3);return (h%12||12)+(m==='00'?'':':'+m)+(h<12?' a.m.':' p.m.');}
  function esc(s){return String(s||'').replace(/[\;,]/g,function(c){return '\\'+c;}).replace(/\n/g,'\\n');}
  // ics(event) or ics([events]) builds one .ics file; several events become one file the phone imports at once.
  function ics(evs){
    var lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//30th Ward Republicans//Calendar//EN','X-WR-CALNAME:30th Ward Republicans'];
    [].concat(evs).forEach(function(e){lines=lines.concat(vevent(e));});
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }
  function vevent(e){
    var day=e.date.replace(/-/g,''), lines=['BEGIN:VEVENT',
      'UID:'+day+'-'+e.title.replace(/\W+/g,'-').toLowerCase()+'@phillygop30thward.com',
      'DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z'];
    if(e.start){lines.push('DTSTART;TZID=America/New_York:'+day+'T'+e.start.replace(':','')+'00');
      lines.push('DTEND;TZID=America/New_York:'+day+'T'+(e.end||e.start).replace(':','')+'00');}
    else{var n=new Date(d(e).getTime()+864e5);lines.push('DTSTART;VALUE=DATE:'+day,'DTEND;VALUE=DATE:'+n.toISOString().slice(0,10).replace(/-/g,''));}
    lines.push('SUMMARY:'+esc(e.title));
    if(e.details)lines.push('DESCRIPTION:'+esc(e.details+(e.link?'\n'+new URL(e.link,location.href).href:'')));
    if(e.where)lines.push('LOCATION:'+esc(e.where));
    lines.push('END:VEVENT');
    return lines;
  }
  function download(evs,name){
    var blob=new Blob([ics(evs)],{type:'text/calendar'}), url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  function render(list,events){
    var limit=+list.getAttribute('data-limit')||0, today=new Date(); today.setHours(0,0,0,0);
    var show=list.getAttribute('data-show')||'local', past=list.getAttribute('data-past')==='show';
    var up=events.filter(function(e){if(!past&&d(e)<today)return false;if(show==='around')return e.around||e.alsoAround;if(show==='local')return !e.around;return true;}).sort(function(a,b){return d(a)-d(b)||(a.start||'').localeCompare(b.start||'');});
    if(limit) up=up.slice(0,limit);
    list.innerHTML='';
    if(!up.length){var p=document.createElement('p');p.className='ev-empty';p.textContent=list.getAttribute('data-empty')||'Nothing on the calendar right now. Check back soon.';list.appendChild(p);return;}
    up.forEach(function(e){
      var li=document.createElement('li'); li.className='event'; var dt=d(e);
      li.innerHTML='<div class="ev-date" aria-hidden="true"><span class="m"></span><span class="d"></span><span class="w"></span></div><div class="ev-body"><h3></h3><p></p></div><button class="ics" type="button">Add to calendar</button>';
      li.querySelector('.m').textContent=MONTHS[dt.getMonth()];
      li.querySelector('.d').textContent=dt.getDate();
      li.querySelector('.w').textContent=DAYS[dt.getDay()];
      var h=li.querySelector('h3'), tag=document.createElement('span');
      tag.className='ev-tag '+(e.kind||''); tag.textContent=e.kind==='election'?'Election':e.kind==='ward'?'Ward':'Party';
      h.appendChild(tag);
      if(e.link){var a=document.createElement('a');a.href=e.link;a.textContent=e.title;a.style.color='inherit';if(/^https?:/.test(e.link)){a.rel='noopener';a.target='_blank';}h.appendChild(a);}else h.appendChild(document.createTextNode(e.title));
      var when=dt.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+(e.start?', '+time12(e.start)+(e.end?' – '+time12(e.end):''):'');
      li.querySelector('p').textContent=[when,e.where,e.details].filter(Boolean).join(' · ');
      li.querySelector('.ics').setAttribute('aria-label','Add '+e.title+' to your calendar');
      li.querySelector('.ics').addEventListener('click',function(){
        download(e,e.title.replace(/\W+/g,'-').toLowerCase()+'.ics');
      });
      list.appendChild(li);
    });
  }
  window.WardCal={render:render,download:download,date:d,time12:time12};
  // Lists marked data-manual are rendered by their own page (calendar.html), not here.
  var lists=document.querySelectorAll('ol.events:not([data-manual])'); if(!lists.length) return;
  fetch('data/events.json?v='+Date.now(),{cache:'no-store'}).then(function(r){return r.json();})
    .then(function(j){[].forEach.call(lists,function(l){render(l,j.events||[]);});})
    .catch(function(){});
  // countdown to the next election event, if the page has one
  var cd=document.getElementById('countdown');
  if(cd){var e=new Date('2026-11-03T07:00:00-05:00'),n=Math.ceil((e-new Date())/864e5);
    if(n>1) cd.innerHTML='<b>'+n+' days</b> until Election Day, Tuesday, November 3. Polls are open 7 a.m. to 8 p.m.';
    else if(n===1) cd.innerHTML='<b>Tomorrow</b> is Election Day. Polls are open 7 a.m. to 8 p.m.';
    else if(n>-1) cd.innerHTML='<b>Today</b> is Election Day. Polls are open until 8 p.m.';}
})();
